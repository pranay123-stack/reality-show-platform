-- Refresh-token reuse detection.
--
-- Rotation alone cannot tell a stolen token from a merely stale one: both simply
-- fail to match the current hash. Keeping the previous hash makes replay
-- detectable, which is what turns rotation into a real defence.

ALTER TABLE "UserSession" ADD COLUMN "previousTokenHash" TEXT;

CREATE UNIQUE INDEX "UserSession_previousTokenHash_key" ON "UserSession"("previousTokenHash");
