-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'MODERATOR', 'PRODUCER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'BANNED');

-- CreateEnum
CREATE TYPE "ShowStatus" AS ENUM ('UPCOMING', 'LIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "EpisodeStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContestantStatus" AS ENUM ('ACTIVE', 'NOMINATED', 'IMMUNE', 'EVICTED', 'WINNER');

-- CreateEnum
CREATE TYPE "ShowEventType" AS ENUM ('TASK', 'ARGUMENT', 'NOMINATION', 'EVICTION', 'ENTRY', 'TWIST', 'ANNOUNCEMENT', 'KITCHEN', 'WEEKEND');

-- CreateEnum
CREATE TYPE "PredictionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'MODERATION', 'APPROVED', 'REJECTED', 'COMMUNITY_VOTING', 'TOP_CHALLENGES', 'PRODUCER_REVIEW', 'SELECTED', 'EXECUTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ChallengeCategory" AS ENUM ('PHYSICAL', 'MENTAL', 'CREATIVE', 'SOCIAL', 'FUNNY', 'TEAMWORK', 'ENDURANCE');

-- CreateEnum
CREATE TYPE "ChallengeTargetType" AS ENUM ('HOUSE', 'CONTESTANT');

-- CreateEnum
CREATE TYPE "PerspectiveStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PollStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "KitchenDecisionStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'FINALIZED');

-- CreateEnum
CREATE TYPE "KitchenOptionKind" AS ENUM ('MENU', 'QUANTITY', 'INGREDIENT', 'SPECIAL');

