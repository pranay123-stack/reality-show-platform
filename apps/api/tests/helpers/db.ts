import { PrismaClient } from '@prisma/client';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://reality:reality@localhost:5442/reality_test?schema=public';

process.env.DATABASE_URL = TEST_DATABASE_URL;

export const testPrisma = new PrismaClient({
  datasources: { db: { url: TEST_DATABASE_URL } },
  log: ['error'],
});

/**
 * Order matters: children before parents. Truncating with CASCADE would work
 * too, but an explicit list documents the graph and catches new tables that
 * nobody remembered to clean up.
 */
const TABLES_IN_DELETION_ORDER = [
  'IdempotencyKey',
  'ModerationDecision',
  'AbuseReport',
  'AuditLog',
  'AdminAction',
  'AnalyticsSnapshot',
  'AnalyticsAggregate',
  'AnalyticsEvent',
  'NotificationDelivery',
  'NotificationPreference',
  'Notification',
  'NotificationEvent',
  'NotificationTemplate',
  'LeaderboardEntry',
  'Leaderboard',
  'CommunityMember',
  'Community',
  'CommunityType',
  'UserConnection',
  'RewardFulfillment',
  'RewardRedemption',
  'RewardInventory',
  'RewardRule',
  'RewardCatalog',
  'PointsLedger',
  'PointsRule',
  'WeekendSelection',
  'WeekendSubmission',
  'WeekendQuestion',
  'WeekendParticipationRound',
  'KitchenVote',
  'KitchenOption',
  'KitchenResult',
  'KitchenDecision',
  'KitchenBudget',
  'RoundVoteAllowance',
  'EvictionVote',
  'EvictionCandidate',
  'EvictionRound',
  'NominationVote',
  'Nomination',
  'NominationCandidate',
  'NominationRound',
  'PollVote',
  'PollOption',
  'LivePoll',
  'PerspectiveVote',
  'PerspectiveOption',
  'AudiencePerspective',
  'ChallengeReport',
  'ChallengeVote',
  'ChallengeSubmission',
  'ChallengeCycle',
  'AudienceChallenge',
  'PredictionResult',
  'PredictionEntry',
  'PredictionOption',
  'Prediction',
  'ContestantHeatSnapshot',
  'ContestantMetric',
  'EventContestant',
  'Event',
  'Contestant',
  'Episode',
  'Season',
  'Show',
  'RolePermission',
  'Permission',
  'RoleDefinition',
  'DuplicateSignal',
  'AccountLink',
  'PhoneVerification',
  'PasswordResetToken',
  'EmailVerificationToken',
  'UserSession',
  'UserDevice',
  'UserProfile',
  'User',
];

export async function resetDatabase(): Promise<void> {
  const list = TABLES_IN_DELETION_ORDER.map((table) => `"public"."${table}"`).join(', ');
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
}

export async function disconnectTestDatabase(): Promise<void> {
  await testPrisma.$disconnect();
}

/**
 * Redis holds throttle counters and session snapshots. Without clearing it
 * between tests, a lock-out deliberately triggered by one case leaks into the
 * next and makes unrelated assertions fail. The test URL points at database 1,
 * which nothing else uses.
 */
export async function resetRedis(): Promise<void> {
  const { redis } = await import('../../src/core/redis.js');
  await redis.flushdb();
}

export async function resetAll(): Promise<void> {
  // A debounced leaderboard sync queued by a previous test would otherwise fire
  // mid-truncation and re-populate the ranking cache behind the next test's back.
  const { cancelScheduledSync } = await import('../../src/modules/leaderboards/projector.js');
  cancelScheduledSync();

  // Notification fan-outs are deliberately fire-and-forget, so one from the
  // previous test can still be writing. TRUNCATE needs an exclusive lock and
  // will deadlock against it — waiting is both correct and much easier to debug
  // than an intermittent 40P01.
  const { settleDomainEvents } = await import('../../src/core/domain-events.js');
  await settleDomainEvents();

  // Analytics writes are fire-and-forget for the same reason and carry the same
  // hazard: a pending insert deadlocks against TRUNCATE.
  const { settleAnalytics } = await import('../../src/modules/analytics/analytics.service.js');
  await settleAnalytics();

  await Promise.all([resetDatabase(), resetRedis()]);
}
