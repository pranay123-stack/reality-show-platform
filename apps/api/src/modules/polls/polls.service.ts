import type { Prisma } from '@prisma/client';
import { ERROR_CODES } from '@reality/shared';

import { AppError, conflict, notFound } from '../../core/errors.js';
import { prisma } from '../../core/prisma.js';
import type { PollOptionCount, PollSnapshot } from '../../realtime/events.js';
import { awardPoints } from '../points/points.service.js';
import { getCurrentShowId } from '../show/show.service.js';

/**
 * Live Polls.
 *
 * The only genuinely hard part is the boundary between "still open" and
 * "closed", because a vote can arrive in the same millisecond as the close.
 * Both operations are written as **single conditional UPDATE statements**, so
 * the database decides the ordering:
 *
 *   vote:  UPDATE ... WHERE id = ? AND status = 'ACTIVE' AND closesAt > now()
 *   close: UPDATE ... WHERE id = ? AND status IN ('ACTIVE','PAUSED')
 *
 * Whichever commits first wins. A vote is therefore either fully counted or
 * fully rejected — it can never be half-applied, and no application-level lock
 * or read-then-write window exists for a race to slip through.
 */

const POLL_INCLUDE = {
  options: {
    include: { contestant: { select: { displayName: true } } },
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.LivePollInclude;

type PollRow = Prisma.LivePollGetPayload<{ include: typeof POLL_INCLUDE }>;

/** A poll flagged ACTIVE whose deadline has passed is not open, whatever the column says. */
export function isPollOpen(poll: { status: string; closesAt: Date | null }): boolean {
  if (poll.status !== 'ACTIVE') return false;
  return poll.closesAt === null || poll.closesAt.getTime() > Date.now();
}

function countsOf(poll: PollRow): PollOptionCount[] {
  return poll.options.map((option) => ({ optionId: option.id, voteCount: option.voteCount }));
}

export function toSnapshot(poll: PollRow, revealCounts: boolean): PollSnapshot {
  return {
    id: poll.id,
    question: poll.question,
    description: poll.description,
    status: poll.status,
    opensAt: poll.opensAt?.toISOString() ?? null,
    closesAt: poll.closesAt?.toISOString() ?? null,
    durationSeconds: poll.durationSeconds,
    totalVotes: poll.totalVotes,
    version: poll.version,
    options: poll.options.map((option) => ({
      id: option.id,
      label: option.label,
      contestantName: option.contestant?.displayName ?? null,
      sortOrder: option.sortOrder,
    })),
    // While a poll is live, the running tally is withheld from anyone who has
    // not voted: seeing the crowd changes the vote.
    counts: revealCounts ? countsOf(poll) : null,
  };
}

async function loadPoll(pollId: string): Promise<PollRow> {
  const poll = await prisma.livePoll.findUnique({ where: { id: pollId }, include: POLL_INCLUDE });
  if (!poll || poll.status === 'DRAFT') throw notFound('That poll does not exist');
  return poll;
}

export async function getPollForViewer(pollId: string, userId: string | null) {
  const poll = await loadPoll(pollId);
  const myVote = userId
    ? await prisma.pollVote.findUnique({
        where: { pollId_userId: { pollId, userId } },
        select: { optionId: true },
      })
    : null;

  const finished = poll.status === 'CLOSED' || poll.status === 'PUBLISHED';
  return {
    poll: toSnapshot(poll, finished || Boolean(myVote)),
    myOptionId: myVote?.optionId ?? null,
  };
}

export async function listPolls(userId: string | null, scope: 'active' | 'past' | 'all' = 'active') {
  const showId = await getCurrentShowId();
  const now = new Date();

  const where: Prisma.LivePollWhereInput =
    scope === 'active'
      ? { showId, status: 'ACTIVE', OR: [{ closesAt: null }, { closesAt: { gt: now } }] }
      : scope === 'past'
        ? { showId, status: { in: ['CLOSED', 'PUBLISHED'] } }
        : { showId, status: { not: 'DRAFT' } };

  const polls = await prisma.livePoll.findMany({
    where,
    include: POLL_INCLUDE,
    orderBy: scope === 'past' ? { closedAt: 'desc' } : { closesAt: 'asc' },
    take: 25,
  });

  const myVotes = userId
    ? await prisma.pollVote.findMany({
        where: { userId, pollId: { in: polls.map((poll) => poll.id) } },
        select: { pollId: true, optionId: true },
      })
    : [];
  const voteByPoll = new Map(myVotes.map((vote) => [vote.pollId, vote.optionId]));

  return polls.map((poll) => {
    const finished = poll.status === 'CLOSED' || poll.status === 'PUBLISHED';
    const myOptionId = voteByPoll.get(poll.id) ?? null;
    return {
      ...toSnapshot(poll, finished || myOptionId !== null),
      myOptionId,
    };
  });
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

export interface CastVoteResult {
  counts: PollOptionCount[];
  totalVotes: number;
  version: number;
  pointsAwarded: number;
  balance: number;
}

export async function castVote(
  pollId: string,
  userId: string,
  optionId: string,
): Promise<CastVoteResult> {
  const option = await prisma.pollOption.findFirst({
    where: { id: optionId, pollId },
    select: { id: true },
  });
  if (!option) {
    throw new AppError({
      code: ERROR_CODES.OPTION_INVALID,
      message: 'That option does not belong to this poll',
      statusCode: 400,
    });
  }

  const participationPoints = await prisma.livePoll
    .findUniqueOrThrow({ where: { id: pollId }, select: { participationPoints: true } })
    .then((poll) => poll.participationPoints);

  try {
    await prisma.$transaction(async (tx) => {
      // The guard and the increment are one statement. A close committing
      // concurrently either lands before this (0 rows matched → rejected) or
      // after it (vote already counted). There is no window between them.
      const guarded = await tx.livePoll.updateMany({
        where: {
          id: pollId,
          status: 'ACTIVE',
          OR: [{ closesAt: null }, { closesAt: { gt: new Date() } }],
        },
        data: { totalVotes: { increment: 1 }, version: { increment: 1 } },
      });

      if (guarded.count === 0) {
        throw new AppError({
          code: ERROR_CODES.POLL_CLOSED,
          message: 'This poll is closed',
          statusCode: 409,
        });
      }

      // The unique constraint is the real duplicate guard; a P2002 here rolls
      // back the increment above, so a rejected duplicate leaves no trace.
      await tx.pollVote.create({ data: { pollId, userId, optionId } });
      await tx.pollOption.update({
        where: { id: optionId },
        data: { voteCount: { increment: 1 } },
      });
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isUniqueViolation(error)) {
      throw conflict(ERROR_CODES.VOTE_DUPLICATE, 'You have already voted in this poll');
    }
    throw error;
  }

  const award = await awardPoints({
    userId,
    sourceType: 'POLL',
    sourceId: pollId,
    reason: 'participation',
    points: participationPoints,
  });

  const poll = await loadPoll(pollId);

  return {
    counts: countsOf(poll),
    totalVotes: poll.totalVotes,
    version: poll.version,
    pointsAwarded: award.delta,
    balance: award.balance,
  };
}

// ---------------------------------------------------------------------------
// Operator lifecycle
// ---------------------------------------------------------------------------

export interface CreatePollInput {
  question: string;
  description?: string | null;
  episodeId?: string | null;
  durationSeconds?: number;
  participationPoints?: number;
  options: { label: string; contestantId?: string | null; sortOrder?: number }[];
}

export async function createPoll(input: CreatePollInput, actorId: string) {
  const showId = await getCurrentShowId();

  return prisma.livePoll.create({
    data: {
      showId,
      episodeId: input.episodeId ?? null,
      question: input.question,
      description: input.description ?? null,
      status: 'DRAFT',
      durationSeconds: input.durationSeconds ?? 60,
      ...(input.participationPoints !== undefined
        ? { participationPoints: input.participationPoints }
        : {}),
      createdById: actorId,
      options: {
        create: input.options.map((option, index) => ({
          label: option.label,
          contestantId: option.contestantId ?? null,
          sortOrder: option.sortOrder ?? index,
        })),
      },
    },
    include: POLL_INCLUDE,
  });
}

/** Starts the clock. The duration is applied server-side, not sent by a client. */
export async function activatePoll(pollId: string): Promise<PollRow> {
  const poll = await prisma.livePoll.findUniqueOrThrow({
    where: { id: pollId },
    include: POLL_INCLUDE,
  });

  if (poll.status !== 'DRAFT' && poll.status !== 'PAUSED') {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: `A poll cannot go from ${poll.status} to ACTIVE`,
      statusCode: 409,
    });
  }
  if (poll.options.length < 2) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'A poll needs at least two options',
      statusCode: 400,
    });
  }

  const now = new Date();
  const closesAt = new Date(now.getTime() + (poll.durationSeconds ?? 60) * 1000);

  return prisma.livePoll.update({
    where: { id: pollId },
    data: {
      status: 'ACTIVE',
      opensAt: poll.opensAt ?? now,
      closesAt,
      version: { increment: 1 },
    },
    include: POLL_INCLUDE,
  });
}

