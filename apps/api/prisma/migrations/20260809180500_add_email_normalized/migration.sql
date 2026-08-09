-- Adds the canonical email column used for duplicate-account prevention.
--
-- Written by hand rather than generated, because the column is NOT NULL + UNIQUE
-- on a table that may already hold rows. The three-step add → backfill → constrain
-- sequence is safe on both an empty database and a populated one.
--
-- The backfill uses plain lower-casing, which is correct for every address that
-- is not already a provider alias. If a deployment has pre-existing aliased
-- duplicates, the unique index below will fail loudly and those accounts must be
-- merged deliberately — silently dropping one of them would be worse.

ALTER TABLE "User" ADD COLUMN "emailNormalized" TEXT;

UPDATE "User" SET "emailNormalized" = lower(btrim("email")) WHERE "emailNormalized" IS NULL;

ALTER TABLE "User" ALTER COLUMN "emailNormalized" SET NOT NULL;

CREATE UNIQUE INDEX "User_emailNormalized_key" ON "User"("emailNormalized");
