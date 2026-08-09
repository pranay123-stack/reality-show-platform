-- Kitchen Control: a first-class result entity, and the configuration the
-- decision needs to resolve itself.
--
-- `KitchenDecision.result` / `resultCost` are dropped: a single JSON blob could
-- not express the distinction this module depends on — what the audience voted
-- for versus what production actually implemented. Neither column was read by
-- any code, so nothing is lost.

ALTER TABLE "KitchenDecision" DROP COLUMN IF EXISTS "result";
ALTER TABLE "KitchenDecision" DROP COLUMN IF EXISTS "resultCost";

ALTER TABLE "KitchenDecision" ADD COLUMN "winnerCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "KitchenDecision" ADD COLUMN "participationPoints" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "KitchenDecision" ADD COLUMN "bonusPoints" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "KitchenResult" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "audienceResult" JSONB NOT NULL,
    "audienceCost" INTEGER NOT NULL DEFAULT 0,
    "publishedById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "implementedResult" JSONB,
    "implementedCost" INTEGER,
    "implementedNote" TEXT,
    "implementedById" TEXT,
    "implementedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitchenResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KitchenResult_decisionId_key" ON "KitchenResult"("decisionId");
CREATE INDEX "KitchenResult_implementedAt_idx" ON "KitchenResult"("implementedAt");

ALTER TABLE "KitchenResult" ADD CONSTRAINT "KitchenResult_decisionId_fkey"
    FOREIGN KEY ("decisionId") REFERENCES "KitchenDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
