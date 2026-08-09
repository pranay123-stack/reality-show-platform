import type { Prisma, RedemptionStatus } from '@prisma/client';
import {
  AUTHORISED_CATEGORIES,
  ERROR_CODES,
  REWARD_PHYSICAL_DISCLAIMER,
  type AuthoriseRewardInput,
  type CreateRewardInput,
  type RedemptionView,
  type RewardRuleInput,
  type RewardView,
} from '@reality/shared';

import { AppError, conflict, forbidden, notFound } from '../../core/errors.js';
import { prisma } from '../../core/prisma.js';
import { awardPoints, spendPoints } from '../points/points.service.js';
import {
  NO_RULE,
  canTransition,
  describeLevel,
  evaluateRewardEligibility,
  shouldReleaseInventory,
  shouldRefund,
  type RewardRuleConfig,
  type RewardUserSnapshot,
} from './rules.js';

/**
 * Reward economy.
 *
 * The `PointsLedger` is untouched and remains the source of truth for every
 * point movement. Nothing here writes a balance directly — every debit goes
 * through `spendPoints` and every refund through `awardPoints`, both of which
 * append to the ledger inside the caller's transaction.
 *
 * The one genuinely hard part is redemption under contention, and it is solved
 * the same way the rest of this codebase solves contention: a single
 * conditional UPDATE that the database serialises.
 */

const REWARD_INCLUDE = {
  inventory: true,
  rule: true,
} satisfies Prisma.RewardCatalogInclude;

type RewardRow = Prisma.RewardCatalogGetPayload<{ include: typeof REWARD_INCLUDE }>;

/** A reward needs sign-off when its category implies something real-world. */
export function needsAuthorisation(category: string): boolean {
  return (AUTHORISED_CATEGORIES as string[]).includes(category);
}

function isAvailable(reward: RewardRow): boolean {
  if (reward.deletedAt) return false;
  if (reward.status !== 'AVAILABLE') return false;

  // A category that needs sign-off is never available without it, whatever the
  // status column says.
  if (needsAuthorisation(reward.category) && !reward.authorisedAt) return false;

  const now = Date.now();
  if (reward.availableFrom && reward.availableFrom.getTime() > now) return false;
  if (reward.availableUntil && reward.availableUntil.getTime() <= now) return false;
  return true;
}

function ruleConfig(reward: RewardRow): RewardRuleConfig {
  if (!reward.rule) return NO_RULE;
  return {
    minLevel: reward.rule.minLevel,
    minLifetimePoints: reward.rule.minLifetimePoints,
    minActivities: reward.rule.minActivities,
    minDistinctFeatures: reward.rule.minDistinctFeatures,
    minAccountAgeDays: reward.rule.minAccountAgeDays,
    requiredFeatures: reward.rule.requiredFeatures,
  };
}

