import type {
  RedemptionState,
  RewardEligibilityView,
  RewardRequirementView,
  UserLevelView,
} from '@reality/shared';

/**
 * Reward rules — pure, dependency-free, and therefore explainable.
 *
 * The caller gathers the numbers; these functions decide what they mean. That
 * split is what lets the UI show a user exactly which requirement they are
 * short on, and lets the whole thing be tested without a database.
 */

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/**
 * Level thresholds by lifetime points.
 *
 * Widening gaps, so early levels arrive quickly enough to feel like progress
 * and later ones still mean something. Lifetime points are used rather than the
 * spendable balance: redeeming a reward should never cost you a level.
 */
export const LEVEL_THRESHOLDS = [0, 100, 300, 700, 1500, 3000, 6000, 12_000, 25_000, 50_000];

export function levelForPoints(lifetimePoints: number): number {
  const points = Math.max(0, lifetimePoints);
  let level = 1;
  for (let index = 1; index < LEVEL_THRESHOLDS.length; index += 1) {
    if (points >= LEVEL_THRESHOLDS[index]!) level = index + 1;
    else break;
  }
  return level;
}

export function describeLevel(lifetimePoints: number): UserLevelView {
  const level = levelForPoints(lifetimePoints);
  const floor = LEVEL_THRESHOLDS[level - 1] ?? 0;
  const ceiling = LEVEL_THRESHOLDS[level] ?? null;

  return {
    level,
    lifetimePoints,
    pointsIntoLevel: lifetimePoints - floor,
    pointsForNextLevel: ceiling === null ? null : ceiling - lifetimePoints,
  };
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export interface RewardRuleConfig {
  minLevel: number;
  minLifetimePoints: number;
  minActivities: number;
  minDistinctFeatures: number;
  minAccountAgeDays: number;
  requiredFeatures: string[];
}

export const NO_RULE: RewardRuleConfig = {
  minLevel: 0,
  minLifetimePoints: 0,
  minActivities: 0,
  minDistinctFeatures: 0,
  minAccountAgeDays: 0,
  requiredFeatures: [],
};

export interface RewardUserSnapshot {
  balance: number;
  lifetimePoints: number;
  activities: number;
  distinctFeatures: number;
  featuresUsed: string[];
  accountAgeDays: number;
  emailVerified: boolean;
  accountStatus: string;
}

export interface RewardContext {
  pointCost: number;
  /** Null means unlimited stock. */
  remaining: number | null;
  available: boolean;
  alreadyHeld: boolean;
}

const FEATURE_LABELS: Record<string, string> = {
  PREDICTION: 'the prediction game',
  POLL: 'a live poll',
  CHALLENGE: 'an audience challenge',
  PERSPECTIVE: 'an audience perspective',
  NOMINATION: 'a nomination round',
  EVICTION: 'an eviction round',
  KITCHEN: 'a kitchen decision',
  WEEKEND: 'weekend participation',
};

/**
 * Whether a user may redeem a reward.
 *
 * `eligible` deliberately excludes affordability and stock: qualifying for a
 * reward and being able to buy one right now are different questions, and a
 * user who is one purchase short should not be told they are "not eligible".
 */
export function evaluateRewardEligibility(
  snapshot: RewardUserSnapshot,
  rule: RewardRuleConfig,
  context: RewardContext,
): RewardEligibilityView {
  const requirements: RewardRequirementView[] = [];
  const blockers: string[] = [];

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
  if (!active) blockers.push('Your account cannot redeem rewards right now.');

  if (rule.minLevel > 0) {
    const level = levelForPoints(snapshot.lifetimePoints);
    const met = level >= rule.minLevel;
    requirements.push({
      key: 'level',
      label: 'Level',
      met,
      current: level,
      required: rule.minLevel,
    });
    if (!met) blockers.push(`Reach level ${rule.minLevel} — you are level ${level}.`);
  }

  if (rule.minLifetimePoints > 0) {
    const met = snapshot.lifetimePoints >= rule.minLifetimePoints;
    requirements.push({
      key: 'lifetimePoints',
      label: 'Points earned all-time',
      met,
      current: snapshot.lifetimePoints,
      required: rule.minLifetimePoints,
    });
    if (!met) {
      blockers.push(
        `Earn ${(rule.minLifetimePoints - snapshot.lifetimePoints).toLocaleString()} more points all-time.`,
      );
    }
  }

  if (rule.minActivities > 0) {
    const met = snapshot.activities >= rule.minActivities;
    requirements.push({
      key: 'activities',
      label: 'Times you have taken part',
      met,
      current: snapshot.activities,
      required: rule.minActivities,
    });
    if (!met) {
      const short = rule.minActivities - snapshot.activities;
      blockers.push(`Take part ${short} more time${short === 1 ? '' : 's'}.`);
    }
  }

  if (rule.minDistinctFeatures > 0) {
    const met = snapshot.distinctFeatures >= rule.minDistinctFeatures;
    requirements.push({
      key: 'distinctFeatures',
      label: 'Different parts of the show joined in with',
      met,
      current: snapshot.distinctFeatures,
      required: rule.minDistinctFeatures,
    });
    if (!met) {
      const short = rule.minDistinctFeatures - snapshot.distinctFeatures;
      blockers.push(`Join in with ${short} more part${short === 1 ? '' : 's'} of the show.`);
    }
  }

  if (rule.minAccountAgeDays > 0) {
    const met = snapshot.accountAgeDays >= rule.minAccountAgeDays;
    requirements.push({
      key: 'accountAge',
      label: 'Days since joining',
      met,
      current: snapshot.accountAgeDays,
      required: rule.minAccountAgeDays,
    });
    if (!met) {
      blockers.push(
        `Your account needs to be ${rule.minAccountAgeDays} days old — it is ${snapshot.accountAgeDays}.`,
      );
    }
  }

  for (const feature of rule.requiredFeatures) {
    const met = snapshot.featuresUsed.includes(feature);
    requirements.push({
      key: `feature:${feature}`,
      label: `Taken part in ${FEATURE_LABELS[feature] ?? feature.toLowerCase()}`,
      met,
      current: met ? 'yes' : 'not yet',
      required: 'yes',
    });
    if (!met) blockers.push(`Take part in ${FEATURE_LABELS[feature] ?? feature.toLowerCase()}.`);
  }

  const eligible = requirements.every((requirement) => requirement.met);
  const affordable = snapshot.balance >= context.pointCost;
  const inStock = context.remaining === null || context.remaining > 0;

  if (eligible && !affordable) {
    blockers.push(
      `You need ${(context.pointCost - snapshot.balance).toLocaleString()} more points to redeem this.`,
    );
  }
  if (eligible && affordable && !inStock) blockers.push('This reward is out of stock.');
  if (context.alreadyHeld) blockers.push('You have already redeemed this reward.');
  if (!context.available) blockers.push('This reward is not currently available.');

  return {
    eligible,
    affordable,
    inStock,
    alreadyHeld: context.alreadyHeld,
    requirements,
    blockers,
  };
}

// ---------------------------------------------------------------------------
// Redemption lifecycle
// ---------------------------------------------------------------------------

/**
 * REQUESTED → RESERVED → APPROVED → FULFILLED, with REJECTED, CANCELLED and
 * EXPIRED as terminal failures.
 *
 * FULFILLED is final: once a reward has actually been given, the way to undo it
 * is a deliberate, audited points adjustment — not a state change that would
 * silently claw it back.
 */
export const REDEMPTION_TRANSITIONS: Record<RedemptionState, RedemptionState[]> = {
  REQUESTED: ['RESERVED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  RESERVED: ['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  APPROVED: ['FULFILLED', 'REJECTED', 'CANCELLED'],
  FULFILLED: [],
  REJECTED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(from: RedemptionState, to: RedemptionState): boolean {
  return REDEMPTION_TRANSITIONS[from].includes(to);
}

export const TERMINAL_STATES: RedemptionState[] = ['FULFILLED', 'REJECTED', 'CANCELLED', 'EXPIRED'];

/** States that are still holding a unit of inventory. */
export const HOLDING_STATES: RedemptionState[] = ['REQUESTED', 'RESERVED', 'APPROVED'];

/**
 * Whether ending a redemption in this state should refund the points.
 *
 * Anything that never reached the user gets refunded. A fulfilled reward does
 * not, because it was actually delivered.
 */
export function shouldRefund(from: RedemptionState, to: RedemptionState): boolean {
  if (from === 'FULFILLED') return false;
  return to === 'REJECTED' || to === 'CANCELLED' || to === 'EXPIRED';
}

/** Whether ending a redemption in this state should return the held unit. */
export function shouldReleaseInventory(from: RedemptionState, to: RedemptionState): boolean {
  return HOLDING_STATES.includes(from) && TERMINAL_STATES.includes(to) && to !== 'FULFILLED';
}
