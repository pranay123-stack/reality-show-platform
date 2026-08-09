import type { LedgerEntryType } from '@prisma/client';

/**
 * Ranking rules — pure, so the interesting cases are unit tests rather than
 * things you discover when two people tie for first place.
 */

export interface ScoredUser {
  userId: string;
  points: number;
  /** First time this user scored in the period. Earlier wins a tie. */
  firstScoredAt: number;
}

export interface RankedUser extends ScoredUser {
  rank: number;
}

/**
 * Competition ranking: equal scores share a rank, and the next distinct score
 * skips the ranks the tie consumed — 1, 2, 2, 4.
 *
 * The alternative (dense ranking: 1, 2, 2, 3) hides how many people are ahead
 * of you, which is the one thing a leaderboard exists to tell you.
 *
 * Display order within a tie is still deterministic — earliest scorer first —
 * so the same board never renders in two different orders.
 */
export function assignRanks(users: ScoredUser[]): RankedUser[] {
  const sorted = [...users].sort(
    (a, b) => b.points - a.points || a.firstScoredAt - b.firstScoredAt || a.userId.localeCompare(b.userId),
  );

  const ranked: RankedUser[] = [];
  let lastPoints: number | null = null;
  let lastRank = 0;

  sorted.forEach((user, index) => {
    const rank = user.points === lastPoints ? lastRank : index + 1;
    ranked.push({ ...user, rank });
    lastPoints = user.points;
    lastRank = rank;
  });

  return ranked;
}

/**
 * A user's rank given how many people are strictly ahead.
 *
 * This is the cheap form used against Redis: `ZCOUNT (score +inf` counts the
 * users above you without materialising the board, so finding rank 40 000 of a
 * million costs the same as finding rank 3. It agrees with `assignRanks` by
 * construction — both are "one more than the number of people strictly ahead".
 */
export function rankFromAhead(usersAhead: number): number {
  return usersAhead + 1;
}

/**
 * Where a user sits as a percentage, with 100 the top.
 *
 * Percentile is reported rather than only rank because "top 5%" stays
 * meaningful as the board grows, while "rank 312" does not.
 */
export function percentileFor(rank: number, totalRanked: number): number | null {
  if (totalRanked <= 0 || rank <= 0) return null;
  if (totalRanked === 1) return 100;
  const below = totalRanked - rank;
  return Math.round((below / (totalRanked - 1)) * 100);
}

/** Positive is a climb. Null when there is nothing to compare against. */
export function movementFrom(previousRank: number | null | undefined, rank: number): number | null {
  if (previousRank == null) return null;
  return previousRank - rank;
}

/**
 * How much a ledger entry contributes to a leaderboard score.
 *
 * Leaderboards rank *earned engagement*, so:
 *
 *  - `EARN` counts, at face value.
 *  - `SPEND` counts for nothing. Redeeming a reward must not push you down the
 *    board — the same principle as Phase 14's "spending never costs you a
 *    level". A leaderboard that punished spending would make the reward
 *    economy something to avoid.
 *  - `REVERSAL` counts only when it is undoing an award. Its delta is already
 *    signed, so a clawback subtracts and a refund is ignored.
 *  - `ADJUSTMENT` counts, because an administrator correcting a genuine
 *    engagement award should move the board with it.
 *
 * The refund case is the subtle one: a refund is a positive REVERSAL, and
 * counting it would make redeem-then-cancel a way to inflate a ranking.
 */
export function leaderboardDelta(entry: {
  entryType: LedgerEntryType;
  delta: number;
}): number {
  switch (entry.entryType) {
    case 'EARN':
      return entry.delta;
    case 'ADJUSTMENT':
      return entry.delta;
    case 'REVERSAL':
      // Negative: undoing an award. Positive: refunding a spend, which never
      // counted in the first place.
      return entry.delta < 0 ? entry.delta : 0;
    case 'SPEND':
      return 0;
    default:
      return 0;
  }
}
