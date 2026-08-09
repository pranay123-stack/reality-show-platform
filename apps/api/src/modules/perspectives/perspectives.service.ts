import type { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  type CreatePerspectiveInput,
  type PerspectiveAnalytics,
  type PerspectiveView,
} from '@reality/shared';

import { AppError, conflict, notFound } from '../../core/errors.js';
import { prisma } from '../../core/prisma.js';
import { awardPoints } from '../points/points.service.js';
import { getCurrentShowId } from '../show/show.service.js';

/**
 * Audience Perspective — opinion about something that already happened.
 *
 * Distinct from Live Polls by design (see the note in the shared schema). The
 * one behavioural difference worth calling out here: **results stay visible
 * while voting is open**. A live poll hides its tally because the tally can
 * change the outcome; a perspective is asking what people think about a fixed
 * past event, so showing the split informs rather than distorts.
 */

const PERSPECTIVE_INCLUDE = {
  options: { include: { contestant: { select: { id: true, displayName: true } } } },
  event: {
    include: {
      contestants: {
        include: {
          contestant: { select: { id: true, displayName: true, avatarUrl: true } },
        },
      },
    },
  },
} satisfies Prisma.AudiencePerspectiveInclude;

type PerspectiveRow = Prisma.AudiencePerspectiveGetPayload<{ include: typeof PERSPECTIVE_INCLUDE }>;

function toView(perspective: PerspectiveRow, myOptionId: string | null): PerspectiveView {
  const total = perspective.totalVotes;

  const options = perspective.options
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((option) => ({
      id: option.id,
      label: option.label,
      contestantId: option.contestantId,
      contestantName: option.contestant?.displayName ?? null,
      sortOrder: option.sortOrder,
      voteCount: option.voteCount,
      percentage: total > 0 ? Math.round((option.voteCount / total) * 1000) / 10 : 0,
    }));

  const sortedByVotes = [...options].sort((a, b) => b.voteCount - a.voteCount);
  const leader = sortedByVotes[0];
  const runnerUp = sortedByVotes[1];
  const hasClearLeader =
    leader !== undefined && leader.voteCount > 0 && leader.voteCount !== runnerUp?.voteCount;

  return {
    id: perspective.id,
    question: perspective.question,
    description: perspective.description,
    status: perspective.status,
    opensAt: perspective.opensAt?.toISOString() ?? null,
    closesAt: perspective.closesAt.toISOString(),
    totalVotes: total,
    options,
    event: {
      id: perspective.event.id,
      type: perspective.event.type,
      title: perspective.event.title,
      description: perspective.event.description,
      occurredAt: perspective.event.occurredAt.toISOString(),
      contestants: perspective.event.contestants.map((link) => link.contestant),
    },
    myOptionId,
    isClosed: isClosed(perspective),
    leadingOptionId: hasClearLeader ? leader.id : null,
  };
}

