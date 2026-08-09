/**
 * Challenge ranking.
 *
 * Which challenges reach the top of a cycle is a *product* decision, so it is
 * configurable per cycle (`ChallengeCycle.rankingConfig`) rather than hard-coded,
 * and it lives in a pure function so it can be unit-tested and explained.
 *
 * Votes dominate by default. Recency exists so a challenge submitted in the last
 * hour of a cycle is not automatically buried by one that had three days to
 * gather votes. Author trust is a small nudge, never a gate — a first-time
 * submitter with the best idea must still be able to win.
 */

export interface RankingWeights {
  votes: number;
  recency: number;
  authorTrust: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  votes: 0.7,
  recency: 0.2,
  authorTrust: 0.1,
};

export interface RankableChallenge {
  id: string;
  voteCount: number;
  createdAt: Date;
  /** Author's lifetime points, used as a weak proxy for a track record. */
  authorLifetimePoints: number;
}

export interface RankedChallenge {
  id: string;
  score: number;
  rank: number;
  breakdown: { votes: number; recency: number; authorTrust: number };
}

export interface RankingContext {
  cycleOpensAt: Date;
  cycleClosesAt: Date;
  weights?: Partial<RankingWeights>;
}

export function rankChallenges(
  challenges: RankableChallenge[],
  context: RankingContext,
): RankedChallenge[] {
  if (challenges.length === 0) return [];

  const weights: RankingWeights = { ...DEFAULT_RANKING_WEIGHTS, ...(context.weights ?? {}) };

  const peakVotes = Math.max(...challenges.map((challenge) => challenge.voteCount), 0);
  const peakTrust = Math.max(
    ...challenges.map((challenge) => challenge.authorLifetimePoints),
    0,
  );

  const opens = context.cycleOpensAt.getTime();
  const closes = context.cycleClosesAt.getTime();
  const span = Math.max(1, closes - opens);

  const scored = challenges.map((challenge) => {
    // Square root keeps a runaway favourite from flattening everyone else,
    // matching how contestant heat normalises.
    const votes = peakVotes > 0 ? Math.sqrt(challenge.voteCount / peakVotes) : 0;

    const age = clamp((challenge.createdAt.getTime() - opens) / span, 0, 1);
    const recency = age;

    const authorTrust = peakTrust > 0 ? Math.sqrt(challenge.authorLifetimePoints / peakTrust) : 0;

    const totalWeight = weights.votes + weights.recency + weights.authorTrust;
    const score =
      totalWeight > 0
        ? (votes * weights.votes + recency * weights.recency + authorTrust * weights.authorTrust) /
          totalWeight
        : 0;

    return {
      id: challenge.id,
      score: round4(score),
      breakdown: { votes: round4(votes), recency: round4(recency), authorTrust: round4(authorTrust) },
      // Kept for deterministic tie-breaking below.
      voteCount: challenge.voteCount,
      createdAt: challenge.createdAt.getTime(),
    };
  });

  // Ties break on raw votes, then on who submitted first — never randomly, so a
  // recomputed ranking is reproducible.
  scored.sort(
    (a, b) => b.score - a.score || b.voteCount - a.voteCount || a.createdAt - b.createdAt,
  );

  return scored.map((entry, index) => ({
    id: entry.id,
    score: entry.score,
    rank: index + 1,
    breakdown: entry.breakdown,
  }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
