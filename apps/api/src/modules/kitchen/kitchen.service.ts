import type { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  KITCHEN_RESULT_DISCLAIMER,
  type CreateKitchenDecisionInput,
  type ImplementKitchenResultInput,
  type KitchenAudienceResult,
  type KitchenBudgetView,
  type KitchenDecisionView,
  type KitchenImplementedResult,
  type KitchenOptionView,
} from '@reality/shared';

import { AppError, conflict, notFound } from '../../core/errors.js';
import { track } from '../analytics/analytics.service.js';
import { emitDomainEvent } from '../../core/domain-events.js';
import { prisma } from '../../core/prisma.js';
import { awardPoints } from '../points/points.service.js';
import { getCurrentShowId } from '../show/show.service.js';
import { costOf, resolveSelection, sameSelection, type ResolvableOption } from './budget.js';

/**
 * Kitchen Control.
 *
 * The audience influences what the house is given. It never touches the money:
 *
 *  - a vote carries **option ids only** — no cost, no quantity, no budget
 *  - `unitCost` is producer-set and read from the database on every calculation
 *  - `spentUnits` moves **only** when production records what it implemented,
 *    behind an atomic guard that cannot overdraw the budget
 *
 * And, as with nomination/eviction, the audience decision and the official
 * execution are separate records written by separate endpoints.
 */

/** The allowance table is keyed by a free-form type, so kitchen reuses it. */
const ALLOWANCE_TYPE = 'KITCHEN';

const DECISION_INCLUDE = {
  options: { orderBy: { sortOrder: 'asc' } },
  budget: true,
  result: true,
} satisfies Prisma.KitchenDecisionInclude;

type DecisionRow = Prisma.KitchenDecisionGetPayload<{ include: typeof DECISION_INCLUDE }>;

export function isDecisionOpen(decision: {
  status: string;
  opensAt: Date;
  closesAt: Date;
}): boolean {
  const now = Date.now();
  return (
    decision.status === 'OPEN' &&
    decision.opensAt.getTime() <= now &&
    decision.closesAt.getTime() > now
  );
}

function budgetView(budget: DecisionRow['budget']): KitchenBudgetView {
  const remaining = Math.max(0, budget.totalUnits - budget.spentUnits);
  return {
    id: budget.id,
    label: budget.label,
    currencySymbol: budget.currencySymbol,
    totalUnits: budget.totalUnits,
    spentUnits: budget.spentUnits,
    remainingUnits: remaining,
    usedPercentage:
      budget.totalUnits > 0
        ? Math.round((budget.spentUnits / budget.totalUnits) * 1000) / 10
        : 0,
    periodStart: budget.periodStart.toISOString(),
    periodEnd: budget.periodEnd.toISOString(),
  };
}

function weightFor(weighting: Prisma.JsonValue | null, optionId: string): number {
  if (!weighting || typeof weighting !== 'object' || Array.isArray(weighting)) return 1;
  const value = (weighting as Record<string, unknown>)[optionId];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}

function toResolvable(decision: DecisionRow): ResolvableOption[] {
  return decision.options.map((option) => ({
    optionId: option.id,
    label: option.label,
    unitCost: option.unitCost,
    quantity: option.quantity,
    unit: option.unit,
    voteCount: option.voteCount,
    score: option.voteCount * weightFor(decision.weighting, option.id),
    sortOrder: option.sortOrder,
  }));
}

