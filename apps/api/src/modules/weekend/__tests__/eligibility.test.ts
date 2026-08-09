import { WEEKEND_DEFAULT_REWARD_DISCLAIMER } from '@reality/shared';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ELIGIBILITY,
  describeRewards,
  evaluateEligibility,
  parseEligibilityConfig,
  requiresPhysicalAuthorisation,
  type EngagementSnapshot,
} from '../eligibility.js';

const engaged: EngagementSnapshot = {
  points: 500,
  activities: 20,
  distinctFeatures: 4,
  emailVerified: true,
  accountStatus: 'ACTIVE',
};

describe('evaluateEligibility', () => {
  it('lets an engaged, verified, active user through', () => {
    const verdict = evaluateEligibility(engaged, {
      minPoints: 100,
      minActivities: 5,
      minDistinctFeatures: 3,
    });

    expect(verdict.eligible).toBe(true);
    expect(verdict.blockers).toEqual([]);
    expect(verdict.requirements.every((requirement) => requirement.met)).toBe(true);
  });

  it('always requires a confirmed email, even with no other thresholds', () => {
    const verdict = evaluateEligibility(
      { ...engaged, emailVerified: false },
      DEFAULT_ELIGIBILITY,
    );

    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers[0]).toMatch(/confirm your email/i);
  });

  it('refuses a suspended account however engaged it is', () => {
    const verdict = evaluateEligibility({ ...engaged, accountStatus: 'SUSPENDED' });
    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers.some((blocker) => /cannot take part/i.test(blocker))).toBe(true);
  });

  it('blocks on points and says exactly how many more are needed', () => {
    const verdict = evaluateEligibility({ ...engaged, points: 60 }, { ...DEFAULT_ELIGIBILITY, minPoints: 100 });

    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers[0]).toContain('40');
  });

  it('blocks on the number of times someone has taken part', () => {
    const verdict = evaluateEligibility(
      { ...engaged, activities: 2 },
      { ...DEFAULT_ELIGIBILITY, minActivities: 5 },
    );

    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers[0]).toContain('3 more times');
  });

  it('refuses someone who farmed a single feature — the anti-gaming rule', () => {
    // Plenty of points and actions, but every one of them from one feature.
    const farmer: EngagementSnapshot = {
      points: 10_000,
      activities: 400,
      distinctFeatures: 1,
      emailVerified: true,
      accountStatus: 'ACTIVE',
    };

    const verdict = evaluateEligibility(farmer, {
      minPoints: 100,
      minActivities: 5,
      minDistinctFeatures: 3,
    });

    expect(verdict.eligible).toBe(false);
    const failed = verdict.requirements.find((requirement) => !requirement.met);
    expect(failed?.key).toBe('distinctFeatures');
    expect(verdict.blockers[0]).toMatch(/2 more parts/i);
  });

  it('lets a modest but genuinely broad participant through where a farmer fails', () => {
    const broad: EngagementSnapshot = {
      points: 120,
      activities: 6,
      distinctFeatures: 4,
      emailVerified: true,
      accountStatus: 'ACTIVE',
    };

    expect(
      evaluateEligibility(broad, { minPoints: 100, minActivities: 5, minDistinctFeatures: 3 })
        .eligible,
    ).toBe(true);
  });

  it('omits a requirement that is not configured', () => {
    const verdict = evaluateEligibility(engaged, DEFAULT_ELIGIBILITY);
    const keys = verdict.requirements.map((requirement) => requirement.key);

    expect(keys).toEqual(['verifiedEmail', 'accountStatus']);
    expect(verdict.eligible).toBe(true);
  });

  it('reports every failure at once rather than one at a time', () => {
    const verdict = evaluateEligibility(
      { points: 0, activities: 0, distinctFeatures: 0, emailVerified: false, accountStatus: 'SUSPENDED' },
      { minPoints: 100, minActivities: 5, minDistinctFeatures: 3 },
    );

    expect(verdict.blockers).toHaveLength(5);
  });
});

describe('parseEligibilityConfig', () => {
  it('reads a stored config', () => {
    expect(parseEligibilityConfig({ minPoints: 100, minActivities: 3, minDistinctFeatures: 2 })).toEqual({
      minPoints: 100,
      minActivities: 3,
      minDistinctFeatures: 2,
    });
  });

  it('falls back to no thresholds for anything malformed', () => {
    for (const input of [null, undefined, 'nonsense', [], { minPoints: -5 }, { minPoints: 'ten' }]) {
      expect(parseEligibilityConfig(input)).toEqual(DEFAULT_ELIGIBILITY);
    }
  });

  it('fills in only the keys that are missing', () => {
    expect(parseEligibilityConfig({ minPoints: 50 })).toEqual({
      minPoints: 50,
      minActivities: 0,
      minDistinctFeatures: 0,
    });
  });
});

describe('describeRewards', () => {
  it('offers on-air recognition and points, and nothing in person, by default', () => {
    const rewards = describeRewards({ allowPhysicalRewards: false, rewardDisclaimer: null });

    expect(rewards.onAirRecognition).toBe(true);
    expect(rewards.inPersonOpportunity).toBe(false);
    expect(rewards.disclaimer).toBe(WEEKEND_DEFAULT_REWARD_DISCLAIMER);
    expect(rewards.disclaimer).toMatch(/no physical appearance/i);
  });

  it('ignores a promising disclaimer while physical rewards are switched off', () => {
    // A producer could type anything into this field; with the flag off, the
    // standard "nothing in person" wording must still be what users see.
    const rewards = describeRewards({
      allowPhysicalRewards: false,
      rewardDisclaimer: 'Winners will be flown to the house to meet the contestants!',
    });

    expect(rewards.inPersonOpportunity).toBe(false);
    expect(rewards.disclaimer).toBe(WEEKEND_DEFAULT_REWARD_DISCLAIMER);
    expect(rewards.disclaimer).not.toMatch(/flown|meet the contestants/i);
  });

  it('uses the production disclaimer once authorised', () => {
    const rewards = describeRewards({
      allowPhysicalRewards: true,
      rewardDisclaimer: 'Selected entries join a supervised virtual audience session.',
    });

    expect(rewards.inPersonOpportunity).toBe(true);
    expect(rewards.disclaimer).toMatch(/supervised virtual audience/i);
  });

  it('stays conservative if authorisation somehow has no disclaimer', () => {
    const rewards = describeRewards({ allowPhysicalRewards: true, rewardDisclaimer: null });
    expect(rewards.disclaimer).toBe(WEEKEND_DEFAULT_REWARD_DISCLAIMER);
  });
});

describe('requiresPhysicalAuthorisation', () => {
  it('flags the in-person participation type', () => {
    expect(requiresPhysicalAuthorisation(['VIRTUAL_AUDIENCE'])).toBe(true);
    expect(requiresPhysicalAuthorisation(['ASK_CONTESTANT', 'VIRTUAL_AUDIENCE'])).toBe(true);
  });

  it('leaves ordinary types alone', () => {
    expect(requiresPhysicalAuthorisation(['ASK_CONTESTANT', 'VIDEO_QUESTION', 'MINI_GAME'])).toBe(
      false,
    );
    expect(requiresPhysicalAuthorisation([])).toBe(false);
  });
});
