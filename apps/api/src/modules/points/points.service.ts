import type { LedgerEntryType, PointSourceType, Prisma } from '@prisma/client';
import { DEFAULT_POINT_RULES, ERROR_CODES, type PointRuleKey } from '@reality/shared';

import { AppError } from '../../core/errors.js';
import { prisma } from '../../core/prisma.js';

/**
 * The one and only way points move.
 *
 * Feature modules never touch `UserProfile.pointsBalance`. They call
 * `awardPoints` / `spendPoints`, which:
 *
 *   1. append an immutable row to `PointsLedger`
 *   2. move the cached balance in the *same* transaction
 *   3. rely on `@@unique(userId, sourceType, sourceId, reason)` for idempotency,
 *      so replaying a resolve job can never double-credit
 *
 * `balanceAfter` is written from the atomic increment's return value, which makes
 * the ledger self-verifying: replaying every delta must reproduce every
 * `balanceAfter`.
 */

export interface AwardInput {
  userId: string;
  sourceType: PointSourceType;
  /** Id of the poll / prediction / challenge that caused this. */
  sourceId: string;
  /** Distinguishes several awards from one source, e.g. `participation` vs `correct`. */
  reason: string;
  /** Explicit amount. Omit to look the value up from `PointsRule` via `ruleKey`. */
  points?: number;
  ruleKey?: PointRuleKey;
  metadata?: Prisma.InputJsonValue;
  entryType?: LedgerEntryType;
  createdById?: string;
}

export interface AwardResult {
  applied: boolean;
  delta: number;
  balance: number;
  entryId: string;
}

/** Rule values change rarely and are read on every award; a short cache is enough. */
let ruleCache: { values: Map<string, number>; expiresAt: number } | null = null;
const RULE_CACHE_MS = 30_000;

export async function getPointValue(key: PointRuleKey): Promise<number> {
  if (!ruleCache || ruleCache.expiresAt < Date.now()) {
    const rules = await prisma.pointsRule.findMany({ where: { active: true } });
    ruleCache = {
      values: new Map(rules.map((rule) => [rule.key, rule.points])),
      expiresAt: Date.now() + RULE_CACHE_MS,
    };
  }
  return ruleCache.values.get(key) ?? DEFAULT_POINT_RULES[key];
}

export function invalidateRuleCache(): void {
  ruleCache = null;
}

/**
 * Credits a user. Safe to call twice with the same
 * (userId, sourceType, sourceId, reason): the second call is a no-op that
 * reports `applied: false` and the current balance.
 */
export async function awardPoints(
  input: AwardInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<AwardResult> {
  const delta = input.points ?? (input.ruleKey ? await getPointValue(input.ruleKey) : 0);

  if (!Number.isInteger(delta)) {
    throw new AppError({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Point values must be whole numbers',
      statusCode: 500,
      expose: false,
    });
  }
  if (delta === 0) {
    const balance = await readBalance(input.userId, client);
    return { applied: false, delta: 0, balance, entryId: '' };
  }

  try {
    return await applyLedgerEntry(
      {
        userId: input.userId,
        delta,
        entryType: input.entryType ?? 'EARN',
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        reason: input.reason,
        metadata: input.metadata,
        createdById: input.createdById,
      },
      client,
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Already credited for this exact reason — the idempotency guarantee.
      const existing = await client.pointsLedger.findFirst({
        where: {
          userId: input.userId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          reason: input.reason,
        },
      });
      const balance = await readBalance(input.userId, client);
      return { applied: false, delta: 0, balance, entryId: existing?.id ?? '' };
    }
    throw error;
  }
}

/**
 * Debits a user, refusing to go negative.
 *
 * The read below is only there to produce a helpful message before doing any
 * work. It is *not* the guard — a read followed by a write is a race, and two
 * concurrent spends could both pass it. The real guard is the conditional
 * UPDATE in `applyLedgerEntry`, which checks and debits in one statement.
 */
export async function spendPoints(
  input: AwardInput & { points: number },
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<AwardResult> {
  if (input.points <= 0) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'Spend amount must be positive',
      statusCode: 400,
    });
  }

  const balance = await readBalance(input.userId, client);
  if (balance < input.points) {
    throw insufficientPoints(input.points, balance);
  }

  try {
    return await applyLedgerEntry(
      {
        userId: input.userId,
        delta: -input.points,
        entryType: 'SPEND',
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        reason: input.reason,
        metadata: input.metadata,
        createdById: input.createdById,
      },
      client,
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError({
        code: ERROR_CODES.ALREADY_CLAIMED,
        message: 'That has already been claimed',
        statusCode: 409,
      });
    }
    throw error;
  }
}

