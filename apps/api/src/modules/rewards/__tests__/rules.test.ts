import { describe, expect, it } from 'vitest';

import {
  LEVEL_THRESHOLDS,
  NO_RULE,
  REDEMPTION_TRANSITIONS,
  canTransition,
  describeLevel,
  evaluateRewardEligibility,
  levelForPoints,
  shouldReleaseInventory,
  shouldRefund,
  type RewardContext,
  type RewardRuleConfig,
  type RewardUserSnapshot,
} from '../rules.js';

const SNAPSHOT: RewardUserSnapshot = {
  balance: 1000,
  lifetimePoints: 1000,
  activities: 20,
  distinctFeatures: 4,
  featuresUsed: ['PREDICTION', 'POLL', 'KITCHEN', 'WEEKEND'],
  accountAgeDays: 30,
  emailVerified: true,
  accountStatus: 'ACTIVE',
};

const CONTEXT: RewardContext = {
  pointCost: 100,
  remaining: 5,
  available: true,
  alreadyHeld: false,
};

function evaluate(
  snapshot: Partial<RewardUserSnapshot> = {},
  rule: Partial<RewardRuleConfig> = {},
  context: Partial<RewardContext> = {},
) {
  return evaluateRewardEligibility(
    { ...SNAPSHOT, ...snapshot },
    { ...NO_RULE, ...rule },
    { ...CONTEXT, ...context },
  );
}

describe('levels', () => {
  it('starts everyone at level 1', () => {
    expect(levelForPoints(0)).toBe(1);
    expect(levelForPoints(99)).toBe(1);
  });

  it('promotes exactly on the threshold', () => {
    expect(levelForPoints(100)).toBe(2);
    expect(levelForPoints(299)).toBe(2);
    expect(levelForPoints(300)).toBe(3);
  });

  it('caps at the last threshold', () => {
    const top = LEVEL_THRESHOLDS.length;
    expect(levelForPoints(LEVEL_THRESHOLDS.at(-1)!)).toBe(top);
    expect(levelForPoints(10_000_000)).toBe(top);
  });

  it('treats a negative balance as zero rather than throwing', () => {
    expect(levelForPoints(-500)).toBe(1);
  });

  it('describes progress towards the next level', () => {
    const level = describeLevel(150);
    expect(level).toMatchObject({ level: 2, pointsIntoLevel: 50, pointsForNextLevel: 150 });
  });

  it('reports no next level at the top', () => {
    expect(describeLevel(60_000).pointsForNextLevel).toBeNull();
  });
});

describe('eligibility', () => {
  it('passes a healthy account with no rule attached', () => {
    const result = evaluate();
    expect(result.eligible).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('blocks an unverified email', () => {
    const result = evaluate({ emailVerified: false });
    expect(result.eligible).toBe(false);
    expect(result.blockers[0]).toMatch(/Confirm your email/i);
  });

  it('blocks a suspended account', () => {
    expect(evaluate({ accountStatus: 'SUSPENDED' }).eligible).toBe(false);
  });

  it('separates affordability from eligibility', () => {
    // Being one purchase short is not the same as not qualifying, and the UI
    // needs to say so differently.
    const result = evaluate({ balance: 10 }, {}, { pointCost: 100 });
    expect(result.eligible).toBe(true);
    expect(result.affordable).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/90 more points/);
  });

  it('separates stock from eligibility', () => {
    const result = evaluate({}, {}, { remaining: 0 });
    expect(result.eligible).toBe(true);
    expect(result.inStock).toBe(false);
  });

  it('treats null stock as unlimited', () => {
    expect(evaluate({}, {}, { remaining: null }).inStock).toBe(true);
  });

  it('enforces a level requirement', () => {
    const result = evaluate({ lifetimePoints: 100 }, { minLevel: 5 });
    expect(result.eligible).toBe(false);
    expect(result.requirements.find((r) => r.key === 'level')).toMatchObject({
      met: false,
      current: 2,
      required: 5,
    });
  });

  it('enforces breadth of participation, not just volume', () => {
    // Anti-gaming: a thousand votes in one feature should not unlock a reward
    // reserved for people who join in across the show.
    const result = evaluate(
      { activities: 1000, distinctFeatures: 1, featuresUsed: ['POLL'] },
      { minDistinctFeatures: 4 },
    );
    expect(result.eligible).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/3 more parts/);
  });

  it('enforces a specific required feature', () => {
    const result = evaluate({ featuresUsed: ['POLL'] }, { requiredFeatures: ['KITCHEN'] });
    expect(result.eligible).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/kitchen decision/i);
  });

  it('enforces account age', () => {
    const result = evaluate({ accountAgeDays: 2 }, { minAccountAgeDays: 14 });
    expect(result.eligible).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/14 days old/);
  });

  it('reports every unmet requirement, not only the first', () => {
    const result = evaluate(
      { lifetimePoints: 0, activities: 0, distinctFeatures: 0, featuresUsed: [] },
      { minLevel: 3, minActivities: 10, minDistinctFeatures: 2 },
    );
    expect(result.requirements.filter((r) => !r.met)).toHaveLength(3);
  });

  it('flags a reward the user already holds', () => {
    const result = evaluate({}, {}, { alreadyHeld: true });
    expect(result.alreadyHeld).toBe(true);
    expect(result.blockers.join(' ')).toMatch(/already redeemed/i);
  });

  it('flags an unavailable reward', () => {
    expect(evaluate({}, {}, { available: false }).blockers.join(' ')).toMatch(/not currently/i);
  });
});

describe('redemption lifecycle', () => {
  it('follows the documented happy path', () => {
    expect(canTransition('REQUESTED', 'RESERVED')).toBe(true);
    expect(canTransition('RESERVED', 'APPROVED')).toBe(true);
    expect(canTransition('APPROVED', 'FULFILLED')).toBe(true);
  });

  it('refuses to skip steps', () => {
    expect(canTransition('REQUESTED', 'FULFILLED')).toBe(false);
    expect(canTransition('RESERVED', 'FULFILLED')).toBe(false);
  });

  it('refuses to run backwards', () => {
    expect(canTransition('FULFILLED', 'APPROVED')).toBe(false);
    expect(canTransition('APPROVED', 'RESERVED')).toBe(false);
  });

  it('makes every failure state terminal', () => {
    for (const state of ['FULFILLED', 'REJECTED', 'CANCELLED', 'EXPIRED'] as const) {
      expect(REDEMPTION_TRANSITIONS[state]).toEqual([]);
    }
  });

  it('refunds anything that never reached the user', () => {
    expect(shouldRefund('RESERVED', 'CANCELLED')).toBe(true);
    expect(shouldRefund('RESERVED', 'REJECTED')).toBe(true);
    expect(shouldRefund('APPROVED', 'CANCELLED')).toBe(true);
    expect(shouldRefund('RESERVED', 'EXPIRED')).toBe(true);
  });

  it('never refunds a reward that was actually delivered', () => {
    expect(shouldRefund('FULFILLED', 'CANCELLED')).toBe(false);
    expect(shouldRefund('APPROVED', 'FULFILLED')).toBe(false);
  });

  it('returns the held unit when a redemption fails', () => {
    expect(shouldReleaseInventory('RESERVED', 'CANCELLED')).toBe(true);
    expect(shouldReleaseInventory('APPROVED', 'REJECTED')).toBe(true);
  });

  it('does not return a unit that was handed over', () => {
    expect(shouldReleaseInventory('APPROVED', 'FULFILLED')).toBe(false);
    expect(shouldReleaseInventory('FULFILLED', 'CANCELLED')).toBe(false);
  });
});
