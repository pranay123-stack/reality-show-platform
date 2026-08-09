-- Reward economy.
--
-- The PointsLedger is untouched: it remains the single source of truth for
-- every point movement. This migration only adds the catalogue, its stock, its
-- eligibility rules and the fulfilment trail around it.
--
-- `Reward` becomes `RewardCatalog` and `stock`/`claimed` move into
-- `RewardInventory`, because stock is the row that concurrent redemptions
-- contend on and it needs to be lockable on its own.

-- 1. New enums -------------------------------------------------------------

CREATE TYPE "RewardCategory" AS ENUM ('DIGITAL', 'EXPERIENCE', 'PHYSICAL');
CREATE TYPE "RewardStatus" AS ENUM ('DRAFT', 'AVAILABLE', 'PAUSED', 'RETIRED');

-- RedemptionStatus gains RESERVED and EXPIRED. Replacing the type outright
-- avoids ALTER TYPE ... ADD VALUE, whose new values cannot be used in the same
-- transaction as they are added.
CREATE TYPE "RedemptionStatus_new" AS ENUM (
    'REQUESTED', 'RESERVED', 'APPROVED', 'FULFILLED', 'REJECTED', 'CANCELLED', 'EXPIRED'
);

ALTER TABLE "RewardRedemption" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "RewardRedemption"
    ALTER COLUMN "status" TYPE "RedemptionStatus_new"
    USING ("status"::text::"RedemptionStatus_new");
DROP TYPE "RedemptionStatus";
ALTER TYPE "RedemptionStatus_new" RENAME TO "RedemptionStatus";
ALTER TABLE "RewardRedemption" ALTER COLUMN "status" SET DEFAULT 'REQUESTED';

-- 2. Reward -> RewardCatalog ------------------------------------------------

ALTER TABLE "Reward" RENAME TO "RewardCatalog";
ALTER TABLE "RewardCatalog" RENAME CONSTRAINT "Reward_pkey" TO "RewardCatalog_pkey";
ALTER INDEX "Reward_code_key" RENAME TO "RewardCatalog_code_key";
DROP INDEX IF EXISTS "Reward_active_type_idx";

ALTER TABLE "RewardCatalog" RENAME COLUMN "costPoints" TO "pointCost";

ALTER TABLE "RewardCatalog" ADD COLUMN "category" "RewardCategory" NOT NULL DEFAULT 'DIGITAL';
ALTER TABLE "RewardCatalog" ADD COLUMN "status" "RewardStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "RewardCatalog" ADD COLUMN "authorisedById" TEXT;
ALTER TABLE "RewardCatalog" ADD COLUMN "authorisedAt" TIMESTAMP(3);

-- Carry the old boolean across before dropping it, and derive the category
-- from the existing reward type so nothing has to be re-entered by hand.
UPDATE "RewardCatalog" SET "status" = CASE WHEN "active" THEN 'AVAILABLE'::"RewardStatus" ELSE 'PAUSED'::"RewardStatus" END;
UPDATE "RewardCatalog" SET "category" = CASE
    WHEN "type" = 'MERCH' THEN 'PHYSICAL'::"RewardCategory"
    WHEN "type" = 'EXPERIENCE' THEN 'EXPERIENCE'::"RewardCategory"
    ELSE 'DIGITAL'::"RewardCategory"
END;

-- Anything not purely digital must be re-authorised deliberately; carrying an
-- old `active` flag into a published physical reward would defeat the gate.
UPDATE "RewardCatalog"
   SET "status" = 'DRAFT'::"RewardStatus", "requiresProductionApproval" = true
 WHERE "category" <> 'DIGITAL';

ALTER TABLE "RewardCatalog" DROP COLUMN "active";

CREATE INDEX "RewardCatalog_status_category_idx" ON "RewardCatalog"("status", "category");
CREATE INDEX "RewardCatalog_deletedAt_idx" ON "RewardCatalog"("deletedAt");

-- 3. RewardInventory --------------------------------------------------------

CREATE TABLE "RewardInventory" (
    "id" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "totalUnits" INTEGER,
    "remaining" INTEGER,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "fulfilled" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardInventory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RewardInventory_rewardId_key" ON "RewardInventory"("rewardId");

ALTER TABLE "RewardInventory" ADD CONSTRAINT "RewardInventory_rewardId_fkey"
    FOREIGN KEY ("rewardId") REFERENCES "RewardCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Move existing stock across. A null stock stays null, meaning unlimited.
INSERT INTO "RewardInventory" ("id", "rewardId", "totalUnits", "remaining", "reserved", "fulfilled", "updatedAt")
SELECT md5(random()::text || "id"), "id", "stock",
       CASE WHEN "stock" IS NULL THEN NULL ELSE GREATEST("stock" - "claimed", 0) END,
       0, "claimed", CURRENT_TIMESTAMP
  FROM "RewardCatalog";

ALTER TABLE "RewardCatalog" DROP COLUMN "stock";
ALTER TABLE "RewardCatalog" DROP COLUMN "claimed";

-- 4. RewardRule -------------------------------------------------------------

CREATE TABLE "RewardRule" (
    "id" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "minLevel" INTEGER NOT NULL DEFAULT 0,
    "minLifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "minActivities" INTEGER NOT NULL DEFAULT 0,
    "minDistinctFeatures" INTEGER NOT NULL DEFAULT 0,
    "minAccountAgeDays" INTEGER NOT NULL DEFAULT 0,
    "requiredFeatures" TEXT[],
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RewardRule_rewardId_key" ON "RewardRule"("rewardId");

ALTER TABLE "RewardRule" ADD CONSTRAINT "RewardRule_rewardId_fkey"
    FOREIGN KEY ("rewardId") REFERENCES "RewardCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. RewardRedemption -------------------------------------------------------

ALTER TABLE "RewardRedemption" RENAME COLUMN "costPoints" TO "pointsSpent";
ALTER TABLE "RewardRedemption" ADD COLUMN "refundEntryId" TEXT;
ALTER TABLE "RewardRedemption" ADD COLUMN "reservedAt" TIMESTAMP(3);
ALTER TABLE "RewardRedemption" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "RewardRedemption" ADD COLUMN "fulfilledAt" TIMESTAMP(3);
ALTER TABLE "RewardRedemption" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "RewardRedemption" ADD COLUMN "expiresAt" TIMESTAMP(3);

ALTER TABLE "RewardRedemption" RENAME CONSTRAINT "RewardRedemption_rewardId_fkey" TO "RewardRedemption_reward_fkey";
ALTER TABLE "RewardRedemption" DROP CONSTRAINT "RewardRedemption_reward_fkey";
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_rewardId_fkey"
    FOREIGN KEY ("rewardId") REFERENCES "RewardCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "RewardRedemption_rewardId_status_idx" ON "RewardRedemption"("rewardId", "status");

-- 6. RewardFulfillment ------------------------------------------------------

CREATE TABLE "RewardFulfillment" (
    "id" TEXT NOT NULL,
    "redemptionId" TEXT NOT NULL,
    "fromStatus" "RedemptionStatus",
    "toStatus" "RedemptionStatus" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardFulfillment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RewardFulfillment_redemptionId_createdAt_idx" ON "RewardFulfillment"("redemptionId", "createdAt");
CREATE INDEX "RewardFulfillment_toStatus_createdAt_idx" ON "RewardFulfillment"("toStatus", "createdAt");

ALTER TABLE "RewardFulfillment" ADD CONSTRAINT "RewardFulfillment_redemptionId_fkey"
    FOREIGN KEY ("redemptionId") REFERENCES "RewardRedemption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