/**
 * Reverses an earlier entry with a *compensating row*. The original is never
 * updated or deleted — that is what makes the ledger auditable.
 */
export async function reverseEntry(
  entryId: string,
  actorId: string,
  note?: string,
): Promise<AwardResult> {
  const original = await prisma.pointsLedger.findUnique({ where: { id: entryId } });
  if (!original) {
    throw new AppError({ code: ERROR_CODES.NOT_FOUND, message: 'Ledger entry not found', statusCode: 404 });
  }
  if (original.entryType === 'REVERSAL') {
    throw new AppError({
      code: ERROR_CODES.CONFLICT,
      message: 'A reversal cannot itself be reversed',
      statusCode: 409,
    });
  }

  try {
    return await applyLedgerEntry({
      userId: original.userId,
      delta: -original.delta,
      entryType: 'REVERSAL',
      sourceType: original.sourceType,
      sourceId: original.sourceId,
      // The original id is part of the reason, so the unique constraint allows
      // exactly one reversal per entry.
      reason: `reversal:${original.id}`,
      metadata: { note: note ?? null, originalReason: original.reason },
      reversedEntryId: original.id,
      createdById: actorId,
      // Undoing an award un-earns it; undoing a spend merely returns it. Only
      // the first should move the user's lifetime total, and therefore their
      // level.
      lifetimeDelta: original.entryType === 'EARN' ? -original.delta : 0,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError({
        code: ERROR_CODES.CONFLICT,
        message: 'That entry has already been reversed',
        statusCode: 409,
      });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------

interface LedgerWrite {
  userId: string;
  delta: number;
  entryType: LedgerEntryType;
  sourceType: PointSourceType;
  sourceId: string;
  reason: string;
  metadata?: Prisma.InputJsonValue;
  reversedEntryId?: string;
  createdById?: string;
  /**
   * What this row does to *lifetime* points, which is a separate question from
   * what it does to the balance. Set only by `reverseEntry`, which is the one
   * caller that knows whether it is undoing an achievement or a purchase.
   */
  lifetimeDelta?: number;
}

function insufficientPoints(needed: number, balance: number): AppError {
  return new AppError({
    code: ERROR_CODES.INSUFFICIENT_POINTS,
    message: `You need ${needed.toLocaleString()} points and have ${balance.toLocaleString()}`,
    statusCode: 400,
  });
}

/**
 * A debit that cannot overdraw.
 *
 * The balance test lives in the WHERE clause, so checking and deducting are a
 * single statement that the database serialises. Two simultaneous spends of the
 * same points cannot both succeed: the second one blocks on the row lock, and
 * Postgres re-evaluates the condition against the committed row afterwards, so
 * it sees the reduced balance and matches nothing.
 *
 * Reading the balance back afterwards is safe because this transaction now
 * holds the row lock — nobody else can move it until we commit.
 */
async function debitWithGuard(
  tx: Prisma.TransactionClient,
  write: LedgerWrite,
): Promise<number> {
  const debited = await tx.userProfile.updateMany({
    where: { userId: write.userId, pointsBalance: { gte: -write.delta } },
    data: { pointsBalance: { increment: write.delta }, lastActiveAt: new Date() },
  });

  if (debited.count === 0) {
    throw insufficientPoints(-write.delta, await readBalance(write.userId, tx));
  }

  return readBalance(write.userId, tx);
}

/**
 * Credits and administrative adjustments. A reversal is allowed to push a
 * balance negative — clawing back points somebody has already spent is a
 * deliberate act, and hiding it behind a silent failure would be worse.
 *
 * Only an EARN moves lifetime points, because lifetime points are what levels
 * and eligibility are built on. A refund returns what you spent; it is not a
 * new achievement, and letting it count would make redeem-then-cancel a way to
 * farm levels for free.
 */
async function creditOrAdjust(
  tx: Prisma.TransactionClient,
  write: LedgerWrite,
): Promise<number> {
  const lifetimeDelta =
    write.lifetimeDelta ?? (write.entryType === 'EARN' && write.delta > 0 ? write.delta : 0);

  const profile = await tx.userProfile.update({
    where: { userId: write.userId },
    data: {
      pointsBalance: { increment: write.delta },
      ...(lifetimeDelta !== 0 ? { lifetimePoints: { increment: lifetimeDelta } } : {}),
      lastActiveAt: new Date(),
    },
    select: { pointsBalance: true },
  });
  return profile.pointsBalance;
}

async function applyLedgerEntry(
  write: LedgerWrite,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<AwardResult> {
  const run = async (tx: Prisma.TransactionClient) => {
    const balanceAfter =
      write.entryType === 'SPEND'
        ? await debitWithGuard(tx, write)
        : await creditOrAdjust(tx, write);

    const entry = await tx.pointsLedger.create({
      data: {
        userId: write.userId,
        delta: write.delta,
        balanceAfter,
        entryType: write.entryType,
        sourceType: write.sourceType,
        sourceId: write.sourceId,
        reason: write.reason,
        ...(write.metadata !== undefined ? { metadata: write.metadata } : {}),
        ...(write.reversedEntryId ? { reversedEntryId: write.reversedEntryId } : {}),
        ...(write.createdById ? { createdById: write.createdById } : {}),
      },
      select: { id: true },
    });

    return { applied: true, delta: write.delta, balance: balanceAfter, entryId: entry.id };
  };

  // Already inside a caller's transaction? Join it — nesting would deadlock.
  if (client !== prisma) return run(client as Prisma.TransactionClient);
  return prisma.$transaction(run);
}

async function readBalance(
  userId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const profile = await client.userProfile.findUnique({
    where: { userId },
    select: { pointsBalance: true },
  });
  return profile?.pointsBalance ?? 0;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface LedgerPage {
  items: {
    id: string;
    delta: number;
    balanceAfter: number;
    entryType: string;
    sourceType: string;
    sourceId: string;
    reason: string;
    createdAt: string;
  }[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function getHistory(
  userId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<LedgerPage> {
  const limit = Math.min(options.limit ?? 20, 100);

  const rows = await prisma.pointsLedger.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: items.map((row) => ({
      id: row.id,
      delta: row.delta,
      balanceAfter: row.balanceAfter,
      entryType: row.entryType,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    hasMore,
  };
}

export async function getBalance(userId: string) {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { pointsBalance: true, lifetimePoints: true, currentStreak: true },
  });

  return {
    balance: profile?.pointsBalance ?? 0,
    lifetime: profile?.lifetimePoints ?? 0,
    streak: profile?.currentStreak ?? 0,
  };
}

/**
 * Audit helper: recomputes the balance from the ledger and reports any drift
 * from the cached column. Used by the admin console and by tests.
 */
export async function verifyLedger(userId: string) {
  const [aggregate, profile] = await Promise.all([
    prisma.pointsLedger.aggregate({ where: { userId }, _sum: { delta: true } }),
    prisma.userProfile.findUnique({ where: { userId }, select: { pointsBalance: true } }),
  ]);

  const replayed = aggregate._sum.delta ?? 0;
  const cached = profile?.pointsBalance ?? 0;

  return { replayed, cached, consistent: replayed === cached, drift: cached - replayed };
}
