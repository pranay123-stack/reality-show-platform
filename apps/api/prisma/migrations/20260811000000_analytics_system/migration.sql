-- Analytics system.
--
-- Splits the raw event log from the numbers a dashboard reads. Nothing here is
-- on a request path that serves the live show.

-- AlterTable
ALTER TABLE "AnalyticsEvent" ADD COLUMN     "dedupeKey" TEXT;

-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "analyticsOptOut" BOOLEAN NOT NULL DEFAULT false;

-- `AnalyticsDailyRollup` is replaced by `AnalyticsAggregate`, which adds a
-- dimension and a distinct-user count. The old table was never written to — no
-- code path produced a row — so there is nothing to migrate across.
DROP TABLE "AnalyticsDailyRollup";

-- CreateTable
CREATE TABLE "AnalyticsAggregate" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "metric" TEXT NOT NULL,
    "dimension" TEXT NOT NULL DEFAULT '',
    "value" DOUBLE PRECISION NOT NULL,
    "uniqueUsers" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "dau" INTEGER NOT NULL DEFAULT 0,
    "wau" INTEGER NOT NULL DEFAULT 0,
    "mau" INTEGER NOT NULL DEFAULT 0,
    "newUsers" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "avgSessionSeconds" INTEGER NOT NULL DEFAULT 0,
    "retentionD1" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retentionD7" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metrics" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsAggregate_metric_date_idx" ON "AnalyticsAggregate"("metric", "date");

-- CreateIndex
CREATE INDEX "AnalyticsAggregate_date_idx" ON "AnalyticsAggregate"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsAggregate_date_metric_dimension_key" ON "AnalyticsAggregate"("date", "metric", "dimension");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSnapshot_date_key" ON "AnalyticsSnapshot"("date");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_date_idx" ON "AnalyticsSnapshot"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsEvent_dedupeKey_key" ON "AnalyticsEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_occurredAt_name_idx" ON "AnalyticsEvent"("occurredAt", "name");

