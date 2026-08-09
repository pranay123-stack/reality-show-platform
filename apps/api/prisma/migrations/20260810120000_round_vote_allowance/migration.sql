-- Per-user vote allowance for nomination and eviction rounds.
--
-- Makes "at most N votes per user per round" enforceable in a single atomic
-- statement (UPDATE ... WHERE votesUsed < limit) rather than a read-then-write
-- that two concurrent requests could both pass.

CREATE TABLE "RoundVoteAllowance" (
    "id" TEXT NOT NULL,
    "roundType" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "votesUsed" INTEGER NOT NULL DEFAULT 0,
    "voteLimit" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoundVoteAllowance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoundVoteAllowance_roundType_roundId_userId_key"
    ON "RoundVoteAllowance"("roundType", "roundId", "userId");

CREATE INDEX "RoundVoteAllowance_roundId_idx" ON "RoundVoteAllowance"("roundId");