function buildView(
  decision: DecisionRow,
  mySelections: Set<string>,
  selectionsUsed: number,
): KitchenDecisionView {
  const finalized = decision.status === 'FINALIZED';
  const total = decision.totalVotes;
  const budget = budgetView(decision.budget);

  const options: KitchenOptionView[] = decision.options.map((option) => ({
    id: option.id,
    label: option.label,
    kind: option.kind,
    quantity: option.quantity,
    unit: option.unit,
    sortOrder: option.sortOrder,
    // Cost is public: people should see what their choice costs the house.
    unitCost: option.unitCost,
    // The split stays hidden while voting is open so late voters cannot simply
    // pile onto whatever is already winning.
    voteCount: finalized ? option.voteCount : 0,
    percentage:
      finalized && total > 0 ? Math.round((option.voteCount / total) * 1000) / 10 : 0,
    selectedByMe: mySelections.has(option.id),
    affordable: option.unitCost <= budget.remainingUnits,
  }));

  return {
    id: decision.id,
    title: decision.title,
    question: decision.question,
    status: decision.status,
    opensAt: decision.opensAt.toISOString(),
    closesAt: decision.closesAt.toISOString(),
    isOpen: isDecisionOpen(decision),
    maxSelections: decision.maxSelections,
    winnerCount: decision.winnerCount,
    maxQuantity: decision.maxQuantity,
    // Participation volume is public; who is winning is not.
    totalVotes: total,
    participationPoints: decision.participationPoints,
    bonusPoints: decision.bonusPoints,
    selectionsUsed,
    selectionsRemaining: Math.max(0, decision.maxSelections - selectionsUsed),
    hasParticipated: mySelections.size > 0,
    options,
    budget,
    audienceResult: (decision.result?.audienceResult as KitchenAudienceResult | undefined) ?? null,
    implementedResult:
      (decision.result?.implementedResult as KitchenImplementedResult | undefined) ?? null,
    disclaimer: KITCHEN_RESULT_DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

async function loadDecision(decisionId: string): Promise<DecisionRow> {
  const decision = await prisma.kitchenDecision.findUnique({
    where: { id: decisionId },
    include: DECISION_INCLUDE,
  });
  if (!decision || decision.status === 'DRAFT') throw notFound('That decision does not exist');
  return decision;
}

async function readSelections(
  decisionId: string,
  userId: string | null,
): Promise<{ ids: Set<string>; used: number }> {
  if (!userId) return { ids: new Set(), used: 0 };

  const [votes, allowance] = await Promise.all([
    prisma.kitchenVote.findMany({ where: { decisionId, userId }, select: { optionId: true } }),
    prisma.roundVoteAllowance.findUnique({
      where: {
        roundType_roundId_userId: { roundType: ALLOWANCE_TYPE, roundId: decisionId, userId },
      },
      select: { votesUsed: true },
    }),
  ]);

  return {
    ids: new Set(votes.map((vote) => vote.optionId)),
    used: allowance?.votesUsed ?? votes.length,
  };
}

export async function getDecision(
  decisionId: string,
  userId: string | null,
): Promise<KitchenDecisionView> {
  const decision = await loadDecision(decisionId);
  const { ids, used } = await readSelections(decisionId, userId);
  return buildView(decision, ids, used);
}

export async function listDecisions(
  userId: string | null,
  options: { scope?: 'open' | 'finalized' | 'all'; limit?: number } = {},
): Promise<KitchenDecisionView[]> {
  const showId = await getCurrentShowId();
  const scope = options.scope ?? 'open';
  const now = new Date();

  const where: Prisma.KitchenDecisionWhereInput =
    scope === 'open'
      ? { showId, status: 'OPEN', closesAt: { gt: now } }
      : scope === 'finalized'
        ? { showId, status: 'FINALIZED' }
        : { showId, status: { not: 'DRAFT' } };

  const decisions = await prisma.kitchenDecision.findMany({
    where,
    include: DECISION_INCLUDE,
    orderBy: scope === 'finalized' ? { finalizedAt: 'desc' } : { closesAt: 'asc' },
    take: options.limit ?? 20,
  });

  if (decisions.length === 0) return [];

  const [votes, allowances] = userId
    ? await Promise.all([
        prisma.kitchenVote.findMany({
          where: { userId, decisionId: { in: decisions.map((d) => d.id) } },
          select: { decisionId: true, optionId: true },
        }),
        prisma.roundVoteAllowance.findMany({
          where: {
            roundType: ALLOWANCE_TYPE,
            userId,
            roundId: { in: decisions.map((d) => d.id) },
          },
          select: { roundId: true, votesUsed: true },
        }),
      ])
    : [[], []];

  const byDecision = new Map<string, Set<string>>();
  for (const vote of votes) {
    const set = byDecision.get(vote.decisionId) ?? new Set<string>();
    set.add(vote.optionId);
    byDecision.set(vote.decisionId, set);
  }
  const usedByDecision = new Map(allowances.map((row) => [row.roundId, row.votesUsed]));

  return decisions.map((decision) =>
    buildView(
      decision,
      byDecision.get(decision.id) ?? new Set(),
      usedByDecision.get(decision.id) ?? 0,
    ),
  );
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

export interface KitchenVoteResult {
  decision: KitchenDecisionView;
  selectionsUsed: number;
  selectionsRemaining: number;
  pointsAwarded: number;
}

/**
 * Records a user's picks.
 *
 * Everything that could go wrong is checked server-side, in this order:
 * decision open → options belong to this decision → option is affordable →
 * allowance available (atomic) → not already picked (unique constraint).
 */
export async function castKitchenVote(
  decisionId: string,
  userId: string,
  optionIds: string[],
): Promise<KitchenVoteResult> {
  const decision = await prisma.kitchenDecision.findUnique({
    where: { id: decisionId },
    include: { options: true, budget: true },
  });

  if (!decision || decision.status === 'DRAFT') throw notFound('That decision does not exist');

  if (!isDecisionOpen(decision)) {
    throw new AppError({
      code: ERROR_CODES.ROUND_CLOSED,
      message:
        decision.status !== 'OPEN'
          ? 'This kitchen decision is no longer open'
          : decision.opensAt.getTime() > Date.now()
            ? 'This kitchen decision has not opened yet'
            : 'This kitchen decision has closed',
      statusCode: 409,
    });
  }

  const unique = [...new Set(optionIds)];
  if (unique.length !== optionIds.length) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'The same option was sent more than once',
      statusCode: 400,
    });
  }

  const chosen = decision.options.filter((option) => unique.includes(option.id));
  if (chosen.length !== unique.length) {
    throw new AppError({
      code: ERROR_CODES.OPTION_INVALID,
      message: 'One or more options do not belong to this decision',
      statusCode: 400,
    });
  }

  if (unique.length > decision.maxSelections) {
    throw new AppError({
      code: ERROR_CODES.VOTE_LIMIT_REACHED,
      message: `You may pick at most ${decision.maxSelections} option${
        decision.maxSelections === 1 ? '' : 's'
      } in this decision`,
      statusCode: 409,
    });
  }

  // An option the house could never afford is not a real choice, so it is
  // refused up front rather than silently dropped at resolution time.
  const remaining = Math.max(0, decision.budget.totalUnits - decision.budget.spentUnits);
  const unaffordable = chosen.find((option) => option.unitCost > remaining);
  if (unaffordable) {
    throw new AppError({
      code: ERROR_CODES.BUDGET_EXCEEDED,
      message: `"${unaffordable.label}" costs more than the house has left in the budget`,
      statusCode: 409,
      details: { optionId: unaffordable.id, unitCost: unaffordable.unitCost, remaining },
    });
  }

  await prisma.roundVoteAllowance.upsert({
    where: {
      roundType_roundId_userId: { roundType: ALLOWANCE_TYPE, roundId: decisionId, userId },
    },
    update: { voteLimit: decision.maxSelections },
    create: {
      roundType: ALLOWANCE_TYPE,
      roundId: decisionId,
      userId,
      voteLimit: decision.maxSelections,
      votesUsed: 0,
    },
  });

  try {
    await prisma.$transaction(async (tx) => {
      for (const option of chosen) {
        // Atomic allowance claim, one per option. Two concurrent requests
        // cannot both pass: the second sees the first's committed increment or
        // blocks on the row.
        const claimed = await tx.roundVoteAllowance.updateMany({
          where: {
            roundType: ALLOWANCE_TYPE,
            roundId: decisionId,
            userId,
            votesUsed: { lt: decision.maxSelections },
          },
          data: { votesUsed: { increment: 1 } },
        });

        if (claimed.count === 0) {
          throw new AppError({
            code: ERROR_CODES.VOTE_LIMIT_REACHED,
            message: `You have used all ${decision.maxSelections} of your picks in this decision`,
            statusCode: 409,
          });
        }

        // The unique constraint is the real duplicate guard; a P2002 rolls back
        // the claim above, so being refused never costs a pick.
        await tx.kitchenVote.create({ data: { decisionId, userId, optionId: option.id } });
        await tx.kitchenOption.update({
          where: { id: option.id },
          data: { voteCount: { increment: 1 } },
        });
      }

      // Re-checked inside the transaction so a close committing concurrently
      // cannot leave a vote counted against a closed decision.
      const stillOpen = await tx.kitchenDecision.updateMany({
        where: { id: decisionId, status: 'OPEN', closesAt: { gt: new Date() } },
        data: { totalVotes: { increment: chosen.length } },
      });

      if (stillOpen.count === 0) {
        throw new AppError({
          code: ERROR_CODES.ROUND_CLOSED,
          message: 'This kitchen decision closed while your vote was being recorded',
          statusCode: 409,
        });
      }
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isUniqueViolation(error)) {
      throw conflict(ERROR_CODES.VOTE_DUPLICATE, 'You have already picked one of those options');
    }
    throw error;
  }

  // Participation is credited once per decision, not once per option picked.
  const award = await awardPoints({
    userId,
    sourceType: 'KITCHEN',
    sourceId: decisionId,
    reason: 'participation',
    points: decision.participationPoints,
  });

  const view = await getDecision(decisionId, userId);

  void track({ name: 'kitchen_voted', userId, entityId: decisionId });

  return {
    decision: view,
    selectionsUsed: view.selectionsUsed,
    selectionsRemaining: view.selectionsRemaining,
    pointsAwarded: award.delta,
  };
}

export async function withdrawKitchenVote(
  decisionId: string,
  userId: string,
  optionId: string,
): Promise<KitchenVoteResult> {
  const decision = await prisma.kitchenDecision.findUnique({ where: { id: decisionId } });
  if (!decision) throw notFound('That decision does not exist');

  if (!isDecisionOpen(decision)) {
    throw new AppError({
      code: ERROR_CODES.ROUND_CLOSED,
      message: 'Picks cannot be changed once the decision has closed',
      statusCode: 409,
    });
  }

  await prisma.$transaction(async (tx) => {
    const deleted = await tx.kitchenVote.deleteMany({ where: { decisionId, userId, optionId } });
    if (deleted.count === 0) throw notFound('You have not picked that option');

    await tx.kitchenOption.update({
      where: { id: optionId },
      data: { voteCount: { decrement: 1 } },
    });
    await tx.kitchenDecision.update({
      where: { id: decisionId },
      data: { totalVotes: { decrement: 1 } },
    });
    await tx.roundVoteAllowance.updateMany({
      where: { roundType: ALLOWANCE_TYPE, roundId: decisionId, userId, votesUsed: { gt: 0 } },
      data: { votesUsed: { decrement: 1 } },
    });
  });

  const view = await getDecision(decisionId, userId);
  return {
    decision: view,
    selectionsUsed: view.selectionsUsed,
    selectionsRemaining: view.selectionsRemaining,
    pointsAwarded: 0,
  };
}

// ---------------------------------------------------------------------------
// Operator lifecycle
// ---------------------------------------------------------------------------

export async function createBudget(
  input: {
    label: string;
    totalUnits: number;
    currencySymbol?: string;
    periodStart: string;
    periodEnd: string;
  },
  actorId: string,
) {
  const showId = await getCurrentShowId();
  return prisma.kitchenBudget.create({
    data: {
      showId,
      label: input.label,
      totalUnits: input.totalUnits,
      ...(input.currencySymbol ? { currencySymbol: input.currencySymbol } : {}),
      periodStart: new Date(input.periodStart),
      periodEnd: new Date(input.periodEnd),
      createdById: actorId,
    },
  });
}

export async function listBudgets() {
  const showId = await getCurrentShowId();
  const budgets = await prisma.kitchenBudget.findMany({
    where: { showId },
    orderBy: { periodStart: 'desc' },
    take: 20,
  });
  return budgets.map(budgetView);
}

export async function createDecision(input: CreateKitchenDecisionInput, actorId: string) {
  const showId = await getCurrentShowId();

  const budget = await prisma.kitchenBudget.findFirst({
    where: { id: input.budgetId, showId },
  });
  if (!budget) throw notFound('That budget does not exist for this show');

  if (input.winnerCount > input.options.length) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'A decision cannot buy more options than it offers',
      statusCode: 400,
    });
  }

  return prisma.kitchenDecision.create({
    data: {
      showId,
      episodeId: input.episodeId ?? null,
      budgetId: budget.id,
      title: input.title,
      question: input.question,
      status: 'DRAFT',
      opensAt: new Date(input.opensAt),
      closesAt: new Date(input.closesAt),
      maxSelections: input.maxSelections,
      winnerCount: input.winnerCount,
      maxQuantity: input.maxQuantity ?? null,
      ...(input.participationPoints !== undefined
        ? { participationPoints: input.participationPoints }
        : {}),
      ...(input.bonusPoints !== undefined ? { bonusPoints: input.bonusPoints } : {}),
      ...(input.weighting ? { weighting: input.weighting as Prisma.InputJsonValue } : {}),
      createdById: actorId,
      options: {
        create: input.options.map((option, index) => ({
          label: option.label,
          kind: option.kind,
          unitCost: option.unitCost,
          quantity: option.quantity ?? null,
          unit: option.unit ?? null,
          sortOrder: option.sortOrder ?? index,
        })),
      },
    },
    include: DECISION_INCLUDE,
  });
}