export async function pausePoll(pollId: string): Promise<PollRow> {
  const updated = await prisma.livePoll.updateMany({
    where: { id: pollId, status: 'ACTIVE' },
    data: { status: 'PAUSED', version: { increment: 1 } },
  });

  if (updated.count === 0) {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: 'Only an active poll can be paused',
      statusCode: 409,
    });
  }

  return loadPoll(pollId);
}

/**
 * Closes a poll. Idempotent by construction: the conditional update simply
 * matches nothing the second time.
 */
export async function closePoll(pollId: string): Promise<{ poll: PollRow; alreadyClosed: boolean }> {
  const updated = await prisma.livePoll.updateMany({
    where: { id: pollId, status: { in: ['ACTIVE', 'PAUSED'] } },
    data: { status: 'CLOSED', closedAt: new Date(), version: { increment: 1 } },
  });

  const poll = await loadPoll(pollId);
  return { poll, alreadyClosed: updated.count === 0 };
}

export async function publishPollResult(pollId: string): Promise<PollRow> {
  const poll = await loadPoll(pollId);

  if (poll.status !== 'CLOSED') {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: 'A poll must be closed before its result can be published',
      statusCode: 409,
    });
  }

  return prisma.livePoll.update({
    where: { id: pollId },
    data: { status: 'PUBLISHED', publishedAt: new Date(), version: { increment: 1 } },
    include: POLL_INCLUDE,
  });
}

/** Highest count, or null on a tie or an empty poll — never a coin flip. */
export function winningOptionId(poll: PollRow): string | null {
  const sorted = [...poll.options].sort((a, b) => b.voteCount - a.voteCount);
  const leader = sorted[0];
  if (!leader || leader.voteCount === 0) return null;
  return sorted[1]?.voteCount === leader.voteCount ? null : leader.id;
}

/**
 * Closes every poll whose deadline has passed.
 *
 * Bookkeeping and broadcasting only — `castVote` already refuses a late vote,
 * so a missed run can never let one through.
 */
export async function closeExpiredPolls(): Promise<string[]> {
  const expired = await prisma.livePoll.findMany({
    where: { status: 'ACTIVE', closesAt: { lte: new Date() } },
    select: { id: true },
  });

  for (const poll of expired) {
    await prisma.livePoll.updateMany({
      where: { id: poll.id, status: 'ACTIVE' },
      data: { status: 'CLOSED', closedAt: new Date(), version: { increment: 1 } },
    });
  }

  return expired.map((poll) => poll.id);
}

export { loadPoll, countsOf };

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
