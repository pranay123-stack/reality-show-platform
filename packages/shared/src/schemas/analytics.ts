import { z } from 'zod';

import { idSchema } from './common';

/**
 * Product analytics.
 *
 * Three rules shape everything here:
 *
 *  1. **Observation only.** Nothing in this module may change what the platform
 *     does. Recording an event never fails the action that produced it, never
 *     blocks it, and never appears in its result.
 *  2. **Dashboards read aggregates, never the event log.** A chart that scans
 *     millions of raw rows — or worse, the tables serving a live show — is an
 *     outage waiting for a busy night.
 *  3. **Minimal identity.** An event carries a name, a subject, a time and a
 *     small bag of non-identifying context. Never a credential, an address, or
 *     free-form user text.
 */

// ---------------------------------------------------------------------------
// The event taxonomy
// ---------------------------------------------------------------------------

export const ANALYTICS_EVENTS = {
  // Lifecycle
  signup: { category: 'lifecycle', label: 'Signed up' },
  login: { category: 'lifecycle', label: 'Signed in' },
  logout: { category: 'lifecycle', label: 'Signed out' },
  session_started: { category: 'lifecycle', label: 'Session started' },

  // Engagement — predictions
  prediction_viewed: { category: 'prediction', label: 'Viewed a prediction' },
  prediction_submitted: { category: 'prediction', label: 'Submitted a prediction' },
  prediction_correct: { category: 'prediction', label: 'Predicted correctly' },

  // Engagement — challenges
  challenge_created: { category: 'challenge', label: 'Created a challenge' },
  challenge_voted: { category: 'challenge', label: 'Voted on a challenge' },
  challenge_selected: { category: 'challenge', label: 'Had a challenge selected' },

  // Engagement — polls and perspectives
  poll_viewed: { category: 'poll', label: 'Viewed a poll' },
  poll_voted: { category: 'poll', label: 'Voted in a poll' },
  perspective_voted: { category: 'perspective', label: 'Voted on a perspective' },

  // Engagement — house features
  kitchen_voted: { category: 'kitchen', label: 'Voted on a kitchen decision' },
  weekend_submitted: { category: 'weekend', label: 'Entered a weekend round' },

  // Economy
  reward_redeemed: { category: 'reward', label: 'Redeemed a reward' },
  leaderboard_viewed: { category: 'leaderboard', label: 'Viewed the leaderboard' },

  // Contestants
  contestant_viewed: { category: 'contestant', label: 'Viewed a contestant' },
  heat_viewed: { category: 'contestant', label: 'Viewed a heat chart' },
  trending_contestant: { category: 'contestant', label: 'Appeared as trending' },
} as const satisfies Record<string, { category: AnalyticsCategory; label: string }>;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;
export const ANALYTICS_EVENT_NAMES = Object.keys(ANALYTICS_EVENTS) as AnalyticsEventName[];

export type AnalyticsCategory =
  | 'lifecycle'
  | 'prediction'
  | 'challenge'
  | 'poll'
  | 'perspective'
  | 'kitchen'
  | 'weekend'
  | 'reward'
  | 'leaderboard'
  | 'contestant';

/**
 * Events a browser may report.
 *
 * Deliberately only the ones a server cannot observe: what somebody *looked at*.
 * Everything with a consequence — a vote, a redemption, a submission — is
 * recorded server-side from the action itself, so a client cannot inflate the
 * numbers that matter by posting them.
 */
export const CLIENT_REPORTABLE_EVENTS = [
  'prediction_viewed',
  'poll_viewed',
  'leaderboard_viewed',
  'contestant_viewed',
  'heat_viewed',
] as const satisfies readonly AnalyticsEventName[];

export type ClientReportableEvent = (typeof CLIENT_REPORTABLE_EVENTS)[number];

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export const ANALYTICS_METRICS = [
  'dau',
  'wau',
  'mau',
  'new_users',
  'sessions',
  'avg_session_seconds',
  'retention_d1',
  'retention_d7',
  'prediction_participation',
  'poll_participation',
  'challenge_participation',
  'perspective_participation',
  'kitchen_participation',
  'weekend_participation',
  'reward_redemptions',
  'points_earned',
  'points_spent',
  'weekend_conversion',
  'feature_adoption',
] as const;
export type AnalyticsMetric = (typeof ANALYTICS_METRICS)[number];