export async function openDecision(decisionId: string) {
  const decision = await prisma.kitchenDecision.findUniqueOrThrow({
    where: { id: decisionId },
    include: { options: true },
  });

  if (decision.status !== 'DRAFT') {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: `A decision cannot go from ${decision.status} to OPEN`,
      statusCode: 409,
    });
  }
  if (decision.options.length < 2) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'A decision needs at least two options',
      statusCode: 400,
    });
  }
  if (decision.closesAt.getTime() <= Date.now()) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'The close time is already in the past',
      statusCode: 400,
    });
  }

  const opened = await prisma.kitchenDecision.update({
    where: { id: decisionId },
    data: { status: 'OPEN' },
  });

  await emitDomainEvent({
    event: 'kitchen.decision_opened',
    entityId: decisionId,
    payload: { title: decision.title },
  });

  return opened;
}

/** Idempotent by construction: the conditional update matches nothing twice. */
export async function closeDecision(decisionId: string) {
  const updated = await prisma.kitchenDecision.updateMany({
    where: { id: decisionId, status: 'OPEN' },
    data: { status: 'CLOSED' },
  });

  if (updated.count === 0) {
    const decision = await prisma.kitchenDecision.findUnique({ where: { id: decisionId } });
    if (!decision) throw notFound('That decision does not exist');
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: 'Only an open decision can be closed',
      statusCode: 409,
    });
  }

  return { closed: true };
}

