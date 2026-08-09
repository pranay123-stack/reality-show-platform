import { ROLES, type Role } from '@reality/shared';

/**
 * Permission catalogue.
 *
 * Ordinary participation (voting, predicting, submitting) needs no permission —
 * it is available to any authenticated, active USER. Permissions exist only for
 * operator capabilities, which is why the USER set is empty.
 */
export const PERMISSIONS = {
  // Moderation
  CHALLENGE_MODERATE: 'challenge.moderate',
  SUBMISSION_MODERATE: 'submission.moderate',
  REPORT_RESOLVE: 'report.resolve',
  CONTENT_HIDE: 'content.hide',
  USER_WARN: 'user.warn',
  DUPLICATE_REVIEW: 'duplicate.review',

  // Show operations
  SHOW_MANAGE: 'show.manage',
  EPISODE_MANAGE: 'episode.manage',
  EVENT_MANAGE: 'event.manage',
  CONTESTANT_MANAGE: 'contestant.manage',
  HEAT_INSPECT: 'heat.inspect',

  PREDICTION_CREATE: 'prediction.create',
  PREDICTION_ACTIVATE: 'prediction.activate',
  PREDICTION_CLOSE: 'prediction.close',
  PREDICTION_RESOLVE: 'prediction.resolve',
  PREDICTION_CANCEL: 'prediction.cancel',

  POLL_CREATE: 'poll.create',
  POLL_ACTIVATE: 'poll.activate',
  POLL_PAUSE: 'poll.pause',
  POLL_CLOSE: 'poll.close',
  POLL_PUBLISH: 'poll.publish',

  PERSPECTIVE_MANAGE: 'perspective.manage',
  CHALLENGE_CYCLE_MANAGE: 'challenge.cycle.manage',
  CHALLENGE_SELECT: 'challenge.select',
  CHALLENGE_EXECUTE: 'challenge.execute',

  NOMINATION_MANAGE: 'nomination.manage',
  EVICTION_MANAGE: 'eviction.manage',
  ROUND_PUBLISH: 'round.publish',
  /// Publishing the show's *official* outcome, as distinct from the audience result.
  OFFICIAL_OUTCOME_PUBLISH: 'official.publish',

  KITCHEN_MANAGE: 'kitchen.manage',
  WEEKEND_MANAGE: 'weekend.manage',
  WEEKEND_SELECT: 'weekend.select',
  /// Gate for enabling physical/appearance rewards on a weekend round.
  WEEKEND_PHYSICAL_REWARDS: 'weekend.physical_rewards',

  ANALYTICS_VIEW: 'analytics.view',

  // Leaderboards. Inspecting a ranking is a moderation-grade question ("why is
  // this account top?"), rebuilding the cache is routine operations, and
  // freezing a board settles who won — so the three sit at three levels.
  LEADERBOARD_INSPECT: 'leaderboard.inspect',
  LEADERBOARD_REBUILD: 'leaderboard.rebuild',
  COMMUNITY_MANAGE: 'community.manage',

  // Reward economy. Split three ways so the roles differ meaningfully:
  // moderators look, producers run the catalogue, admins hold the destructive
  // and financial controls.
  REWARD_VIEW: 'reward.view',
  REWARD_MANAGE: 'reward.manage',
  /// Authorising a PHYSICAL or EXPERIENCE reward — the same control weekend
  /// participation uses for an in-person opportunity.
  REWARD_PHYSICAL_AUTHORISE: 'reward.physical_authorise',

  // Administration
  USER_MANAGE: 'user.manage',
  ROLE_ASSIGN: 'role.assign',
  POINTS_CONFIGURE: 'points.configure',
  POINTS_REVERSE: 'points.reverse',
  /// Retiring a reward and force-cancelling a redemption both take something
  /// away from a user who already earned it, so they sit with admins.
  REWARD_RETIRE: 'reward.retire',
  REWARD_FORCE_CANCEL: 'reward.force_cancel',
  /// Freezing a board decides a standing, and exporting one hands out a list of
  /// users. Both stay with admins.
  LEADERBOARD_FREEZE: 'leaderboard.freeze',
  LEADERBOARD_EXPORT: 'leaderboard.export',
  AUDIT_VIEW: 'audit.view',
  SYSTEM_CONFIGURE: 'system.configure',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const MODERATOR_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.CHALLENGE_MODERATE,
  PERMISSIONS.SUBMISSION_MODERATE,
  PERMISSIONS.REPORT_RESOLVE,
  PERMISSIONS.CONTENT_HIDE,
  PERMISSIONS.USER_WARN,
  PERMISSIONS.DUPLICATE_REVIEW,
  PERMISSIONS.REWARD_VIEW,
  PERMISSIONS.LEADERBOARD_INSPECT,
];

