/**
 * Domain enums shared by the API and the web client.
 *
 * These are the single source of truth for status vocabularies. The Prisma schema
 * mirrors them as Postgres enums (Phase 2); a mismatch is a bug in whichever side
 * drifted, and `packages/shared/src/__tests__/enum-parity.test.ts` guards the pairing.
 */

export const ROLES = ['USER', 'MODERATOR', 'PRODUCER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** Ascending capability order — index acts as the privilege level. */
export const ROLE_RANK: Record<Role, number> = {
  USER: 0,
  MODERATOR: 1,
  PRODUCER: 2,
  ADMIN: 3,
};

export function roleAtLeast(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export const USER_STATUSES = ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'BANNED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const SHOW_STATUSES = ['UPCOMING', 'LIVE', 'PAUSED', 'ENDED'] as const;
export type ShowStatus = (typeof SHOW_STATUSES)[number];

export const EPISODE_STATUSES = ['SCHEDULED', 'LIVE', 'ENDED', 'ARCHIVED'] as const;
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];

export const CONTESTANT_STATUSES = ['ACTIVE', 'NOMINATED', 'IMMUNE', 'EVICTED', 'WINNER'] as const;
export type ContestantStatus = (typeof CONTESTANT_STATUSES)[number];

export const PREDICTION_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'OPEN',
  'CLOSED',
  'RESOLVED',
  'CANCELLED',
] as const;
export type PredictionStatus = (typeof PREDICTION_STATUSES)[number];

export const CHALLENGE_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'MODERATION',
  'APPROVED',
  'REJECTED',
  'COMMUNITY_VOTING',
  'TOP_CHALLENGES',
  'PRODUCER_REVIEW',
  'SELECTED',
  'EXECUTED',
  'COMPLETED',
] as const;
export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number];

export const CHALLENGE_CATEGORIES = [
  'PHYSICAL',
  'MENTAL',
  'CREATIVE',
  'SOCIAL',
  'FUNNY',
  'TEAMWORK',
  'ENDURANCE',
] as const;
export type ChallengeCategory = (typeof CHALLENGE_CATEGORIES)[number];

export const CHALLENGE_TARGET_TYPES = ['HOUSE', 'CONTESTANT'] as const;
export type ChallengeTargetType = (typeof CHALLENGE_TARGET_TYPES)[number];

export const PERSPECTIVE_STATUSES = ['DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED'] as const;
export type PerspectiveStatus = (typeof PERSPECTIVE_STATUSES)[number];

export const POLL_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED', 'PUBLISHED'] as const;
export type PollStatus = (typeof POLL_STATUSES)[number];

export const ROUND_STATUSES = ['DRAFT', 'OPEN', 'CLOSED', 'PUBLISHED', 'CANCELLED'] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

export const KITCHEN_DECISION_STATUSES = ['DRAFT', 'OPEN', 'CLOSED', 'FINALIZED'] as const;
export type KitchenDecisionStatus = (typeof KITCHEN_DECISION_STATUSES)[number];

export const WEEKEND_ROUND_STATUSES = [
  'OPEN',
  'SUBMIT',
  'MODERATION',
  'SHORTLIST',
  'PRODUCER_SELECTION',
  'SELECTED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type WeekendRoundStatus = (typeof WEEKEND_ROUND_STATUSES)[number];

export const WEEKEND_PARTICIPATION_TYPES = [
  'ASK_CONTESTANT',
  'VIDEO_QUESTION',
  'CHALLENGE_WINNER',
  'MINI_GAME',
  'VIRTUAL_AUDIENCE',
  'SPECIAL_INTERACTION',
] as const;
export type WeekendParticipationType = (typeof WEEKEND_PARTICIPATION_TYPES)[number];

export const SUBMISSION_STATUSES = [
  'SUBMITTED',
  'IN_MODERATION',
  'APPROVED',
  'REJECTED',
  'SHORTLISTED',
  'SELECTED',
  'COMPLETED',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const MODERATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'ESCALATED'] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

/**
 * Ledger entry types. The ledger is append-only: a mistake is corrected with a
 * `REVERSAL` row that references the original entry, never by editing it.
 */
export const LEDGER_ENTRY_TYPES = ['EARN', 'SPEND', 'REVERSAL', 'ADJUSTMENT'] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const POINT_SOURCE_TYPES = [
  'PREDICTION',
  'POLL',
  'CHALLENGE',
  'PERSPECTIVE',
  'NOMINATION',
  'EVICTION',
  'KITCHEN',
  'WEEKEND',
  'ACHIEVEMENT',
  'REWARD_REDEMPTION',
  'ADMIN',
] as const;
export type PointSourceType = (typeof POINT_SOURCE_TYPES)[number];

export const LEADERBOARD_TYPES = ['DAILY', 'WEEKLY', 'SEASON', 'FRIENDS', 'COMMUNITY'] as const;
export type LeaderboardType = (typeof LEADERBOARD_TYPES)[number];

export const REWARD_TYPES = [
  'DIGITAL_BADGE',
  'PROFILE_ITEM',
  'POINT_BOOST',
  'SHOUTOUT',
  'MERCH',
  'EXPERIENCE',
] as const;
export type RewardType = (typeof REWARD_TYPES)[number];

// Redemption states live in `schemas/rewards.ts` as REDEMPTION_STATES, next to
// the transition rules that give them meaning. Keeping a second copy here got
// them out of step with the database once already.

// Notification types, channels and the event catalogue live in
// `schemas/notifications.ts`, next to the templates and preferences that give
// them meaning. A second copy here drifted out of step once already.


export const EVENT_TYPES = [
  'TASK',
  'ARGUMENT',
  'NOMINATION',
  'EVICTION',
  'ENTRY',
  'TWIST',
  'ANNOUNCEMENT',
  'KITCHEN',
  'WEEKEND',
] as const;
export type ShowEventType = (typeof EVENT_TYPES)[number];

export const HEAT_TRENDS = ['UP', 'DOWN', 'FLAT'] as const;
export type HeatTrend = (typeof HEAT_TRENDS)[number];

export const ANALYTICS_EVENT_NAMES = [
  'signup',
  'login',
  'prediction_started',
  'prediction_submitted',
  'poll_viewed',
  'poll_voted',
  'challenge_created',
  'challenge_voted',
  'perspective_voted',
  'contestant_viewed',
  'kitchen_voted',
  'nomination_voted',
  'eviction_voted',
  'weekend_submitted',
  'reward_earned',
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];