/**
 * Computes and stores the **audience** result.
 *
 * Advisory: it records what people voted for, within what the budget could have
 * afforded. No money moves here — `spentUnits` is untouched until production
 * records what it actually implemented.
 */
/**
 * Tells the people who voted what the house decided.
 *
 * The voter list is gathered here rather than in the notification module: this
 * file is the one that knows what a `KitchenVote` is, and the event carries the
 * answer so nothing downstream needs to.
 */
async function emitKitchenResult(
  decisionId: string,
  title: string,
  winner: string,
): Promise<void> {
  const voters = await prisma.kitchenVote.findMany({
    where: { decisionId },
    select: { userId: true },
    distinct: ['userId'],
  });

  await emitDomainEvent({
    event: 'kitchen.result_published',
    entityId: decisionId,
    payload: { title, winner, userIds: voters.map((vote) => vote.userId) },
  });
}

export async function publishAudienceResult(decisionId: string, actorId: string) {
  const decision = await prisma.kitchenDecision.findUniqueOrThrow({
    where: { id: decisionId },
    include: DECISION_INCLUDE,
  });

  if (decision.status !== 'CLOSED') {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: 'A decision must be closed before its audience result can be published',
      statusCode: 409,
    });
  }

  const remaining = Math.max(0, decision.budget.totalUnits - decision.budget.spentUnits);
  const resolution = resolveSelection(toResolvable(decision), {
    winnerCount: decision.winnerCount,
    budgetUnits: remaining,
    maxQuantity: decision.maxQuantity,
  });

  const audienceResult = {
    kind: 'AUDIENCE_RESULT',
    disclaimer: KITCHEN_RESULT_DISCLAIMER,
    selected: resolution.selected,
    skipped: resolution.skipped,
    totalCost: resolution.totalCost,
    budgetRemainingAfter: resolution.budgetRemainingAfter,
    totalVotes: decision.totalVotes,
    computedAt: new Date().toISOString(),
  } satisfies KitchenAudienceResult;

  await emitKitchenResult(decisionId, decision.title, resolution.selected[0]?.label ?? 'the top pick');

  await prisma.$transaction([
    prisma.kitchenResult.upsert({
      where: { decisionId },
      update: {
        audienceResult: audienceResult as unknown as Prisma.InputJsonValue,
        audienceCost: resolution.totalCost,
        publishedById: actorId,
        publishedAt: new Date(),
      },
      create: {
        decisionId,
        audienceResult: audienceResult as unknown as Prisma.InputJsonValue,
        audienceCost: resolution.totalCost,
        publishedById: actorId,
      },
    }),
    prisma.kitchenDecision.update({
      where: { id: decisionId },
      data: { status: 'FINALIZED', finalizedAt: new Date(), finalizedById: actorId },
    }),
  ]);

  return getDecision(decisionId, null);
}

