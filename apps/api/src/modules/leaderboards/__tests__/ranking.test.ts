import { describe, expect, it } from 'vitest';

import {
  assignRanks,
  leaderboardDelta,
  movementFrom,
  percentileFor,
  rankFromAhead,
} from '../ranking.js';

const user = (userId: string, points: number, firstScoredAt = 0) => ({
  userId,
  points,
  firstScoredAt,
});

describe('rank assignment', () => {
  it('orders by points, highest first', () => {
    const ranked = assignRanks([user('a', 100), user('b', 300), user('c', 200)]);
    expect(ranked.map((row) => [row.userId, row.rank])).toEqual([
      ['b', 1],
      ['c', 2],
      ['a', 3],
    ]);
  });

  it('gives tied users the same rank and skips the ranks they consumed', () => {
    // Competition ranking: 1, 2, 2, 4 — never 1, 2, 2, 3.
    const ranked = assignRanks([
      user('a', 500),
      user('b', 300),
      user('c', 300),
      user('d', 100),
    ]);
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 2, 4]);
  });

  it('breaks a tie for display by who scored first', () => {
    const ranked = assignRanks([user('late', 300, 2000), user('early', 300, 1000)]);
    expect(ranked.map((row) => row.userId)).toEqual(['early', 'late']);
    // Same rank despite the display order.
    expect(ranked.map((row) => row.rank)).toEqual([1, 1]);
  });

  it('is deterministic when even the tie-breaker ties', () => {
    const once = assignRanks([user('b', 100, 5), user('a', 100, 5)]);
    const twice = assignRanks([user('a', 100, 5), user('b', 100, 5)]);
    expect(once.map((row) => row.userId)).toEqual(twice.map((row) => row.userId));
  });

  it('handles a three-way tie for first', () => {
    const ranked = assignRanks([user('a', 10), user('b', 10), user('c', 10), user('d', 5)]);
    expect(ranked.map((row) => row.rank)).toEqual([1, 1, 1, 4]);
  });

  it('agrees with the count-ahead form used against Redis', () => {
    const scores = [500, 300, 300, 100];
    const ranked = assignRanks(scores.map((points, index) => user(`u${index}`, points)));

    for (const row of ranked) {
      const ahead = scores.filter((score) => score > row.points).length;
      expect(rankFromAhead(ahead)).toBe(row.rank);
    }
  });

  it('copes with an empty board', () => {
    expect(assignRanks([])).toEqual([]);
  });
});

describe('percentile', () => {
  it('puts the top of the board at 100', () => {
    expect(percentileFor(1, 100)).toBe(100);
  });

  it('puts the bottom at 0', () => {
    expect(percentileFor(100, 100)).toBe(0);
  });

  it('puts the middle near 50', () => {
    expect(percentileFor(50, 99)).toBe(50);
  });

  it('calls a lone user the top', () => {
    expect(percentileFor(1, 1)).toBe(100);
  });

  it('returns nothing for an empty board', () => {
    expect(percentileFor(1, 0)).toBeNull();
  });
});

describe('movement', () => {
  it('reports a climb as positive', () => {
    expect(movementFrom(8, 5)).toBe(3);
  });

  it('reports a slide as negative', () => {
    expect(movementFrom(2, 3)).toBe(-1);
  });

  it('reports no movement as zero, not null', () => {
    expect(movementFrom(4, 4)).toBe(0);
  });

  it('reports nothing on a first appearance', () => {
    expect(movementFrom(null, 1)).toBeNull();
    expect(movementFrom(undefined, 1)).toBeNull();
  });
});

describe('what counts towards a ranking', () => {
  it('counts an award', () => {
    expect(leaderboardDelta({ entryType: 'EARN', delta: 120 })).toBe(120);
  });

  it('ignores a spend', () => {
    // Redeeming a reward must not push a user down the board — the same
    // principle as "spending never costs you a level".
    expect(leaderboardDelta({ entryType: 'SPEND', delta: -500 })).toBe(0);
  });

  it('subtracts a clawback of an award', () => {
    expect(leaderboardDelta({ entryType: 'REVERSAL', delta: -120 })).toBe(-120);
  });

  it('ignores a refund of a spend', () => {
    // A refund is a positive REVERSAL. Counting it would make
    // redeem-then-cancel a way to inflate a ranking.
    expect(leaderboardDelta({ entryType: 'REVERSAL', delta: 500 })).toBe(0);
  });

  it('counts an administrative adjustment either way', () => {
    expect(leaderboardDelta({ entryType: 'ADJUSTMENT', delta: 50 })).toBe(50);
    expect(leaderboardDelta({ entryType: 'ADJUSTMENT', delta: -50 })).toBe(-50);
  });

  it('leaves a spend-then-refund pair with no net effect', () => {
    const spend = leaderboardDelta({ entryType: 'SPEND', delta: -300 });
    const refund = leaderboardDelta({ entryType: 'REVERSAL', delta: 300 });
    expect(spend + refund).toBe(0);
  });
});