function isClosed(perspective: { status: string; closesAt: Date }): boolean {
  return perspective.status !== 'OPEN' || perspective.closesAt.getTime() <= Date.now();
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listPerspectives(
  userId: string | null,
  options: {
    scope?: 'open' | 'closed' | 'mine' | 'all';
    eventId?: string;
    contestantId?: string;
    limit?: number;
  } = {},
): Promise<PerspectiveView[]> {
  const showId = await getCurrentShowId();
  const scope = options.scope ?? 'open';
  const now = new Date();

  const where: Prisma.AudiencePerspectiveWhereInput = {
    showId,
    status: { not: 'DRAFT' },
    ...(options.eventId ? { eventId: options.eventId } : {}),
    ...(options.contestantId
      ? { options: { some: { contestantId: options.contestantId } } }
      : {}),
  };

  if (scope === 'open') {
    where.status = 'OPEN';
    where.closesAt = { gt: now };
  } else if (scope === 'closed') {
    where.OR = [{ status: { in: ['CLOSED', 'ARCHIVED'] } }, { closesAt: { lte: now } }];
    delete where.status;
  } else if (scope === 'mine') {
    if (!userId) return [];
    where.votes = { some: { userId } };
  }

  const perspectives = await prisma.audiencePerspective.findMany({
    where,
    include: PERSPECTIVE_INCLUDE,
    orderBy: scope === 'closed' ? { closesAt: 'desc' } : { closesAt: 'asc' },
    take: options.limit ?? 20,
  });

  const myVotes = userId
    ? await prisma.perspectiveVote.findMany({
        where: { userId, perspectiveId: { in: perspectives.map((p) => p.id) } },
        select: { perspectiveId: true, optionId: true },
      })
    : [];

  const voteByPerspective = new Map(myVotes.map((vote) => [vote.perspectiveId, vote.optionId]));

  return perspectives.map((perspective) =>
    toView(perspective, voteByPerspective.get(perspective.id) ?? null),
  );
}

export async function getPerspective(
  perspectiveId: string,
  userId: string | null,
): Promise<PerspectiveView> {
  const perspective = await prisma.audiencePerspective.findUnique({
    where: { id: perspectiveId },
    include: PERSPECTIVE_INCLUDE,
  });

  if (!perspective || perspective.status === 'DRAFT') {
    throw notFound('That perspective does not exist');
  }

  const myVote = userId
    ? await prisma.perspectiveVote.findUnique({
        where: { perspectiveId_userId: { perspectiveId, userId } },
        select: { optionId: true },
      })
    : null;

  return toView(perspective, myVote?.optionId ?? null);
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

export interface PerspectiveVoteResult {
  perspective: PerspectiveView;
  pointsAwarded: number;
  balance: number;
}

export async function votePerspective(
  perspectiveId: string,
  userId: string,
  optionId: string,
): Promise<PerspectiveVoteResult> {
  const perspective = await prisma.audiencePerspective.findUnique({
    where: { id: perspectiveId },
    include: { options: { select: { id: true } } },
  });

  if (!perspective || perspective.status === 'DRAFT') {
    throw notFound('That perspective does not exist');
  }

  if (perspective.status !== 'OPEN') {
    throw new AppError({
      code: ERROR_CODES.ROUND_CLOSED,
      message: 'This perspective is no longer open',
      statusCode: 409,
    });
  }

  // Checked against the clock on every request, so a missed close job can never
  // let a late vote through.
  if (perspective.closesAt.getTime() <= Date.now()) {
    throw new AppError({
      code: ERROR_CODES.ROUND_CLOSED,
      message: 'This perspective has closed',
      statusCode: 409,
    });
  }

  if (!perspective.options.some((option) => option.id === optionId)) {
    throw new AppError({
      code: ERROR_CODES.OPTION_INVALID,
      message: 'That option does not belong to this perspective',
      statusCode: 400,
    });
  }

  try {
    await prisma.$transaction([
      prisma.perspectiveVote.create({ data: { perspectiveId, userId, optionId } }),
      prisma.perspectiveOption.update({
        where: { id: optionId },
        data: { voteCount: { increment: 1 } },
      }),
      prisma.audiencePerspective.update({
        where: { id: perspectiveId },
        data: { totalVotes: { increment: 1 } },
      }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(
        ERROR_CODES.VOTE_DUPLICATE,
        'You have already shared your perspective on this one',
      );
    }
    throw error;
  }

  const award = await awardPoints({
    userId,
    sourceType: 'PERSPECTIVE',
    sourceId: perspectiveId,
    reason: 'participation',
    ruleKey: 'PERSPECTIVE_PARTICIPATION',
  });

  return {
    perspective: await getPerspective(perspectiveId, userId),
    pointsAwarded: award.delta,
    balance: award.balance,
  };
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * Historical analytics across every closed perspective.
 *
 * "Consensus" buckets each result by how far ahead the leading option finished:
 * a 90/10 split says something very different about the audience than 51/49.
 */
export async function getPerspectiveAnalytics(): Promise<PerspectiveAnalytics> {
  const showId = await getCurrentShowId();

  const perspectives = await prisma.audiencePerspective.findMany({
    where: { showId, status: { not: 'DRAFT' } },
    include: {
      options: { include: { contestant: { select: { id: true, displayName: true } } } },
    },
    orderBy: { closesAt: 'desc' },
  });

  const totalVotes = perspectives.reduce((sum, perspective) => sum + perspective.totalVotes, 0);

  const consensus = { decisive: 0, split: 0, contested: 0 };
  const byContestant = new Map<
    string,
    { contestantId: string; displayName: string; votesFor: number; appearances: number }
  >();
  const recent: PerspectiveAnalytics['recent'] = [];

  for (const perspective of perspectives) {
    const sorted = [...perspective.options].sort((a, b) => b.voteCount - a.voteCount);
    const leader = sorted[0];
    const runnerUp = sorted[1];

    const margin =
      perspective.totalVotes > 0 && leader
        ? Math.round(
            (((leader.voteCount ?? 0) - (runnerUp?.voteCount ?? 0)) / perspective.totalVotes) * 1000,
          ) / 10
        : 0;

    if (perspective.totalVotes > 0) {
      if (margin >= 40) consensus.decisive += 1;
      else if (margin >= 15) consensus.split += 1;
      else consensus.contested += 1;
    }

    if (recent.length < 10) {
      recent.push({
        id: perspective.id,
        question: perspective.question,
        closesAt: perspective.closesAt.toISOString(),
        totalVotes: perspective.totalVotes,
        margin,
      });
    }

    for (const option of perspective.options) {
      if (!option.contestant) continue;
      const entry = byContestant.get(option.contestant.id) ?? {
        contestantId: option.contestant.id,
        displayName: option.contestant.displayName,
        votesFor: 0,
        appearances: 0,
      };
      entry.votesFor += option.voteCount;
      entry.appearances += 1;
      byContestant.set(option.contestant.id, entry);
    }
  }

  return {
    totalPerspectives: perspectives.length,
    totalVotes,
    averageVotesPerPerspective:
      perspectives.length > 0 ? Math.round((totalVotes / perspectives.length) * 10) / 10 : 0,
    consensus,
    byContestant: [...byContestant.values()]
      .map((entry) => ({
        ...entry,
        supportRate: totalVotes > 0 ? Math.round((entry.votesFor / totalVotes) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.votesFor - a.votesFor),
    recent,
  };
}

// ---------------------------------------------------------------------------
// Operator
// ---------------------------------------------------------------------------

export async function createPerspective(input: CreatePerspectiveInput, actorId: string) {
  const showId = await getCurrentShowId();

  const event = await prisma.event.findFirst({
    where: { id: input.eventId, showId },
    select: { id: true, episodeId: true },
  });
  // A perspective without an event is a live poll wearing a disguise; the
  // anchor is what makes this feature what it is.
  if (!event) throw notFound('That event does not exist in this show');

  return prisma.audiencePerspective.create({
    data: {
      showId,
      eventId: event.id,
      episodeId: input.episodeId ?? event.episodeId,
      question: input.question,
      description: input.description ?? null,
      status: 'DRAFT',
      opensAt: input.opensAt ? new Date(input.opensAt) : null,
      closesAt: new Date(input.closesAt),
      createdById: actorId,
      options: {
        create: input.options.map((option, index) => ({
          label: option.label,
          contestantId: option.contestantId ?? null,
          sortOrder: option.sortOrder ?? index,
        })),
      },
    },
    include: { options: true },
  });
}

export async function openPerspective(perspectiveId: string) {
  const perspective = await prisma.audiencePerspective.findUniqueOrThrow({
    where: { id: perspectiveId },
    include: { options: true },
  });

  if (perspective.status !== 'DRAFT') {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: `A perspective cannot go from ${perspective.status} to OPEN`,
      statusCode: 409,
    });
  }
  if (perspective.options.length < 2) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'A perspective needs at least two options',
      statusCode: 400,
    });
  }
  if (perspective.closesAt.getTime() <= Date.now()) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'The close time is already in the past',
      statusCode: 400,
    });
  }

  return prisma.audiencePerspective.update({
    where: { id: perspectiveId },
    data: { status: 'OPEN', opensAt: perspective.opensAt ?? new Date() },
  });
}

export async function closePerspective(perspectiveId: string) {
  const perspective = await prisma.audiencePerspective.findUniqueOrThrow({
    where: { id: perspectiveId },
  });

  if (perspective.status !== 'OPEN') {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: `A perspective cannot go from ${perspective.status} to CLOSED`,
      statusCode: 409,
    });
  }

  return prisma.audiencePerspective.update({
    where: { id: perspectiveId },
    data: { status: 'CLOSED' },
  });
}

/** Bookkeeping only — `votePerspective` already refuses a late vote. */
export async function closeExpiredPerspectives(): Promise<number> {
  const result = await prisma.audiencePerspective.updateMany({
    where: { status: 'OPEN', closesAt: { lte: new Date() } },
    data: { status: 'CLOSED' },
  });
  return result.count;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