/**
 * Records what production actually gave the house.
 *
 * This is the only place budget is spent, and the only place that can disagree
 * with the audience. The spend is guarded so it can never overdraw:
 *
 *   UPDATE KitchenBudget SET spentUnits = spentUnits + cost
 *   WHERE id = ? AND spentUnits <= totalUnits - cost
 */
export async function recordImplementedResult(
  decisionId: string,
  actorId: string,
  input: ImplementKitchenResultInput,
) {
  const decision = await prisma.kitchenDecision.findUniqueOrThrow({
    where: { id: decisionId },
    include: DECISION_INCLUDE,
  });

  if (decision.status !== 'FINALIZED') {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: 'Publish the audience result before recording what was implemented',
      statusCode: 409,
    });
  }
  if (decision.result?.implementedAt) {
    throw conflict(
      ERROR_CODES.CONFLICT,
      'What was implemented has already been recorded for this decision',
    );
  }

  const unique = [...new Set(input.optionIds)];
  const chosen = decision.options.filter((option) => unique.includes(option.id));
  if (chosen.length !== unique.length) {
    throw new AppError({
      code: ERROR_CODES.OPTION_INVALID,
      message: 'One or more options do not belong to this decision',
      statusCode: 400,
    });
  }

  const cost = costOf(chosen);
  const totalVotes = decision.totalVotes;

  // Atomic spend. `totalUnits - cost` is a literal computed here, so this is a
  // plain value comparison the database can decide on its own.
  const spent = await prisma.kitchenBudget.updateMany({
    where: { id: decision.budgetId, spentUnits: { lte: decision.budget.totalUnits - cost } },
    data: { spentUnits: { increment: cost } },
  });

  if (spent.count === 0) {
    throw new AppError({
      code: ERROR_CODES.BUDGET_EXCEEDED,
      message: `That costs ${cost} but only ${Math.max(
        0,
        decision.budget.totalUnits - decision.budget.spentUnits,
      )} is left in the budget`,
      statusCode: 409,
    });
  }

  const audienceIds =
    (decision.result?.audienceResult as KitchenAudienceResult | undefined)?.selected.map(
      (line) => line.optionId,
    ) ?? [];

  const implementedResult = {
    kind: 'IMPLEMENTED_RESULT',
    source: 'production',
    selected: chosen.map((option) => ({
      optionId: option.id,
      label: option.label,
      quantity: option.quantity,
      unit: option.unit,
      unitCost: option.unitCost,
      voteCount: option.voteCount,
      percentage: totalVotes > 0 ? Math.round((option.voteCount / totalVotes) * 1000) / 10 : 0,
    })),
    totalCost: cost,
    note: input.note ?? null,
    implementedAt: new Date().toISOString(),
    matchesAudience: sameSelection(audienceIds, unique),
  } satisfies KitchenImplementedResult;

  await prisma.kitchenResult.update({
    where: { decisionId },
    data: {
      implementedResult: implementedResult as unknown as Prisma.InputJsonValue,
      implementedCost: cost,
      implementedNote: input.note ?? null,
      implementedById: actorId,
      implementedAt: new Date(),
    },
  });

  // Special kitchen event reward: users who backed something the house actually
  // received. Idempotent through the ledger's unique constraint.
  let rewarded = 0;
  if (decision.bonusPoints > 0) {
    const backers = await prisma.kitchenVote.findMany({
      where: { decisionId, optionId: { in: unique } },
      select: { userId: true },
      distinct: ['userId'],
    });

    for (const backer of backers) {
      const result = await awardPoints({
        userId: backer.userId,
        sourceType: 'KITCHEN',
        sourceId: decisionId,
        reason: 'implemented-match',
        points: decision.bonusPoints,
        createdById: actorId,
      });
      if (result.applied) rewarded += 1;
    }
  }

  return { decision: await getDecision(decisionId, null), cost, usersRewarded: rewarded };
}

/** Bookkeeping only — `castKitchenVote` already refuses a late vote. */
export async function closeExpiredDecisions(): Promise<number> {
  const result = await prisma.kitchenDecision.updateMany({
    where: { status: 'OPEN', closesAt: { lte: new Date() } },
    data: { status: 'CLOSED' },
  });
  return result.count;
}

export async function listDecisionsForAdmin() {
  const showId = await getCurrentShowId();
  return prisma.kitchenDecision.findMany({
    where: { showId },
    include: DECISION_INCLUDE,
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
