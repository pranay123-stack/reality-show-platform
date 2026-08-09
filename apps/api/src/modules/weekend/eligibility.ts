import type { EligibilityView, WeekendRewardsView } from '@reality/shared';
import { DEFAULT_POINT_RULES, WEEKEND_DEFAULT_REWARD_DISCLAIMER } from '@reality/shared';

/**
 * Weekend eligibility.
 *
 * Pure and dependency-free: the caller gathers the numbers, this decides what
 * they mean. That split is what makes the rules explainable to a user and
 * testable without a database.
 *
 * The interesting requirement is "legitimate engagement". Points alone are a
 * weak proxy — somebody could sit on one feature and farm it. So eligibility
 * also counts how many *different* features a person has actually used, which
 * is the difference between taking part in the show and gaming a counter.
 */

export interface EligibilityConfig {
  minPoints: number;
  minActivities: number;
  minDistinctFeatures: number;
}

export const DEFAULT_ELIGIBILITY: EligibilityConfig = {
  minPoints: 0,
  minActivities: 0,
  minDistinctFeatures: 0,
};

export interface EngagementSnapshot {
  points: number;
  /** Total participation actions across the platform. */
  activities: number;
  /** How many distinct features contributed at least one action. */
  distinctFeatures: number;
  emailVerified: boolean;
  accountStatus: string;
}

export function evaluateEligibility(
  snapshot: EngagementSnapshot,
  config: EligibilityConfig = DEFAULT_ELIGIBILITY,
): EligibilityView {
  const requirements: EligibilityView['requirements'] = [];
  const blockers: string[] = [];

  // A confirmed address is the same gate every other participation feature
  // uses; the weekend is not an exception to it.
  const verified = snapshot.emailVerified;
  requirements.push({
    key: 'verifiedEmail',
    label: 'Confirmed email address',
    met: verified,
    current: verified ? 'confirmed' : 'not confirmed',
    required: 'confirmed',
  });
  if (!verified) blockers.push('Confirm your email address.');

  const active = snapshot.accountStatus === 'ACTIVE';
  requirements.push({
    key: 'accountStatus',
    label: 'Account in good standing',
    met: active,
    current: snapshot.accountStatus.replace(/_/g, ' ').toLowerCase(),
    required: 'active',
  });
  if (!active) blockers.push('Your account cannot take part right now.');

  if (config.minPoints > 0) {
    const met = snapshot.points >= config.minPoints;
    requirements.push({
      key: 'points',
      label: 'Points earned',
      met,
      current: snapshot.points,
      required: config.minPoints,
    });
    if (!met) {
      blockers.push(
        `Earn ${(config.minPoints - snapshot.points).toLocaleString()} more points by taking part.`,
      );
    }
  }

  if (config.minActivities > 0) {
    const met = snapshot.activities >= config.minActivities;
    requirements.push({
      key: 'activities',
      label: 'Times you have taken part',
      met,
      current: snapshot.activities,
      required: config.minActivities,
    });
    if (!met) {
      blockers.push(
        `Take part ${config.minActivities - snapshot.activities} more time${
          config.minActivities - snapshot.activities === 1 ? '' : 's'
        }.`,
      );
    }
  }

  if (config.minDistinctFeatures > 0) {
    const met = snapshot.distinctFeatures >= config.minDistinctFeatures;
    requirements.push({
      key: 'distinctFeatures',
      label: 'Different parts of the show joined in with',
      met,
      current: snapshot.distinctFeatures,
      required: config.minDistinctFeatures,
    });
    if (!met) {
      blockers.push(
        `Join in with ${
          config.minDistinctFeatures - snapshot.distinctFeatures
        } more part${config.minDistinctFeatures - snapshot.distinctFeatures === 1 ? '' : 's'} of the show — predictions, polls, challenges and so on.`,
      );
    }
  }

  return {
    eligible: requirements.every((requirement) => requirement.met),
    requirements,
    blockers,
  };
}

export function parseEligibilityConfig(raw: unknown): EligibilityConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_ELIGIBILITY;
  const value = raw as Record<string, unknown>;

  const read = (key: string, fallback: number): number => {
    const candidate = value[key];
    return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
      ? Math.floor(candidate)
      : fallback;
  };

  return {
    minPoints: read('minPoints', 0),
    minActivities: read('minActivities', 0),
    minDistinctFeatures: read('minDistinctFeatures', 0),
  };
}

/**
 * What a round may say it offers.
 *
 * The default is deliberately narrow: on-air recognition and points. An
 * in-person opportunity appears **only** when authorised production staff have
 * enabled it for this specific round, and even then the disclaimer travels with
 * it. This function is the single place that decision is expressed, so no
 * screen can describe a reward the round has not actually been authorised for.
 */
export function describeRewards(round: {
  allowPhysicalRewards: boolean;
  rewardDisclaimer: string | null;
}): WeekendRewardsView {
  const authorised = round.allowPhysicalRewards === true;

  return {
    onAirRecognition: true,
    pointsForSubmitting: DEFAULT_POINT_RULES.WEEKEND_SUBMISSION,
    pointsForShortlist: DEFAULT_POINT_RULES.WEEKEND_SHORTLISTED,
    pointsForSelection: DEFAULT_POINT_RULES.WEEKEND_SELECTED,
    inPersonOpportunity: authorised,
    // When physical rewards are off, the standard "nothing in person is
    // offered" wording always wins — including over whatever a producer may
    // have typed into the disclaimer field. A round cannot imply an
    // appearance it has not been authorised for, even by accident.
    disclaimer: authorised
      ? (round.rewardDisclaimer ?? WEEKEND_DEFAULT_REWARD_DISCLAIMER)
      : WEEKEND_DEFAULT_REWARD_DISCLAIMER,
  };
}

/**
 * `VIRTUAL_AUDIENCE` is the one participation type that implies being there in
 * person, so it may only be offered on a round that has been authorised.
 */
export const PHYSICAL_PARTICIPATION_TYPES = ['VIRTUAL_AUDIENCE'] as const;

export function requiresPhysicalAuthorisation(types: readonly string[]): boolean {
  return types.some((type) =>
    (PHYSICAL_PARTICIPATION_TYPES as readonly string[]).includes(type),
  );
}