function toRewardView(
  reward: RewardRow,
  snapshot: RewardUserSnapshot | null,
  alreadyHeld: boolean,
): RewardView {
  const inventory = reward.inventory;
  const unlimited = inventory?.remaining === null || inventory === null;

  return {
    id: reward.id,
    code: reward.code,
    name: reward.name,
    description: reward.description,
    category: reward.category,
    type: reward.type,
    pointCost: reward.pointCost,
    status: reward.status,
    oncePerUser: reward.oncePerUser,
    requiresApproval: reward.requiresApproval,
    requiresProductionApproval: needsAuthorisation(reward.category),
    authorised: reward.authorisedAt !== null,
    // A physical or experience reward always carries a caveat, whether or not
    // a producer wrote one.
    disclaimer: needsAuthorisation(reward.category)
      ? (reward.disclaimer ?? REWARD_PHYSICAL_DISCLAIMER)
      : reward.disclaimer,
    availableFrom: reward.availableFrom?.toISOString() ?? null,
    availableUntil: reward.availableUntil?.toISOString() ?? null,
    available: isAvailable(reward),
    inventory: {
      totalUnits: inventory?.totalUnits ?? null,
      remaining: inventory?.remaining ?? null,
      reserved: inventory?.reserved ?? 0,
      fulfilled: inventory?.fulfilled ?? 0,
      unlimited,
    },
    eligibility: snapshot
      ? evaluateRewardEligibility(snapshot, ruleConfig(reward), {
          pointCost: reward.pointCost,
          remaining: inventory?.remaining ?? null,
          available: isAvailable(reward),
          alreadyHeld,
        })
      : null,
    rule: reward.rule
      ? {
          minLevel: reward.rule.minLevel,
          minLifetimePoints: reward.rule.minLifetimePoints,
          minActivities: reward.rule.minActivities,
          minDistinctFeatures: reward.rule.minDistinctFeatures,
          minAccountAgeDays: reward.rule.minAccountAgeDays,
          // Stored as text[] in Postgres; the zod schema narrows it to the
          // known feature keys on the way in, so this is the same set coming
          // back out.
          requiredFeatures: reward.rule.requiredFeatures as RewardRuleInput['requiredFeatures'],
          description: reward.rule.description ?? undefined,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// User snapshot
// ---------------------------------------------------------------------------

const FEATURE_KEYS = [
  'PREDICTION',
  'POLL',
  'CHALLENGE',
  'PERSPECTIVE',
  'NOMINATION',
  'EVICTION',
  'KITCHEN',
  'WEEKEND',
] as const;

export async function getUserSnapshot(userId: string): Promise<RewardUserSnapshot> {
  const [user, prediction, poll, challenge, perspective, nomination, eviction, kitchen, weekend] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          status: true,
          createdAt: true,
          emailVerifiedAt: true,
          profile: { select: { pointsBalance: true, lifetimePoints: true } },
        },
      }),
      prisma.predictionEntry.count({ where: { userId } }),
      prisma.pollVote.count({ where: { userId } }),
      prisma.audienceChallenge.count({ where: { authorId: userId, deletedAt: null } }),
      prisma.perspectiveVote.count({ where: { userId } }),
      prisma.nominationVote.count({ where: { userId } }),
      prisma.evictionVote.count({ where: { userId } }),
      prisma.kitchenVote.count({ where: { userId } }),
      prisma.weekendSubmission.count({ where: { userId, deletedAt: null } }),
    ]);

  const counts = [prediction, poll, challenge, perspective, nomination, eviction, kitchen, weekend];
  const featuresUsed = FEATURE_KEYS.filter((_, index) => (counts[index] ?? 0) > 0);

  return {
    balance: user?.profile?.pointsBalance ?? 0,
    lifetimePoints: user?.profile?.lifetimePoints ?? 0,
    activities: counts.reduce((sum, count) => sum + count, 0),
    distinctFeatures: featuresUsed.length,
    featuresUsed: [...featuresUsed],
    accountAgeDays: user
      ? Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000)
      : 0,
    emailVerified: user?.emailVerifiedAt != null,
    accountStatus: user?.status ?? 'PENDING_VERIFICATION',
  };
}

export async function getUserLevel(userId: string) {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { lifetimePoints: true },
  });
  return describeLevel(profile?.lifetimePoints ?? 0);
}

// ---------------------------------------------------------------------------
// Catalogue reads
// ---------------------------------------------------------------------------

