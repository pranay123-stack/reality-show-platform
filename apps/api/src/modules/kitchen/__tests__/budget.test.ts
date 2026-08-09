import { describe, expect, it } from 'vitest';

import { costOf, rankOptions, resolveSelection, sameSelection, type ResolvableOption } from '../budget.js';

function option(
  id: string,
  votes: number,
  unitCost: number,
  quantity: number | null = null,
  sortOrder = 0,
): ResolvableOption {
  return {
    optionId: id,
    label: id,
    unitCost,
    quantity,
    unit: quantity === null ? null : 'kg',
    voteCount: votes,
    score: votes,
    sortOrder,
  };
}

const unlimited = { winnerCount: 10, budgetUnits: 1_000_000, maxQuantity: null };

describe('resolveSelection', () => {
  it('picks the most-voted option', () => {
    const result = resolveSelection(
      [option('rice', 10, 600), option('pasta', 3, 500)],
      { ...unlimited, winnerCount: 1 },
    );

    expect(result.selected.map((line) => line.optionId)).toEqual(['rice']);
    expect(result.totalCost).toBe(600);
    expect(result.skipped[0]).toMatchObject({ optionId: 'pasta', reason: 'WINNER_LIMIT' });
  });

  it('never buys an option nobody voted for', () => {
    const result = resolveSelection([option('rice', 0, 600), option('pasta', 0, 500)], unlimited);

    expect(result.selected).toHaveLength(0);
    expect(result.totalCost).toBe(0);
    // Nothing was "skipped for budget" — nobody wanted any of it.
    expect(result.skipped).toHaveLength(0);
  });

  it('skips an option the budget cannot afford and says why', () => {
    const result = resolveSelection(
      [option('chicken', 10, 2400), option('rice', 5, 600)],
      { winnerCount: 2, budgetUnits: 1000, maxQuantity: null },
    );

    expect(result.selected.map((line) => line.optionId)).toEqual(['rice']);
    expect(result.skipped).toEqual([expect.objectContaining({ optionId: 'chicken', reason: 'BUDGET' })]);
    expect(result.totalCost).toBe(600);
    expect(result.budgetRemainingAfter).toBe(400);
  });

  it('keeps buying cheaper options after an expensive one is skipped', () => {
    const result = resolveSelection(
      [option('chicken', 10, 2400), option('rice', 8, 600), option('veg', 6, 300)],
      { winnerCount: 3, budgetUnits: 1000, maxQuantity: null },
    );

    expect(result.selected.map((line) => line.optionId)).toEqual(['rice', 'veg']);
    expect(result.totalCost).toBe(900);
  });

  it('respects a quantity ceiling', () => {
    const result = resolveSelection(
      [option('rice-6kg', 10, 900, 6), option('veg-4kg', 8, 400, 4)],
      { winnerCount: 2, budgetUnits: 100_000, maxQuantity: 8 },
    );

    expect(result.selected.map((line) => line.optionId)).toEqual(['rice-6kg']);
    expect(result.skipped[0]).toMatchObject({ optionId: 'veg-4kg', reason: 'QUANTITY' });
    expect(result.totalQuantity).toBe(6);
  });

  it('caps the number of winners independently of the budget', () => {
    const result = resolveSelection(
      [option('a', 10, 1), option('b', 9, 1), option('c', 8, 1)],
      { winnerCount: 2, budgetUnits: 1_000_000, maxQuantity: null },
    );

    expect(result.selected).toHaveLength(2);
    expect(result.skipped[0]).toMatchObject({ optionId: 'c', reason: 'WINNER_LIMIT' });
  });

  it('reports percentages against the whole vote, not just the winners', () => {
    const result = resolveSelection(
      [option('rice', 3, 100), option('pasta', 1, 100)],
      { ...unlimited, winnerCount: 1 },
    );

    expect(result.selected[0]!.percentage).toBe(75);
  });

  it('selects nothing when everything is unaffordable', () => {
    const result = resolveSelection([option('caviar', 50, 999_999)], {
      winnerCount: 1,
      budgetUnits: 10,
      maxQuantity: null,
    });

    expect(result.selected).toHaveLength(0);
    expect(result.totalCost).toBe(0);
    expect(result.budgetRemainingAfter).toBe(10);
    expect(result.skipped[0]!.reason).toBe('BUDGET');
  });

  it('handles a zero budget without going negative', () => {
    const result = resolveSelection([option('rice', 5, 1)], {
      winnerCount: 1,
      budgetUnits: 0,
      maxQuantity: null,
    });

    expect(result.selected).toHaveLength(0);
    expect(result.budgetRemainingAfter).toBe(0);
  });

  it('allows a free option even on a spent budget', () => {
    const result = resolveSelection([option('leftovers', 5, 0)], {
      winnerCount: 1,
      budgetUnits: 0,
      maxQuantity: null,
    });

    expect(result.selected.map((line) => line.optionId)).toEqual(['leftovers']);
  });
});

describe('rankOptions', () => {
  it('ranks by score, then raw votes, then the producer’s ordering', () => {
    const ranked = rankOptions([
      option('third', 5, 0, null, 2),
      option('first', 9, 0, null, 1),
      option('second', 5, 0, null, 0),
    ]);

    expect(ranked.map((o) => o.optionId)).toEqual(['first', 'second', 'third']);
  });

  it('is deterministic regardless of input order', () => {
    const options = [option('a', 4, 0, null, 0), option('b', 4, 0, null, 1)];
    expect(rankOptions(options).map((o) => o.optionId)).toEqual(
      rankOptions([...options].reverse()).map((o) => o.optionId),
    );
  });

  it('lets weighting change the ranking without touching the head count', () => {
    const weighted: ResolvableOption[] = [
      { ...option('popular', 10, 0), score: 10 },
      { ...option('weighted', 6, 0), score: 18 },
    ];

    const ranked = rankOptions(weighted);
    expect(ranked[0]!.optionId).toBe('weighted');
    expect(ranked[0]!.voteCount).toBe(6);
  });
});

describe('costOf', () => {
  it('sums unit costs', () => {
    expect(costOf([{ unitCost: 600 }, { unitCost: 900 }])).toBe(1500);
    expect(costOf([])).toBe(0);
  });
});

describe('sameSelection', () => {
  it('ignores ordering', () => {
    expect(sameSelection(['a', 'b'], ['b', 'a'])).toBe(true);
  });

  it('detects a genuine difference', () => {
    expect(sameSelection(['a', 'b'], ['a', 'c'])).toBe(false);
    expect(sameSelection(['a'], ['a', 'b'])).toBe(false);
    expect(sameSelection([], ['a'])).toBe(false);
  });
});