const PRODUCER_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.SHOW_MANAGE,
  PERMISSIONS.EPISODE_MANAGE,
  PERMISSIONS.EVENT_MANAGE,
  PERMISSIONS.CONTESTANT_MANAGE,
  PERMISSIONS.HEAT_INSPECT,
  PERMISSIONS.PREDICTION_CREATE,
  PERMISSIONS.PREDICTION_ACTIVATE,
  PERMISSIONS.PREDICTION_CLOSE,
  PERMISSIONS.PREDICTION_RESOLVE,
  PERMISSIONS.PREDICTION_CANCEL,
  PERMISSIONS.POLL_CREATE,
  PERMISSIONS.POLL_ACTIVATE,
  PERMISSIONS.POLL_PAUSE,
  PERMISSIONS.POLL_CLOSE,
  PERMISSIONS.POLL_PUBLISH,
  PERMISSIONS.PERSPECTIVE_MANAGE,
  PERMISSIONS.CHALLENGE_CYCLE_MANAGE,
  PERMISSIONS.CHALLENGE_SELECT,
  PERMISSIONS.CHALLENGE_EXECUTE,
  PERMISSIONS.NOMINATION_MANAGE,
  PERMISSIONS.EVICTION_MANAGE,
  PERMISSIONS.ROUND_PUBLISH,
  PERMISSIONS.OFFICIAL_OUTCOME_PUBLISH,
  PERMISSIONS.KITCHEN_MANAGE,
  PERMISSIONS.WEEKEND_MANAGE,
  PERMISSIONS.WEEKEND_SELECT,
  PERMISSIONS.WEEKEND_PHYSICAL_REWARDS,
  PERMISSIONS.ANALYTICS_VIEW,
  PERMISSIONS.REWARD_MANAGE,
  PERMISSIONS.REWARD_PHYSICAL_AUTHORISE,
  PERMISSIONS.LEADERBOARD_REBUILD,
  PERMISSIONS.COMMUNITY_MANAGE,
];

const ADMIN_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.USER_MANAGE,
  PERMISSIONS.ROLE_ASSIGN,
  PERMISSIONS.POINTS_CONFIGURE,
  PERMISSIONS.POINTS_REVERSE,
  PERMISSIONS.REWARD_RETIRE,
  PERMISSIONS.REWARD_FORCE_CANCEL,
  PERMISSIONS.LEADERBOARD_FREEZE,
  PERMISSIONS.LEADERBOARD_EXPORT,
  PERMISSIONS.AUDIT_VIEW,
  PERMISSIONS.SYSTEM_CONFIGURE,
];

/**
 * Materialised inheritance: each role owns the full expanded set, so a
 * permission check is one indexed lookup with no recursion.
 */
export const ROLE_PERMISSIONS: Record<Role, PermissionKey[]> = {
  USER: [],
  MODERATOR: [...MODERATOR_PERMISSIONS],
  PRODUCER: [...MODERATOR_PERMISSIONS, ...PRODUCER_PERMISSIONS],
  ADMIN: [...MODERATOR_PERMISSIONS, ...PRODUCER_PERMISSIONS, ...ADMIN_PERMISSIONS],
};

export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS);

export const ROLE_LABELS: Record<Role, string> = {
  USER: 'Viewer',
  MODERATOR: 'Moderator',
  PRODUCER: 'Producer',
  ADMIN: 'Administrator',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  USER: 'Takes part: votes, predicts, submits challenges and redeems rewards.',
  MODERATOR: 'Reviews user-generated content and handles abuse reports.',
  PRODUCER: 'Runs the show: polls, predictions, rounds, kitchen and weekend selection.',
  ADMIN: 'Full administration including users, roles, points configuration and audit logs.',
};

/** Static check used by tests and by the in-memory fallback when Redis is cold. */
export function roleHasPermission(role: Role, permission: PermissionKey): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsForRole(role: Role): PermissionKey[] {
  return ROLE_PERMISSIONS[role];
}

export { ROLES };