-- CreateEnum
CREATE TYPE "WeekendRoundStatus" AS ENUM ('OPEN', 'SUBMIT', 'MODERATION', 'SHORTLIST', 'PRODUCER_SELECTION', 'SELECTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WeekendParticipationType" AS ENUM ('ASK_CONTESTANT', 'VIDEO_QUESTION', 'CHALLENGE_WINNER', 'MINI_GAME', 'VIRTUAL_AUDIENCE', 'SPECIAL_INTERACTION');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('SUBMITTED', 'IN_MODERATION', 'APPROVED', 'REJECTED', 'SHORTLISTED', 'SELECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('EARN', 'SPEND', 'REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PointSourceType" AS ENUM ('PREDICTION', 'POLL', 'CHALLENGE', 'PERSPECTIVE', 'NOMINATION', 'EVICTION', 'KITCHEN', 'WEEKEND', 'ACHIEVEMENT', 'REWARD_REDEMPTION', 'ADMIN');

-- CreateEnum
CREATE TYPE "LeaderboardType" AS ENUM ('DAILY', 'WEEKLY', 'SEASON', 'FRIENDS', 'COMMUNITY');

-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('DIGITAL_BADGE', 'PROFILE_ITEM', 'POINT_BOOST', 'SHOUTOUT', 'MERCH', 'EXPERIENCE');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('REQUESTED', 'APPROVED', 'FULFILLED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PREDICTION_CLOSING', 'PREDICTION_RESOLVED', 'POLL_STARTED', 'POLL_ENDED', 'CHALLENGE_APPROVED', 'CHALLENGE_SELECTED', 'REWARD_RECEIVED', 'LEADERBOARD_MOVEMENT', 'WEEKEND_OPEN', 'WEEKEND_SELECTION', 'NOMINATION_OPEN', 'EVICTION_OPEN', 'KITCHEN_DECISION', 'LIVE_EVENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'PUSH');

-- CreateEnum
CREATE TYPE "HeatTrend" AS ENUM ('UP', 'DOWN', 'FLAT');

-- CreateEnum
CREATE TYPE "VoteSource" AS ENUM ('AUDIENCE', 'OFFICIAL');

-- CreateEnum
CREATE TYPE "DuplicateSignalType" AS ENUM ('EMAIL_ALIAS', 'DEVICE_REUSE', 'SESSION_OVERLAP', 'PHONE_REUSE', 'BEHAVIOURAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "role" "Role" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "lastLoginAt" TIMESTAMP(3),
    "flaggedAt" TIMESTAMP(3),
    "flagReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "bio" TEXT,
    "country" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "deviceId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "label" TEXT,
    "userAgent" TEXT,
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhoneVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "relatedUserId" TEXT,
    "type" "DuplicateSignalType" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "details" JSONB,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleDefinition" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleDefinitionId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Show" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "status" "ShowStatus" NOT NULL DEFAULT 'UPCOMING',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "currencySymbol" TEXT NOT NULL DEFAULT '₹',
    "config" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Show_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "seasonId" TEXT,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "synopsis" TEXT,
    "airsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "status" "EpisodeStatus" NOT NULL DEFAULT 'SCHEDULED',
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "episodeId" TEXT,
    "type" "ShowEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "isMajor" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventContestant" (
    "eventId" TEXT NOT NULL,
    "contestantId" TEXT NOT NULL,
    "role" TEXT,

    CONSTRAINT "EventContestant_pkey" PRIMARY KEY ("eventId","contestantId")
);

-- CreateTable
CREATE TABLE "Contestant" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "seasonId" TEXT,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "tagline" TEXT,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "age" INTEGER,
    "occupation" TEXT,
    "hometown" TEXT,
    "status" "ContestantStatus" NOT NULL DEFAULT 'ACTIVE',
    "enteredAt" TIMESTAMP(3),
    "exitedAt" TIMESTAMP(3),
    "heatScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "heatTrend" "HeatTrend" NOT NULL DEFAULT 'FLAT',
    "heatUpdatedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contestant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestantMetric" (
    "id" TEXT NOT NULL,
    "contestantId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContestantMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestantHeatSnapshot" (
    "id" TEXT NOT NULL,
    "contestantId" TEXT NOT NULL,
    "heatScore" DOUBLE PRECISION NOT NULL,
    "trend" "HeatTrend" NOT NULL DEFAULT 'FLAT',
    "inputs" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestantHeatSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "episodeId" TEXT,
    "eventId" TEXT,
    "question" TEXT NOT NULL,
    "description" TEXT,
    "status" "PredictionStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "participationPoints" INTEGER NOT NULL DEFAULT 5,
    "rewardPoints" INTEGER NOT NULL DEFAULT 50,
    "createdById" TEXT,
    "entryCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionOption" (
    "id" TEXT NOT NULL,
    "predictionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "contestantId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "entryCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PredictionOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionEntry" (
    "id" TEXT NOT NULL,
    "predictionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "isCorrect" BOOLEAN,
    "awardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionResult" (
    "id" TEXT NOT NULL,
    "predictionId" TEXT NOT NULL,
    "correctOptionId" TEXT NOT NULL,
    "resolvedById" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalEntries" INTEGER NOT NULL DEFAULT 0,
    "correctEntries" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "PredictionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeCycle" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "episodeId" TEXT,
    "title" TEXT NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "topN" INTEGER NOT NULL DEFAULT 3,
    "rankingConfig" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChallengeCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudienceChallenge" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "ChallengeCategory" NOT NULL,
    "targetType" "ChallengeTargetType" NOT NULL DEFAULT 'HOUSE',
    "targetContestantId" TEXT,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'DRAFT',
    "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "moderationNotes" TEXT,
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "selectedAt" TIMESTAMP(3),
    "selectedById" TEXT,
    "executedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resultNotes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudienceChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeSubmission" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "rank" INTEGER,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ChallengeSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeVote" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cycleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallengeVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeReport" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallengeReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudiencePerspective" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "episodeId" TEXT,
    "eventId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "description" TEXT,
    "status" "PerspectiveStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3) NOT NULL,
    "totalVotes" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudiencePerspective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerspectiveOption" (
    "id" TEXT NOT NULL,
    "perspectiveId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "contestantId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "voteCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PerspectiveOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerspectiveVote" (
    "id" TEXT NOT NULL,
    "perspectiveId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerspectiveVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LivePoll" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "episodeId" TEXT,
    "question" TEXT NOT NULL,
    "description" TEXT,
    "status" "PollStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "closedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "totalVotes" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "participationPoints" INTEGER NOT NULL DEFAULT 3,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LivePoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollOption" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "contestantId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "voteCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PollOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollVote" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NominationRound" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "episodeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "RoundStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "maxVotesPerUser" INTEGER NOT NULL DEFAULT 1,
    "weighting" JSONB,
    "totalVotes" INTEGER NOT NULL DEFAULT 0,
    "audienceResult" JSONB,
    "officialOutcome" JSONB,
    "officialPublishedAt" TIMESTAMP(3),
    "officialPublishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NominationRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NominationCandidate" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "contestantId" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT true,
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "weightedScore" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "NominationCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nomination" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "contestantId" TEXT NOT NULL,
    "source" "VoteSource" NOT NULL DEFAULT 'AUDIENCE',
    "position" INTEGER,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Nomination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NominationVote" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contestantId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NominationVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvictionRound" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "episodeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "RoundStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "maxVotesPerUser" INTEGER NOT NULL DEFAULT 1,
    "voteMeaning" TEXT NOT NULL DEFAULT 'SAVE',
    "weighting" JSONB,
    "totalVotes" INTEGER NOT NULL DEFAULT 0,
    "audienceResult" JSONB,
    "officialOutcome" JSONB,
    "officialPublishedAt" TIMESTAMP(3),
    "officialPublishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvictionRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvictionCandidate" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "contestantId" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT true,
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "weightedScore" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "EvictionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvictionVote" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contestantId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvictionVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenBudget" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "totalUnits" INTEGER NOT NULL,
    "spentUnits" INTEGER NOT NULL DEFAULT 0,
    "currencySymbol" TEXT NOT NULL DEFAULT '₹',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitchenBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenDecision" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "episodeId" TEXT,
    "budgetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "status" "KitchenDecisionStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "maxSelections" INTEGER NOT NULL DEFAULT 1,
    "maxQuantity" INTEGER,
    "weighting" JSONB,
    "totalVotes" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "resultCost" INTEGER,
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitchenDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenOption" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "kind" "KitchenOptionKind" NOT NULL DEFAULT 'MENU',
    "label" TEXT NOT NULL,
    "unitCost" INTEGER NOT NULL DEFAULT 0,
    "quantity" INTEGER,
    "unit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "voteCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "KitchenOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenVote" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KitchenVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeekendParticipationRound" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "episodeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "WeekendRoundStatus" NOT NULL DEFAULT 'OPEN',
    "participationTypes" "WeekendParticipationType"[],
    "opensAt" TIMESTAMP(3) NOT NULL,
    "submissionDeadline" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "shortlistSize" INTEGER NOT NULL DEFAULT 10,
    "selectionCount" INTEGER NOT NULL DEFAULT 3,
    "eligibilityConfig" JSONB,
    "allowPhysicalRewards" BOOLEAN NOT NULL DEFAULT false,
    "rewardDisclaimer" TEXT,
    "enabledById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeekendParticipationRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeekendQuestion" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "type" "WeekendParticipationType" NOT NULL DEFAULT 'ASK_CONTESTANT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "maxLength" INTEGER NOT NULL DEFAULT 800,

    CONSTRAINT "WeekendQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeekendSubmission" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "questionId" TEXT,
    "userId" TEXT NOT NULL,
    "contestantId" TEXT,
    "participationType" "WeekendParticipationType" NOT NULL,
    "content" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "moderationNotes" TEXT,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shortlistedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeekendSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeekendSelection" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 1,
    "selectedById" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "WeekendSelection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsRule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PointsRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "entryType" "LedgerEntryType" NOT NULL DEFAULT 'EARN',
    "sourceType" "PointSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "reversedEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "RewardType" NOT NULL DEFAULT 'DIGITAL_BADGE',
    "costPoints" INTEGER NOT NULL DEFAULT 0,
    "stock" INTEGER,
    "claimed" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "oncePerUser" BOOLEAN NOT NULL DEFAULT true,
    "requiresProductionApproval" BOOLEAN NOT NULL DEFAULT false,
    "disclaimer" TEXT,
    "availableFrom" TIMESTAMP(3),
    "availableUntil" TIMESTAMP(3),
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRedemption" (
    "id" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'REQUESTED',
    "costPoints" INTEGER NOT NULL,
    "cycleKey" TEXT NOT NULL DEFAULT 'once',
    "ledgerEntryId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Leaderboard" (
    "id" TEXT NOT NULL,
    "type" "LeaderboardType" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "showId" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Leaderboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardEntry" (
    "id" TEXT NOT NULL,
    "leaderboardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "tieBreaker" TIMESTAMP(3),
    "previousRank" INTEGER,

    CONSTRAINT "LeaderboardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "push" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "anonymousId" TEXT,
    "sessionId" TEXT,
    "showId" TEXT,
    "properties" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsDailyRollup" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsDailyRollup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAction" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbuseReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbuseReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationDecision" (
    "id" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "decision" "ModerationStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_status_createdAt_idx" ON "User"("status", "createdAt");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_displayName_key" ON "UserProfile"("displayName");

-- CreateIndex
CREATE INDEX "UserProfile_pointsBalance_idx" ON "UserProfile"("pointsBalance");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_refreshTokenHash_key" ON "UserSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_revokedAt_idx" ON "UserSession"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- CreateIndex
CREATE INDEX "UserDevice_deviceHash_idx" ON "UserDevice"("deviceHash");

-- CreateIndex
CREATE UNIQUE INDEX "UserDevice_userId_deviceHash_key" ON "UserDevice"("userId", "deviceHash");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_usedAt_idx" ON "EmailVerificationToken"("userId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_usedAt_idx" ON "PasswordResetToken"("userId", "usedAt");

-- CreateIndex
CREATE INDEX "PhoneVerification_userId_verifiedAt_idx" ON "PhoneVerification"("userId", "verifiedAt");

-- CreateIndex
CREATE INDEX "PhoneVerification_phone_idx" ON "PhoneVerification"("phone");

-- CreateIndex
CREATE INDEX "AccountLink_userId_idx" ON "AccountLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountLink_provider_providerAccountId_key" ON "AccountLink"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "DuplicateSignal_userId_createdAt_idx" ON "DuplicateSignal"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "DuplicateSignal_reviewedAt_idx" ON "DuplicateSignal"("reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoleDefinition_role_key" ON "RoleDefinition"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleDefinitionId_permissionId_key" ON "RolePermission"("roleDefinitionId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "Show_slug_key" ON "Show"("slug");

-- CreateIndex
CREATE INDEX "Show_status_idx" ON "Show"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Season_showId_number_key" ON "Season"("showId", "number");

-- CreateIndex
CREATE INDEX "Episode_status_airsAt_idx" ON "Episode"("status", "airsAt");

-- CreateIndex
CREATE INDEX "Episode_isLive_idx" ON "Episode"("isLive");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_showId_number_key" ON "Episode"("showId", "number");

-- CreateIndex
CREATE INDEX "Event_showId_occurredAt_idx" ON "Event"("showId", "occurredAt");

-- CreateIndex
CREATE INDEX "Event_episodeId_occurredAt_idx" ON "Event"("episodeId", "occurredAt");

-- CreateIndex
CREATE INDEX "Event_type_occurredAt_idx" ON "Event"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "EventContestant_contestantId_idx" ON "EventContestant"("contestantId");

-- CreateIndex
CREATE INDEX "Contestant_showId_status_idx" ON "Contestant"("showId", "status");

-- CreateIndex
CREATE INDEX "Contestant_heatScore_idx" ON "Contestant"("heatScore");

-- CreateIndex
CREATE INDEX "Contestant_deletedAt_idx" ON "Contestant"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contestant_showId_slug_key" ON "Contestant"("showId", "slug");

-- CreateIndex
CREATE INDEX "ContestantMetric_metricKey_idx" ON "ContestantMetric"("metricKey");

-- CreateIndex
CREATE UNIQUE INDEX "ContestantMetric_contestantId_metricKey_key" ON "ContestantMetric"("contestantId", "metricKey");

-- CreateIndex
CREATE INDEX "ContestantHeatSnapshot_contestantId_computedAt_idx" ON "ContestantHeatSnapshot"("contestantId", "computedAt");

-- CreateIndex
CREATE INDEX "ContestantHeatSnapshot_computedAt_idx" ON "ContestantHeatSnapshot"("computedAt");

-- CreateIndex
CREATE INDEX "Prediction_showId_status_idx" ON "Prediction"("showId", "status");

-- CreateIndex
CREATE INDEX "Prediction_status_closesAt_idx" ON "Prediction"("status", "closesAt");

-- CreateIndex
CREATE INDEX "Prediction_episodeId_idx" ON "Prediction"("episodeId");

-- CreateIndex
CREATE INDEX "PredictionOption_predictionId_sortOrder_idx" ON "PredictionOption"("predictionId", "sortOrder");

-- CreateIndex
CREATE INDEX "PredictionEntry_userId_createdAt_idx" ON "PredictionEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PredictionEntry_optionId_idx" ON "PredictionEntry"("optionId");

-- CreateIndex
CREATE UNIQUE INDEX "PredictionEntry_predictionId_userId_key" ON "PredictionEntry"("predictionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PredictionResult_predictionId_key" ON "PredictionResult"("predictionId");

-- CreateIndex
CREATE INDEX "ChallengeCycle_showId_status_idx" ON "ChallengeCycle"("showId", "status");

-- CreateIndex
CREATE INDEX "ChallengeCycle_status_closesAt_idx" ON "ChallengeCycle"("status", "closesAt");

-- CreateIndex
CREATE INDEX "AudienceChallenge_showId_status_idx" ON "AudienceChallenge"("showId", "status");

-- CreateIndex
CREATE INDEX "AudienceChallenge_authorId_createdAt_idx" ON "AudienceChallenge"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "AudienceChallenge_status_voteCount_idx" ON "AudienceChallenge"("status", "voteCount");

-- CreateIndex
CREATE INDEX "AudienceChallenge_moderationStatus_idx" ON "AudienceChallenge"("moderationStatus");

-- CreateIndex
CREATE INDEX "ChallengeSubmission_cycleId_score_idx" ON "ChallengeSubmission"("cycleId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeSubmission_challengeId_cycleId_key" ON "ChallengeSubmission"("challengeId", "cycleId");

-- CreateIndex
CREATE INDEX "ChallengeVote_userId_createdAt_idx" ON "ChallengeVote"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeVote_challengeId_userId_key" ON "ChallengeVote"("challengeId", "userId");

-- CreateIndex
CREATE INDEX "ChallengeReport_status_createdAt_idx" ON "ChallengeReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeReport_challengeId_reporterId_key" ON "ChallengeReport"("challengeId", "reporterId");

-- CreateIndex
CREATE INDEX "AudiencePerspective_showId_status_idx" ON "AudiencePerspective"("showId", "status");

-- CreateIndex
CREATE INDEX "AudiencePerspective_eventId_idx" ON "AudiencePerspective"("eventId");

-- CreateIndex
CREATE INDEX "AudiencePerspective_status_closesAt_idx" ON "AudiencePerspective"("status", "closesAt");

-- CreateIndex
CREATE INDEX "PerspectiveOption_perspectiveId_sortOrder_idx" ON "PerspectiveOption"("perspectiveId", "sortOrder");

-- CreateIndex
CREATE INDEX "PerspectiveVote_userId_createdAt_idx" ON "PerspectiveVote"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PerspectiveVote_optionId_idx" ON "PerspectiveVote"("optionId");

-- CreateIndex
CREATE UNIQUE INDEX "PerspectiveVote_perspectiveId_userId_key" ON "PerspectiveVote"("perspectiveId", "userId");

-- CreateIndex
CREATE INDEX "LivePoll_showId_status_idx" ON "LivePoll"("showId", "status");

-- CreateIndex
CREATE INDEX "LivePoll_status_closesAt_idx" ON "LivePoll"("status", "closesAt");

-- CreateIndex
CREATE INDEX "LivePoll_episodeId_status_idx" ON "LivePoll"("episodeId", "status");

-- CreateIndex
CREATE INDEX "PollOption_pollId_sortOrder_idx" ON "PollOption"("pollId", "sortOrder");

-- CreateIndex
CREATE INDEX "PollVote_pollId_createdAt_idx" ON "PollVote"("pollId", "createdAt");

-- CreateIndex
CREATE INDEX "PollVote_userId_createdAt_idx" ON "PollVote"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PollVote_optionId_idx" ON "PollVote"("optionId");

-- CreateIndex
CREATE UNIQUE INDEX "PollVote_pollId_userId_key" ON "PollVote"("pollId", "userId");

-- CreateIndex
CREATE INDEX "NominationRound_showId_status_idx" ON "NominationRound"("showId", "status");

-- CreateIndex
CREATE INDEX "NominationRound_status_closesAt_idx" ON "NominationRound"("status", "closesAt");

-- CreateIndex
CREATE INDEX "NominationCandidate_roundId_voteCount_idx" ON "NominationCandidate"("roundId", "voteCount");

-- CreateIndex
CREATE UNIQUE INDEX "NominationCandidate_roundId_contestantId_key" ON "NominationCandidate"("roundId", "contestantId");

-- CreateIndex
CREATE INDEX "Nomination_roundId_source_idx" ON "Nomination"("roundId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "Nomination_roundId_contestantId_source_key" ON "Nomination"("roundId", "contestantId", "source");

-- CreateIndex
CREATE INDEX "NominationVote_roundId_userId_idx" ON "NominationVote"("roundId", "userId");

-- CreateIndex
CREATE INDEX "NominationVote_contestantId_idx" ON "NominationVote"("contestantId");

-- CreateIndex
CREATE UNIQUE INDEX "NominationVote_roundId_userId_contestantId_key" ON "NominationVote"("roundId", "userId", "contestantId");

-- CreateIndex
CREATE INDEX "EvictionRound_showId_status_idx" ON "EvictionRound"("showId", "status");

-- CreateIndex
CREATE INDEX "EvictionRound_status_closesAt_idx" ON "EvictionRound"("status", "closesAt");

-- CreateIndex
CREATE INDEX "EvictionCandidate_roundId_voteCount_idx" ON "EvictionCandidate"("roundId", "voteCount");

-- CreateIndex
CREATE UNIQUE INDEX "EvictionCandidate_roundId_contestantId_key" ON "EvictionCandidate"("roundId", "contestantId");

-- CreateIndex
CREATE INDEX "EvictionVote_roundId_userId_idx" ON "EvictionVote"("roundId", "userId");

-- CreateIndex
CREATE INDEX "EvictionVote_contestantId_idx" ON "EvictionVote"("contestantId");

-- CreateIndex
CREATE UNIQUE INDEX "EvictionVote_roundId_userId_contestantId_key" ON "EvictionVote"("roundId", "userId", "contestantId");

-- CreateIndex
CREATE INDEX "KitchenBudget_showId_periodStart_idx" ON "KitchenBudget"("showId", "periodStart");

-- CreateIndex
CREATE INDEX "KitchenDecision_showId_status_idx" ON "KitchenDecision"("showId", "status");

-- CreateIndex
CREATE INDEX "KitchenDecision_status_closesAt_idx" ON "KitchenDecision"("status", "closesAt");

-- CreateIndex
CREATE INDEX "KitchenOption_decisionId_sortOrder_idx" ON "KitchenOption"("decisionId", "sortOrder");

-- CreateIndex
CREATE INDEX "KitchenVote_decisionId_userId_idx" ON "KitchenVote"("decisionId", "userId");

-- CreateIndex
CREATE INDEX "KitchenVote_optionId_idx" ON "KitchenVote"("optionId");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenVote_decisionId_userId_optionId_key" ON "KitchenVote"("decisionId", "userId", "optionId");

-- CreateIndex
CREATE INDEX "WeekendParticipationRound_showId_status_idx" ON "WeekendParticipationRound"("showId", "status");

-- CreateIndex
CREATE INDEX "WeekendParticipationRound_status_submissionDeadline_idx" ON "WeekendParticipationRound"("status", "submissionDeadline");

-- CreateIndex
CREATE INDEX "WeekendQuestion_roundId_sortOrder_idx" ON "WeekendQuestion"("roundId", "sortOrder");

-- CreateIndex
CREATE INDEX "WeekendSubmission_roundId_status_idx" ON "WeekendSubmission"("roundId", "status");

-- CreateIndex
CREATE INDEX "WeekendSubmission_userId_createdAt_idx" ON "WeekendSubmission"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WeekendSubmission_moderationStatus_idx" ON "WeekendSubmission"("moderationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "WeekendSubmission_roundId_userId_participationType_key" ON "WeekendSubmission"("roundId", "userId", "participationType");

-- CreateIndex
CREATE UNIQUE INDEX "WeekendSelection_submissionId_key" ON "WeekendSelection"("submissionId");

-- CreateIndex
CREATE INDEX "WeekendSelection_roundId_idx" ON "WeekendSelection"("roundId");

-- CreateIndex
CREATE UNIQUE INDEX "WeekendSelection_roundId_position_key" ON "WeekendSelection"("roundId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PointsRule_key_key" ON "PointsRule"("key");

-- CreateIndex
CREATE INDEX "PointsLedger_userId_createdAt_idx" ON "PointsLedger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PointsLedger_sourceType_sourceId_idx" ON "PointsLedger"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "PointsLedger_createdAt_idx" ON "PointsLedger"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointsLedger_userId_sourceType_sourceId_reason_key" ON "PointsLedger"("userId", "sourceType", "sourceId", "reason");

-- CreateIndex
CREATE UNIQUE INDEX "Reward_code_key" ON "Reward"("code");

-- CreateIndex
CREATE INDEX "Reward_active_type_idx" ON "Reward"("active", "type");

-- CreateIndex
CREATE INDEX "RewardRedemption_status_createdAt_idx" ON "RewardRedemption"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RewardRedemption_userId_createdAt_idx" ON "RewardRedemption"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRedemption_userId_rewardId_cycleKey_key" ON "RewardRedemption"("userId", "rewardId", "cycleKey");

-- CreateIndex
CREATE INDEX "Leaderboard_type_computedAt_idx" ON "Leaderboard"("type", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Leaderboard_type_periodKey_showId_key" ON "Leaderboard"("type", "periodKey", "showId");

-- CreateIndex
CREATE INDEX "LeaderboardEntry_leaderboardId_rank_idx" ON "LeaderboardEntry"("leaderboardId", "rank");

-- CreateIndex
CREATE INDEX "LeaderboardEntry_userId_idx" ON "LeaderboardEntry"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderboardEntry_leaderboardId_userId_key" ON "LeaderboardEntry"("leaderboardId", "userId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_type_key" ON "NotificationPreference"("userId", "type");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_name_occurredAt_idx" ON "AnalyticsEvent"("name", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_occurredAt_idx" ON "AnalyticsEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_occurredAt_idx" ON "AnalyticsEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsDailyRollup_metric_date_idx" ON "AnalyticsDailyRollup"("metric", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDailyRollup_date_metric_key" ON "AnalyticsDailyRollup"("date", "metric");

-- CreateIndex
CREATE INDEX "AdminAction_actorId_createdAt_idx" ON "AdminAction"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAction_entityType_entityId_idx" ON "AdminAction"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AbuseReport_status_createdAt_idx" ON "AbuseReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AbuseReport_targetType_targetId_idx" ON "AbuseReport"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "AbuseReport_reporterId_targetType_targetId_key" ON "AbuseReport"("reporterId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "ModerationDecision_targetType_targetId_createdAt_idx" ON "ModerationDecision"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationDecision_moderatorId_createdAt_idx" ON "ModerationDecision"("moderatorId", "createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_userId_endpoint_key_key" ON "IdempotencyKey"("userId", "endpoint", "key");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "UserDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDevice" ADD CONSTRAINT "UserDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneVerification" ADD CONSTRAINT "PhoneVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountLink" ADD CONSTRAINT "AccountLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateSignal" ADD CONSTRAINT "DuplicateSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateSignal" ADD CONSTRAINT "DuplicateSignal_relatedUserId_fkey" FOREIGN KEY ("relatedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleDefinitionId_fkey" FOREIGN KEY ("roleDefinitionId") REFERENCES "RoleDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventContestant" ADD CONSTRAINT "EventContestant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventContestant" ADD CONSTRAINT "EventContestant_contestantId_fkey" FOREIGN KEY ("contestantId") REFERENCES "Contestant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contestant" ADD CONSTRAINT "Contestant_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contestant" ADD CONSTRAINT "Contestant_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestantMetric" ADD CONSTRAINT "ContestantMetric_contestantId_fkey" FOREIGN KEY ("contestantId") REFERENCES "Contestant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestantHeatSnapshot" ADD CONSTRAINT "ContestantHeatSnapshot_contestantId_fkey" FOREIGN KEY ("contestantId") REFERENCES "Contestant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionOption" ADD CONSTRAINT "PredictionOption_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "Prediction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionOption" ADD CONSTRAINT "PredictionOption_contestantId_fkey" FOREIGN KEY ("contestantId") REFERENCES "Contestant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionEntry" ADD CONSTRAINT "PredictionEntry_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "Prediction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionEntry" ADD CONSTRAINT "PredictionEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionEntry" ADD CONSTRAINT "PredictionEntry_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "PredictionOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionResult" ADD CONSTRAINT "PredictionResult_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "Prediction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionResult" ADD CONSTRAINT "PredictionResult_correctOptionId_fkey" FOREIGN KEY ("correctOptionId") REFERENCES "PredictionOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeCycle" ADD CONSTRAINT "ChallengeCycle_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeCycle" ADD CONSTRAINT "ChallengeCycle_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudienceChallenge" ADD CONSTRAINT "AudienceChallenge_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudienceChallenge" ADD CONSTRAINT "AudienceChallenge_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudienceChallenge" ADD CONSTRAINT "AudienceChallenge_targetContestantId_fkey" FOREIGN KEY ("targetContestantId") REFERENCES "Contestant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeSubmission" ADD CONSTRAINT "ChallengeSubmission_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "AudienceChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeSubmission" ADD CONSTRAINT "ChallengeSubmission_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ChallengeCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeVote" ADD CONSTRAINT "ChallengeVote_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "AudienceChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeVote" ADD CONSTRAINT "ChallengeVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeVote" ADD CONSTRAINT "ChallengeVote_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ChallengeCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeReport" ADD CONSTRAINT "ChallengeReport_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "AudienceChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeReport" ADD CONSTRAINT "ChallengeReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudiencePerspective" ADD CONSTRAINT "AudiencePerspective_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudiencePerspective" ADD CONSTRAINT "AudiencePerspective_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudiencePerspective" ADD CONSTRAINT "AudiencePerspective_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerspectiveOption" ADD CONSTRAINT "PerspectiveOption_perspectiveId_fkey" FOREIGN KEY ("perspectiveId") REFERENCES "AudiencePerspective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerspectiveOption" ADD CONSTRAINT "PerspectiveOption_contestantId_fkey" FOREIGN KEY ("contestantId") REFERENCES "Contestant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerspectiveVote" ADD CONSTRAINT "PerspectiveVote_perspectiveId_fkey" FOREIGN KEY ("perspectiveId") REFERENCES "AudiencePerspective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerspectiveVote" ADD CONSTRAINT "PerspectiveVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerspectiveVote" ADD CONSTRAINT "PerspectiveVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "PerspectiveOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivePoll" ADD CONSTRAINT "LivePoll_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivePoll" ADD CONSTRAINT "LivePoll_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "LivePoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_contestantId_fkey" FOREIGN KEY ("contestantId") REFERENCES "Contestant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "LivePoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "PollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NominationRound" ADD CONSTRAINT "NominationRound_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NominationRound" ADD CONSTRAINT "NominationRound_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NominationCandidate" ADD CONSTRAINT "NominationCandidate_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "NominationRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NominationCandidate" ADD CONSTRAINT "NominationCandidate_contestantId_fkey" FOREIGN KEY ("contestantId") REFERENCES "Contestant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nomination" ADD CONSTRAINT "Nomination_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "NominationRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nomination" ADD CONSTRAINT "Nomination_contestantId_fkey" FOREIGN KEY ("contestantId") REFERENCES "Contestant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NominationVote" ADD CONSTRAINT "NominationVote_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "NominationRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NominationVote" ADD CONSTRAINT "NominationVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NominationVote" ADD CONSTRAINT "NominationVote_contestantId_fkey" FOREIGN KEY ("contestantId") REFERENCES "Contestant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvictionRound" ADD CONSTRAINT "EvictionRound_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvictionRound" ADD CONSTRAINT "EvictionRound_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvictionCandidate" ADD CONSTRAINT "EvictionCandidate_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "EvictionRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvictionCandidate" ADD CONSTRAINT "EvictionCandidate_contestantId_fkey" FOREIGN KEY ("contestantId") REFERENCES "Contestant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvictionVote" ADD CONSTRAINT "EvictionVote_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "EvictionRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvictionVote" ADD CONSTRAINT "EvictionVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvictionVote" ADD CONSTRAINT "EvictionVote_contestantId_fkey" FOREIGN KEY ("contestantId") REFERENCES "Contestant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenBudget" ADD CONSTRAINT "KitchenBudget_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenDecision" ADD CONSTRAINT "KitchenDecision_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenDecision" ADD CONSTRAINT "KitchenDecision_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenDecision" ADD CONSTRAINT "KitchenDecision_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "KitchenBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenOption" ADD CONSTRAINT "KitchenOption_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "KitchenDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenVote" ADD CONSTRAINT "KitchenVote_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "KitchenDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenVote" ADD CONSTRAINT "KitchenVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenVote" ADD CONSTRAINT "KitchenVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "KitchenOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekendParticipationRound" ADD CONSTRAINT "WeekendParticipationRound_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekendParticipationRound" ADD CONSTRAINT "WeekendParticipationRound_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekendQuestion" ADD CONSTRAINT "WeekendQuestion_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "WeekendParticipationRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekendSubmission" ADD CONSTRAINT "WeekendSubmission_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "WeekendParticipationRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekendSubmission" ADD CONSTRAINT "WeekendSubmission_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "WeekendQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekendSubmission" ADD CONSTRAINT "WeekendSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekendSubmission" ADD CONSTRAINT "WeekendSubmission_contestantId_fkey" FOREIGN KEY ("contestantId") REFERENCES "Contestant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekendSelection" ADD CONSTRAINT "WeekendSelection_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "WeekendParticipationRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekendSelection" ADD CONSTRAINT "WeekendSelection_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "WeekendSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_reversedEntryId_fkey" FOREIGN KEY ("reversedEntryId") REFERENCES "PointsLedger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "Reward"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Leaderboard" ADD CONSTRAINT "Leaderboard_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardEntry" ADD CONSTRAINT "LeaderboardEntry_leaderboardId_fkey" FOREIGN KEY ("leaderboardId") REFERENCES "Leaderboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardEntry" ADD CONSTRAINT "LeaderboardEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAction" ADD CONSTRAINT "AdminAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbuseReport" ADD CONSTRAINT "AbuseReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
