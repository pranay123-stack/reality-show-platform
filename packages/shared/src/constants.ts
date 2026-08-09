/** Cross-cutting constants shared by both apps. */

export const API_PREFIX = '/api/v1';

export const SOCKET_NAMESPACE = '/live';

export const PAGINATION = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  LEADERBOARD_PAGE_SIZE: 25,
  LEADERBOARD_MAX_RANK: 100,
} as const;

/**
 * Default point values. These are *defaults only* — the authoritative values live in
 * the `PointsRule` table so producers can retune without a deploy (Phase 14).
 */
export const DEFAULT_POINT_RULES = {
  PREDICTION_PARTICIPATION: 5,
  PREDICTION_CORRECT: 50,
  POLL_PARTICIPATION: 3,
  PERSPECTIVE_PARTICIPATION: 3,
  CHALLENGE_SUBMISSION: 10,
  CHALLENGE_APPROVED: 15,
  CHALLENGE_TOP3: 75,
  CHALLENGE_SELECTED: 200,
  NOMINATION_PARTICIPATION: 4,
  EVICTION_PARTICIPATION: 4,
  KITCHEN_PARTICIPATION: 4,
  WEEKEND_SUBMISSION: 15,
  WEEKEND_SHORTLISTED: 60,
  WEEKEND_SELECTED: 250,
  DAILY_STREAK: 10,
} as const;

export type PointRuleKey = keyof typeof DEFAULT_POINT_RULES;

/** Default weights for the contestant heat formula (Phase 6, DB-overridable). */
export const DEFAULT_HEAT_WEIGHTS = {
  audienceVotes: 0.3,
  reactions: 0.15,
  profileViews: 0.1,
  contentEngagement: 0.1,
  predictionActivity: 0.15,
  challengeActivity: 0.1,
  momentum: 0.1,
} as const;

export const HEAT_SCORE_MIN = 0;
export const HEAT_SCORE_MAX = 100;

export const HEAT_WINDOWS = ['24h', '7d', 'season'] as const;
export type HeatWindow = (typeof HEAT_WINDOWS)[number];

/** Weekend / challenge text limits — also enforced by zod and by the DB. */
export const TEXT_LIMITS = {
  DISPLAY_NAME_MIN: 3,
  DISPLAY_NAME_MAX: 32,
  PASSWORD_MIN: 10,
  PASSWORD_MAX: 128,
  CHALLENGE_TITLE_MAX: 120,
  CHALLENGE_DESCRIPTION_MAX: 1000,
  QUESTION_MAX: 240,
  SUBMISSION_MAX: 800,
  BIO_MAX: 400,
} as const;

/** Copy shown wherever an audience result could be mistaken for the show's official outcome. */
export const AUDIENCE_RESULT_DISCLAIMER =
  'This is the audience result on this platform. It is not the official show outcome unless the production team publishes it as such.';
