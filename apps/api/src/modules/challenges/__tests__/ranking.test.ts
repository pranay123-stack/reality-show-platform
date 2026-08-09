import { describe, expect, it } from 'vitest';

import { rankChallenges, type RankableChallenge } from '../ranking.js';

const opens = new Date('2026-08-01T00:00:00Z');
const closes = new Date('2026-08-04T00:00:00Z');
const context = { cycleOpensAt: opens, cycleClosesAt: closes };

function challenge(
  id: string,
  voteCount: number,
  hoursAfterOpen = 0,
  authorLifetimePoints = 0,
): RankableChallenge {
  return {
    id,
    voteCount,
    createdAt: new Date(opens.getTime() + hoursAfterOpen * 3600_000),
    authorLifetimePoints,
  };
}

describe('rankChallenges', () => {
  it('returns an empty ranking for an empty cycle', () => {
    expect(rankChallenges([], context)).toEqual([]);
  });

  it('ranks by votes under the default weights', () => {
    const ranked = rankChallenges(
      [challenge('low', 5), challenge('high', 50), challenge('mid', 20)],
      context,
    );

    expect(ranked.map((entry) => entry.id)).toEqual(['high', 'mid', 'low']);
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2, 3]);
  });

  it('lets a late entry stay competitive without overturning a clear vote lead', () => {
    const ranked = rankChallenges(
      [
        challenge('early-leader', 100, 0),
        // Submitted in the final hour with a quarter of the votes.
        challenge('late-comer', 25, 71),
      ],
      context,
    );

    expect(ranked[0]!.id).toBe('early-leader');
    // Recency still pulls the late entry closer than raw votes alone would.
    expect(ranked[1]!.breakdown.recency).toBeGreaterThan(ranked[0]!.breakdown.recency);
  });

  it('treats author trust as a nudge, not a gate', () => {
    const ranked = rankChallenges(
      [
        challenge('newcomer-best-idea', 100, 0, 0),
        challenge('veteran-fewer-votes', 40, 0, 10_000),
      ],
      context,
    );

    // A first-time submitter with the most votes still wins.
    expect(ranked[0]!.id).toBe('newcomer-best-idea');
  });

  it('honours configured weights', () => {
    const votesOnly = rankChallenges(
      [challenge('a', 10, 0, 10_000), challenge('b', 20, 70, 0)],
      { ...context, weights: { votes: 1, recency: 0, authorTrust: 0 } },
    );
    expect(votesOnly[0]!.id).toBe('b');

    const trustOnly = rankChallenges(
      [challenge('a', 10, 0, 10_000), challenge('b', 20, 70, 0)],
      { ...context, weights: { votes: 0, recency: 0, authorTrust: 1 } },
    );
    expect(trustOnly[0]!.id).toBe('a');
  });

  it('breaks ties deterministically: votes, then who submitted first', () => {
    const first = rankChallenges(
      [challenge('later', 10, 5), challenge('earlier', 10, 1)],
      { ...context, weights: { votes: 1, recency: 0, authorTrust: 0 } },
    );
    const second = rankChallenges(
      [challenge('earlier', 10, 1), challenge('later', 10, 5)],
      { ...context, weights: { votes: 1, recency: 0, authorTrust: 0 } },
    );

    expect(first.map((entry) => entry.id)).toEqual(['earlier', 'later']);
    // Input order must not change the outcome.
    expect(second.map((entry) => entry.id)).toEqual(first.map((entry) => entry.id));
  });

  it('compresses the vote tail so a runaway favourite does not zero everyone else', () => {
    const ranked = rankChallenges([challenge('runaway', 1000), challenge('modest', 10)], context);
    // 1% of the votes still scores ~10% on the votes component.
    expect(ranked[1]!.breakdown.votes).toBeCloseTo(0.1, 2);
  });

  it('keeps every score inside 0–1', () => {
    const ranked = rankChallenges(
      [challenge('a', 0, 0, 0), challenge('b', 1e6, 72, 1e6)],
      context,
    );
    for (const entry of ranked) {
      expect(entry.score).toBeGreaterThanOrEqual(0);
      expect(entry.score).toBeLessThanOrEqual(1);
    }
  });

  it('handles a cycle where nobody has voted', () => {
    const ranked = rankChallenges([challenge('a', 0, 1), challenge('b', 0, 2)], context);
    expect(ranked).toHaveLength(2);
    expect(ranked.every((entry) => Number.isFinite(entry.score))).toBe(true);
  });
});
