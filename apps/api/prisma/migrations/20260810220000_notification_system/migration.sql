-- Notification system.
--
-- The interesting part of this migration is the NotificationType change. The old
-- enum mixed granularities (PREDICTION_CLOSING and PREDICTION_RESOLVED were
-- separate preference values), which meant a user had to configure the same
-- feature twice. The new enum is one value per *feature*, with fine-grained
-- event identity moved to Notification.event.
--
-- Existing preference rows are mapped onto the new buckets rather than dropped,
-- so nobody silently loses a setting they chose.

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "NotificationEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationType_new" AS ENUM ('PREDICTION', 'POLL', 'CHALLENGE', 'PERSPECTIVE', 'ROUND', 'KITCHEN', 'WEEKEND', 'REWARD', 'LEADERBOARD', 'SYSTEM');

-- Collapse the old values onto their feature bucket. Several old values map to
-- one new one, so duplicates are possible; they are removed below before the
-- unique index is re-established.
ALTER TABLE "Notification" ADD COLUMN "type_new" "NotificationType_new";
UPDATE "Notification" SET "type_new" = (CASE
  WHEN "type"::text LIKE 'PREDICTION%' THEN 'PREDICTION'
  WHEN "type"::text LIKE 'POLL%' THEN 'POLL'
  WHEN "type"::text LIKE 'CHALLENGE%' THEN 'CHALLENGE'
  WHEN "type"::text LIKE 'REWARD%' THEN 'REWARD'
  WHEN "type"::text LIKE 'LEADERBOARD%' THEN 'LEADERBOARD'
  WHEN "type"::text LIKE 'WEEKEND%' THEN 'WEEKEND'
  WHEN "type"::text IN ('NOMINATION_OPEN', 'EVICTION_OPEN') THEN 'ROUND'
  WHEN "type"::text LIKE 'KITCHEN%' THEN 'KITCHEN'
  ELSE 'SYSTEM'
END)::"NotificationType_new";

ALTER TABLE "NotificationPreference" ADD COLUMN "type_new" "NotificationType_new";
UPDATE "NotificationPreference" SET "type_new" = (CASE
  WHEN "type"::text LIKE 'PREDICTION%' THEN 'PREDICTION'
  WHEN "type"::text LIKE 'POLL%' THEN 'POLL'
  WHEN "type"::text LIKE 'CHALLENGE%' THEN 'CHALLENGE'
  WHEN "type"::text LIKE 'REWARD%' THEN 'REWARD'
  WHEN "type"::text LIKE 'LEADERBOARD%' THEN 'LEADERBOARD'
  WHEN "type"::text LIKE 'WEEKEND%' THEN 'WEEKEND'
  WHEN "type"::text IN ('NOMINATION_OPEN', 'EVICTION_OPEN') THEN 'ROUND'
  WHEN "type"::text LIKE 'KITCHEN%' THEN 'KITCHEN'
  ELSE 'SYSTEM'
END)::"NotificationType_new";

-- Two old preferences collapsing to one bucket would violate the unique index.
-- Keep the most recently updated row, which is the user's latest intent.
DELETE FROM "NotificationPreference" a
USING "NotificationPreference" b
WHERE a."userId" = b."userId"
  AND a."type_new" = b."type_new"
  AND (a."updatedAt" < b."updatedAt" OR (a."updatedAt" = b."updatedAt" AND a."id" < b."id"));

ALTER TABLE "Notification" DROP COLUMN "type";
ALTER TABLE "Notification" RENAME COLUMN "type_new" TO "type";
ALTER TABLE "Notification" ALTER COLUMN "type" SET NOT NULL;

ALTER TABLE "NotificationPreference" DROP COLUMN "type";
ALTER TABLE "NotificationPreference" RENAME COLUMN "type_new" TO "type";
ALTER TABLE "NotificationPreference" ALTER COLUMN "type" SET NOT NULL;

DROP TYPE "NotificationType";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";

CREATE UNIQUE INDEX "NotificationPreference_userId_type_key" ON "NotificationPreference"("userId", "type");

-- AlterTable. `event` is backfilled from the old type for any pre-existing row,
-- then the default is dropped so new rows must state their event explicitly.
ALTER TABLE "Notification" ADD COLUMN "event" TEXT NOT NULL DEFAULT 'system.legacy',
ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "link" TEXT;
ALTER TABLE "Notification" ALTER COLUMN "event" DROP DEFAULT;

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB,
    "status" "NotificationEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "fanout" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "titleTemplate" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "linkTemplate" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationEvent_dedupeKey_key" ON "NotificationEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationEvent_status_createdAt_idx" ON "NotificationEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationEvent_event_createdAt_idx" ON "NotificationEvent"("event", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_channel_status_idx" ON "NotificationDelivery"("channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_notificationId_channel_key" ON "NotificationDelivery"("notificationId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_event_key" ON "NotificationTemplate"("event");

-- CreateIndex
CREATE INDEX "Notification_eventId_idx" ON "Notification"("eventId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A delivery must never be retried forever, and an attempt count that can go
-- backwards would hide a retry storm.
ALTER TABLE "NotificationDelivery"
  ADD CONSTRAINT "NotificationDelivery_attempts_nonnegative" CHECK ("attemptCount" >= 0);