/** Cycle key for a repeatable reward — one redemption per ISO week. */
function cycleKeyFor(reward: RewardRow, at = new Date()): string {
  if (reward.oncePerUser) return 'once';
  const year = at.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const week = Math.floor((at.getTime() - start) / (7 * 86_400_000)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

async function heldRewardIds(userId: string, rewardIds: string[]): Promise<Set<string>> {
  if (rewardIds.length === 0) return new Set();
  const held = await prisma.rewardRedemption.findMany({
    where: {
      userId,
      rewardId: { in: rewardIds },
      status: { in: ['REQUESTED', 'RESERVED', 'APPROVED', 'FULFILLED'] },
    },
    select: { rewardId: true },
  });
  return new Set(held.map((row) => row.rewardId));
}

export async function listRewards(
  userId: string | null,
  options: { category?: string; limit?: number } = {},
): Promise<RewardView[]> {
  const rewards = await prisma.rewardCatalog.findMany({
    where: {
      deletedAt: null,
      // Drafts, paused and retired rewards are invisible to users; so is a
      // physical reward that production has not authorised.
      status: 'AVAILABLE',
      ...(options.category ? { category: options.category as never } : {}),
    },
    include: REWARD_INCLUDE,
    orderBy: [{ pointCost: 'asc' }, { name: 'asc' }],
    take: options.limit ?? 50,
  });

  const visible = rewards.filter((reward) => isAvailable(reward));

  const snapshot = userId ? await getUserSnapshot(userId) : null;
  const held = userId
    ? await heldRewardIds(
        userId,
        visible.map((reward) => reward.id),
      )
    : new Set<string>();

  return visible.map((reward) => toRewardView(reward, snapshot, held.has(reward.id)));
}

export async function getReward(rewardId: string, userId: string | null): Promise<RewardView> {
  const reward = await prisma.rewardCatalog.findFirst({
    where: { id: rewardId, deletedAt: null },
    include: REWARD_INCLUDE,
  });
  if (!reward || !isAvailable(reward)) throw notFound('That reward is not available');

  const snapshot = userId ? await getUserSnapshot(userId) : null;
  const held = userId ? await heldRewardIds(userId, [reward.id]) : new Set<string>();

  return toRewardView(reward, snapshot, held.has(reward.id));
}

// ---------------------------------------------------------------------------
// Redemption — the atomic part
// ---------------------------------------------------------------------------

const REDEMPTION_INCLUDE = {
  reward: true,
  fulfillments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.RewardRedemptionInclude;

type RedemptionRow = Prisma.RewardRedemptionGetPayload<{ include: typeof REDEMPTION_INCLUDE }>;

function toRedemptionView(redemption: RedemptionRow): RedemptionView {
  return {
    id: redemption.id,
    status: redemption.status,
    pointsSpent: redemption.pointsSpent,
    createdAt: redemption.createdAt.toISOString(),
    reservedAt: redemption.reservedAt?.toISOString() ?? null,
    approvedAt: redemption.approvedAt?.toISOString() ?? null,
    fulfilledAt: redemption.fulfilledAt?.toISOString() ?? null,
    closedAt: redemption.closedAt?.toISOString() ?? null,
    notes: redemption.notes,
    refunded: redemption.refundEntryId !== null,
    reward: {
      id: redemption.reward.id,
      code: redemption.reward.code,
      name: redemption.reward.name,
      category: redemption.reward.category,
      type: redemption.reward.type,
      pointCost: redemption.reward.pointCost,
      disclaimer: needsAuthorisation(redemption.reward.category)
        ? (redemption.reward.disclaimer ?? REWARD_PHYSICAL_DISCLAIMER)
        : redemption.reward.disclaimer,
    },
    history: redemption.fulfillments.map((event) => ({
      toStatus: event.toStatus,
      note: event.note,
      at: event.createdAt.toISOString(),
    })),
  };
}

async function logTransition(
  tx: Prisma.TransactionClient,
  redemptionId: string,
  from: RedemptionStatus | null,
  to: RedemptionStatus,
  actorId?: string | null,
  note?: string | null,
): Promise<void> {
  await tx.rewardFulfillment.create({
    data: {
      redemptionId,
      fromStatus: from,
      toStatus: to,
      actorId: actorId ?? null,
      note: note ?? null,
    },
  });
}

export interface RedeemResult {
  redemption: RedemptionView;
  pointsSpent: number;
  balance: number;
}

/**
 * Redeem a reward.
 *
 * Everything happens in **one** transaction, in this order:
 *
 *   1. claim a unit of inventory  (conditional UPDATE — the contention point)
 *   2. create the redemption      (unique constraint — the duplicate guard)
 *   3. debit the points           (ledger append via `spendPoints`)
 *   4. log the lifecycle          (REQUESTED → RESERVED, and further if auto)
 *
 * If any step fails the whole thing rolls back, which is what gives the two
 * guarantees the brief asks for: inventory failing means no points move, and
 * points failing means no unit is held.
 *
 * Inventory is claimed *first* on purpose. It is the scarce resource, so making
 * concurrent redeemers serialise on that row as early as possible is what keeps
 * a hundred simultaneous attempts against ten units at exactly ten winners.
 */
export async function redeemReward(rewardId: string, userId: string): Promise<RedeemResult> {
  const reward = await prisma.rewardCatalog.findFirst({
    where: { id: rewardId, deletedAt: null },
    include: REWARD_INCLUDE,
  });
  if (!reward) throw notFound('That reward does not exist');

  if (!isAvailable(reward)) {
    throw new AppError({
      code: ERROR_CODES.REWARD_UNAVAILABLE,
      message:
        needsAuthorisation(reward.category) && !reward.authorisedAt
          ? 'This reward has not been authorised by production yet'
          : 'This reward is not currently available',
      statusCode: 409,
    });
  }

  // Eligibility is checked here, not merely rendered in the UI.
  const snapshot = await getUserSnapshot(userId);
  const eligibility = evaluateRewardEligibility(snapshot, ruleConfig(reward), {
    pointCost: reward.pointCost,
    remaining: reward.inventory?.remaining ?? null,
    available: true,
    alreadyHeld: false,
  });

  if (!eligibility.eligible) {
    throw new AppError({
      code: ERROR_CODES.NOT_ELIGIBLE,
      message: eligibility.blockers[0] ?? 'You are not eligible for this reward',
      statusCode: 403,
      details: { requirements: eligibility.requirements },
    });
  }

  const cycleKey = cycleKeyFor(reward);
  const autoFulfil = reward.category === 'DIGITAL' && !reward.requiresApproval;

  let redemptionId = '';
  let balance = 0;

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Claim a unit. `remaining` is null for unlimited rewards, and
      //    NULL - 1 is still NULL, so unlimited stock never runs out while a
      //    finite one can never go negative.
      const claimed = await tx.rewardInventory.updateMany({
        where: {
          rewardId,
          OR: [{ remaining: null }, { remaining: { gt: 0 } }],
        },
        data: { remaining: { decrement: 1 }, reserved: { increment: 1 } },
      });

      if (claimed.count === 0) {
        throw new AppError({
          code: ERROR_CODES.REWARD_UNAVAILABLE,
          message: 'This reward is out of stock',
          statusCode: 409,
        });
      }

      // 2. Create the redemption. The unique constraint on
      //    (userId, rewardId, cycleKey) is the real duplicate guard.
      const redemption = await tx.rewardRedemption.create({
        data: {
          rewardId,
          userId,
          status: 'RESERVED',
          pointsSpent: reward.pointCost,
          cycleKey,
          reservedAt: new Date(),
        },
      });
      redemptionId = redemption.id;

      // 3. Debit the points through the ledger. `spendPoints` joins this
      //    transaction, so a shortfall rolls back the claim above.
      //    The reason carries the redemption id, so the ledger's unique
      //    constraint makes a repeated debit impossible even for a repeatable
      //    reward.
      //
      //    A free reward writes no ledger row at all. An entry of zero would be
      //    a movement that never happened, and the ledger should only ever
      //    record real ones.
      if (reward.pointCost > 0) {
        const spend = await spendPoints(
          {
            userId,
            points: reward.pointCost,
            sourceType: 'REWARD_REDEMPTION',
            sourceId: rewardId,
            reason: `redeem:${redemption.id}`,
            metadata: { rewardCode: reward.code, cycleKey },
          },
          tx,
        );
        balance = spend.balance;

        await tx.rewardRedemption.update({
          where: { id: redemption.id },
          data: { ledgerEntryId: spend.entryId },
        });
      } else {
        balance = snapshot.balance;
      }

      // 4. Lifecycle log.
      await logTransition(tx, redemption.id, null, 'REQUESTED', userId, 'Redemption requested');
      await logTransition(tx, redemption.id, 'REQUESTED', 'RESERVED', userId, 'Inventory reserved');

      // A digital reward that needs no approval is delivered immediately —
      // there is no fulfilment work for a badge.
      if (autoFulfil) {
        await tx.rewardRedemption.update({
          where: { id: redemption.id },
          data: {
            status: 'FULFILLED',
            approvedAt: new Date(),
            fulfilledAt: new Date(),
            closedAt: new Date(),
          },
        });
        await logTransition(tx, redemption.id, 'RESERVED', 'APPROVED', null, 'Automatic approval');
        await logTransition(
          tx,
          redemption.id,
          'APPROVED',
          'FULFILLED',
          null,
          'Digital reward granted automatically',
        );
        await tx.rewardInventory.updateMany({
          where: { rewardId },
          data: { reserved: { decrement: 1 }, fulfilled: { increment: 1 } },
        });
      }
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isUniqueViolation(error)) {
      throw conflict(ERROR_CODES.ALREADY_CLAIMED, 'You have already redeemed this reward');
    }
    throw error;
  }

  const redemption = await prisma.rewardRedemption.findUniqueOrThrow({
    where: { id: redemptionId },
    include: REDEMPTION_INCLUDE,
  });

  return { redemption: toRedemptionView(redemption), pointsSpent: reward.pointCost, balance };
}

// ---------------------------------------------------------------------------
// Redemption reads
// ---------------------------------------------------------------------------

export async function listMyRedemptions(userId: string, status?: string) {
  const redemptions = await prisma.rewardRedemption.findMany({
    where: { userId, ...(status ? { status: status as never } : {}) },
    include: REDEMPTION_INCLUDE,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return redemptions.map(toRedemptionView);
}

export async function getMyRedemption(redemptionId: string, userId: string) {
  const redemption = await prisma.rewardRedemption.findUnique({
    where: { id: redemptionId },
    include: REDEMPTION_INCLUDE,
  });
  if (!redemption) throw notFound('That redemption does not exist');
  if (redemption.userId !== userId) throw forbidden('That is not your redemption');
  return toRedemptionView(redemption);
}

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

interface TransitionOptions {
  actorId: string | null;
  note?: string;
  /** Set when a user cancels their own redemption. */
  selfService?: boolean;
}

/**
 * Moves a redemption to a new state, refunding points and releasing inventory
 * when the rules say so — all inside one transaction.
 */
async function transition(
  redemptionId: string,
  to: RedemptionStatus,
  options: TransitionOptions,
): Promise<RedemptionView> {
  const existing = await prisma.rewardRedemption.findUnique({
    where: { id: redemptionId },
    include: { reward: true },
  });
  if (!existing) throw notFound('That redemption does not exist');

  if (!canTransition(existing.status, to)) {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: `A redemption cannot go from ${existing.status} to ${to}`,
      statusCode: 409,
    });
  }

  const refunding = shouldRefund(existing.status, to);
  const releasing = shouldReleaseInventory(existing.status, to);

  await prisma.$transaction(async (tx) => {
    const now = new Date();

    const data: Prisma.RewardRedemptionUpdateInput = {
      status: to,
      ...(to === 'APPROVED' ? { approvedAt: now } : {}),
      ...(to === 'FULFILLED' ? { fulfilledAt: now, closedAt: now } : {}),
      ...(to === 'REJECTED' || to === 'CANCELLED' || to === 'EXPIRED' ? { closedAt: now } : {}),
      ...(options.actorId ? { decidedById: options.actorId, decidedAt: now } : {}),
      ...(options.note ? { notes: options.note } : {}),
    };

    // Freeing the unique slot lets a user redeem again after cancelling, while
    // keeping the original row as history.
    if (to === 'CANCELLED' || to === 'REJECTED' || to === 'EXPIRED') {
      data.cycleKey = `${existing.cycleKey}:void:${existing.id}`;
    }

    await tx.rewardRedemption.update({ where: { id: redemptionId }, data });

    if (releasing) {
      await tx.rewardInventory.updateMany({
        where: { rewardId: existing.rewardId },
        data: {
          reserved: { decrement: 1 },
          // Unlimited stock stays unlimited: NULL + 1 is still NULL.
          remaining: { increment: 1 },
        },
      });
    }

    if (to === 'FULFILLED') {
      await tx.rewardInventory.updateMany({
        where: { rewardId: existing.rewardId },
        data: { reserved: { decrement: 1 }, fulfilled: { increment: 1 } },
      });
    }

    if (refunding && existing.pointsSpent > 0) {
      // A refund is a compensating ledger row, never an edit of the debit.
      const refund = await awardPoints(
        {
          userId: existing.userId,
          points: existing.pointsSpent,
          sourceType: 'REWARD_REDEMPTION',
          sourceId: existing.rewardId,
          reason: `refund:${existing.id}`,
          entryType: 'REVERSAL',
          metadata: { redemptionId: existing.id, reason: to },
          createdById: options.actorId ?? undefined,
        },
        tx,
      );

      await tx.rewardRedemption.update({
        where: { id: redemptionId },
        data: { refundEntryId: refund.entryId },
      });
    }

    await logTransition(
      tx,
      redemptionId,
      existing.status,
      to,
      options.actorId,
      options.note ?? (options.selfService ? 'Cancelled by the user' : null),
    );
  });

  const updated = await prisma.rewardRedemption.findUniqueOrThrow({
    where: { id: redemptionId },
    include: REDEMPTION_INCLUDE,
  });
  return toRedemptionView(updated);
}

export async function cancelOwnRedemption(redemptionId: string, userId: string, note?: string) {
  const redemption = await prisma.rewardRedemption.findUnique({ where: { id: redemptionId } });
  if (!redemption) throw notFound('That redemption does not exist');
  if (redemption.userId !== userId) throw forbidden('That is not your redemption');

  if (redemption.status === 'FULFILLED') {
    throw conflict(
      ERROR_CODES.CONFLICT,
      'This reward has already been given to you and cannot be cancelled',
    );
  }

  return transition(redemptionId, 'CANCELLED', { actorId: userId, note, selfService: true });
}

export const approveRedemption = (id: string, actorId: string, note?: string) =>
  transition(id, 'APPROVED', { actorId, note });

export const fulfilRedemption = (id: string, actorId: string, note?: string) =>
  transition(id, 'FULFILLED', { actorId, note });

export const rejectRedemption = (id: string, actorId: string, reason: string) =>
  transition(id, 'REJECTED', { actorId, note: reason });

export const cancelRedemptionAsAdmin = (id: string, actorId: string, note?: string) =>
  transition(id, 'CANCELLED', { actorId, note });

/** Expires reservations that have sat unapproved past their deadline. */
export async function expireStaleRedemptions(): Promise<number> {
  const stale = await prisma.rewardRedemption.findMany({
    where: {
      status: { in: ['REQUESTED', 'RESERVED'] },
      expiresAt: { lte: new Date() },
    },
    select: { id: true },
  });

  for (const redemption of stale) {
    await transition(redemption.id, 'EXPIRED', { actorId: null, note: 'Reservation expired' });
  }

  return stale.length;
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export async function createReward(input: CreateRewardInput) {
  // A reward that needs sign-off is always created as a DRAFT, whatever the
  // caller intended. Publishing it is a separate, permission-gated action.
  const requiresProductionApproval = needsAuthorisation(input.category);

  const reward = await prisma.rewardCatalog.create({
    data: {
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      category: input.category,
      type: input.type,
      pointCost: input.pointCost,
      status: 'DRAFT',
      oncePerUser: input.oncePerUser,
      requiresApproval: requiresProductionApproval ? true : input.requiresApproval,
      requiresProductionApproval,
      availableFrom: input.availableFrom ? new Date(input.availableFrom) : null,
      availableUntil: input.availableUntil ? new Date(input.availableUntil) : null,
      ...(input.metadata ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
      inventory: {
        create: {
          totalUnits: input.totalUnits ?? null,
          remaining: input.totalUnits ?? null,
        },
      },
      ...(input.rule
        ? {
            rule: {
              create: {
                minLevel: input.rule.minLevel,
                minLifetimePoints: input.rule.minLifetimePoints,
                minActivities: input.rule.minActivities,
                minDistinctFeatures: input.rule.minDistinctFeatures,
                minAccountAgeDays: input.rule.minAccountAgeDays,
                requiredFeatures: input.rule.requiredFeatures,
                description: input.rule.description ?? null,
              },
            },
          }
        : {}),
    },
    include: REWARD_INCLUDE,
  });

  return toRewardView(reward, null, false);
}

export async function updateReward(rewardId: string, input: Partial<CreateRewardInput>) {
  const reward = await prisma.rewardCatalog.findUniqueOrThrow({ where: { id: rewardId } });

  // Changing category into an authorised one drops any existing sign-off:
  // authorisation was granted for what the reward *was*.
  const categoryChanged = input.category !== undefined && input.category !== reward.category;
  const nowNeedsAuthorisation = needsAuthorisation(input.category ?? reward.category);

  const updated = await prisma.rewardCatalog.update({
    where: { id: rewardId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.pointCost !== undefined ? { pointCost: input.pointCost } : {}),
      ...(input.oncePerUser !== undefined ? { oncePerUser: input.oncePerUser } : {}),
      ...(input.requiresApproval !== undefined ? { requiresApproval: input.requiresApproval } : {}),
      ...(input.availableFrom !== undefined
        ? { availableFrom: input.availableFrom ? new Date(input.availableFrom) : null }
        : {}),
      ...(input.availableUntil !== undefined
        ? { availableUntil: input.availableUntil ? new Date(input.availableUntil) : null }
        : {}),
      ...(categoryChanged
        ? {
            requiresProductionApproval: nowNeedsAuthorisation,
            authorisedAt: null,
            authorisedById: null,
            ...(nowNeedsAuthorisation ? { status: 'DRAFT' as const } : {}),
          }
        : {}),
    },
    include: REWARD_INCLUDE,
  });

  if (input.rule) {
    await prisma.rewardRule.upsert({
      where: { rewardId },
      update: { ...input.rule, description: input.rule.description ?? null },
      create: { rewardId, ...input.rule, description: input.rule.description ?? null },
    });
  }

  return toRewardView(updated, null, false);
}

export async function addInventory(rewardId: string, units: number) {
  const inventory = await prisma.rewardInventory.findUnique({ where: { rewardId } });
  if (!inventory) throw notFound('That reward has no inventory record');

  if (inventory.totalUnits === null) {
    throw new AppError({
      code: ERROR_CODES.CONFLICT,
      message: 'This reward has unlimited stock; there is nothing to add',
      statusCode: 409,
    });
  }

  return prisma.rewardInventory.update({
    where: { rewardId },
    data: { totalUnits: { increment: units }, remaining: { increment: units } },
  });
}

export async function setRewardStatus(rewardId: string, status: string) {
  const reward = await prisma.rewardCatalog.findUniqueOrThrow({
    where: { id: rewardId },
    include: REWARD_INCLUDE,
  });

  // A conflict, not a permission failure: the caller is allowed to publish
  // rewards, but this one is not in a publishable state yet. Keeping the two
  // apart is what lets the UI say "authorise it first" instead of "you can't
  // do that".
  if (status === 'AVAILABLE' && needsAuthorisation(reward.category) && !reward.authorisedAt) {
    throw new AppError({
      code: ERROR_CODES.NOT_AUTHORISED,
      message: 'This reward needs production authorisation before it can be published',
      statusCode: 409,
    });
  }

  const updated = await prisma.rewardCatalog.update({
    where: { id: rewardId },
    data: { status: status as never },
    include: REWARD_INCLUDE,
  });

  return toRewardView(updated, null, false);
}

/**
 * Authorising a physical or experience reward.
 *
 * Its own endpoint, its own permission, an explicit acknowledgement and a
 * disclaimer — the same shape as the weekend in-person gate, because it is the
 * same kind of promise.
 */
export async function authoriseReward(
  rewardId: string,
  actorId: string,
  input: AuthoriseRewardInput,
) {
  const reward = await prisma.rewardCatalog.findUniqueOrThrow({
    where: { id: rewardId },
    include: REWARD_INCLUDE,
  });

  if (!needsAuthorisation(reward.category)) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'Only physical and experience rewards need production authorisation',
      statusCode: 400,
    });
  }

  const updated = await prisma.rewardCatalog.update({
    where: { id: rewardId },
    data: input.authorised
      ? {
          authorisedById: actorId,
          authorisedAt: new Date(),
          disclaimer: input.disclaimer ?? null,
        }
      : {
          authorisedById: null,
          authorisedAt: null,
          // Withdrawing authorisation must also take it off the shelf.
          status: 'PAUSED',
        },
    include: REWARD_INCLUDE,
  });

  return toRewardView(updated, null, false);
}

export async function retireReward(rewardId: string) {
  const updated = await prisma.rewardCatalog.update({
    where: { id: rewardId },
    data: { status: 'RETIRED', deletedAt: new Date() },
    include: REWARD_INCLUDE,
  });
  return toRewardView(updated, null, false);
}

export async function listRewardsForAdmin() {
  const rewards = await prisma.rewardCatalog.findMany({
    include: REWARD_INCLUDE,
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    take: 200,
  });
  return rewards.map((reward) => toRewardView(reward, null, false));
}

export async function listRedemptionsForAdmin(options: { status?: string; rewardId?: string } = {}) {
  const redemptions = await prisma.rewardRedemption.findMany({
    where: {
      ...(options.status ? { status: options.status as never } : {}),
      ...(options.rewardId ? { rewardId: options.rewardId } : {}),
    },
    include: {
      ...REDEMPTION_INCLUDE,
      user: { select: { id: true, email: true, profile: { select: { displayName: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return redemptions.map((redemption) => ({
    ...toRedemptionView(redemption),
    user: {
      id: redemption.user.id,
      displayName: redemption.user.profile?.displayName ?? 'Viewer',
      email: redemption.user.email,
    },
  }));
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