export const METRIC_LABELS: Record<AnalyticsMetric, string> = {
  dau: 'Daily active',
  wau: 'Weekly active',
  mau: 'Monthly active',
  new_users: 'New accounts',
  sessions: 'Sessions',
  avg_session_seconds: 'Average session',
  retention_d1: 'Next-day return',
  retention_d7: 'Seven-day return',
  prediction_participation: 'Predictions made',
  poll_participation: 'Poll votes',
  challenge_participation: 'Challenge votes',
  perspective_participation: 'Perspective votes',
  kitchen_participation: 'Kitchen votes',
  weekend_participation: 'Weekend entries',
  reward_redemptions: 'Redemptions',
  points_earned: 'Points earned',
  points_spent: 'Points spent',
  weekend_conversion: 'Weekend conversion',
  feature_adoption: 'Feature adoption',
};

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * Client ingest.
 *
 * `properties` is a small, flat, string-keyed bag. The service strips anything
 * that looks like a credential regardless, but keeping the shape narrow at the
 * boundary means far less has to be stripped.
 */
export const trackEventSchema = z.object({
  name: z.enum(CLIENT_REPORTABLE_EVENTS),
  /** The prediction / poll / contestant being looked at. */
  entityId: idSchema.optional(),
  properties: z.record(z.union([z.string().max(120), z.number(), z.boolean()])).optional(),
});

export const trackBatchSchema = z.object({
  // Batched so a page that renders ten cards is one request, not ten.
  events: z.array(trackEventSchema).min(1).max(20),
});
export type TrackBatchInput = z.infer<typeof trackBatchSchema>;

export const analyticsRangeSchema = z.object({
  /** Inclusive, midnight UTC. Defaults to the last 30 days. */
  days: z.coerce.number().int().min(1).max(365).default(30),
  metric: z.enum(ANALYTICS_METRICS).optional(),
});
export type AnalyticsRangeInput = z.infer<typeof analyticsRangeSchema>;

export const rebuildAnalyticsSchema = z.object({
  /** How many days back to recompute. */
  days: z.coerce.number().int().min(1).max(180).default(30),
});

export const analyticsPrivacySchema = z.object({
  optOut: z.boolean(),
});

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface TrendPoint {
  date: string;
  value: number;
  uniqueUsers?: number;
}

export interface MetricSummary {
  metric: AnalyticsMetric;
  label: string;
  /** Most recent value. */
  value: number;
  /** Change against the equivalent earlier window, as a percentage. */
  changePercent: number | null;
  /** Rendering hint: a duration and a percentage are not plain counts. */
  format: 'count' | 'percent' | 'duration';
  series: TrendPoint[];
}

export interface FunnelStep {
  key: string;
  label: string;
  users: number;
  /** Share of the first step, 0–100. */
  ofStart: number;
  /** Share of the previous step, 0–100. */
  ofPrevious: number;
}

export interface FeatureUsage {
  feature: string;
  label: string;
  users: number;
  events: number;
  /** Share of active users who touched this feature, 0–100. */
  adoption: number;
}

export interface ContestantTrend {
  contestantId: string;
  displayName: string;
  views: number;
  heatViews: number;
  heatScore: number;
  heatTrend: string;
}

export interface AnalyticsOverviewView {
  generatedAt: string;
  /** The day the newest snapshot describes. */
  asOf: string | null;
  rangeDays: number;
  /** Null until the first aggregation pass has run. */
  stale: boolean;
  summary: MetricSummary[];
  engagementFunnel: FunnelStep[];
  featureUsage: FeatureUsage[];
  contestantTrends: ContestantTrend[];
  economy: {
    pointsEarned: TrendPoint[];
    pointsSpent: TrendPoint[];
    redemptions: TrendPoint[];
  };
  participation: TrendPoint[];
  /**
   * How many accounts are excluded from every number above.
   *
   * Surfaced rather than hidden: an opted-out user produces no event at all, so
   * a reader has to know the size of the gap to judge the figures.
   */
  privacy: { optedOut: number; totalUsers: number; coveragePercent: number };
}
