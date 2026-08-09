import type { Prisma } from '@prisma/client';
import { AUDIENCE_RESULT_DISCLAIMER, ERROR_CODES } from '@reality/shared';

import { AppError, conflict, forbidden, notFound } from '../../core/errors.js';
import { prisma } from '../../core/prisma.js';
import { awardPoints } from '../points/points.service.js';
import { getCurrentShowId } from '../show/show.service.js';

/**
 * Nomination and Eviction rounds.
 *
 * They are two separate systems with separate tables and separate lifecycles,
 * but the mechanics are identical, so the logic lives here once and is
 * parameterised by round type rather than copy-pasted twice.
 *
 * ── The rule that matters most ──────────────────────────────────────────────
 * The audience result and the show's official outcome are **different things**,
 * stored in different columns, published by different actions, and labelled
 * differently in the UI. Nothing on this platform decides who actually leaves
 * the house. `audienceResult` is what people here voted for; `officialOutcome`
 * is only ever written by a producer holding `official.publish`, and until they
 * do, every surface says so explicitly.
 */

export type RoundType = 'NOMINATION' | 'EVICTION';

export interface RoundCandidateView {
  contestantId: string;
  displayName: string;
  avatarUrl: string | null;
  tagline: string | null;
  status: string;
  eligible: boolean;
  voteCount: number;
  weightedScore: number;
  percentage: number;
  /** True when the signed-in user has spent a vote on this contestant. */
  votedByMe: boolean;
}

export interface RoundView {
  id: string;
  type: RoundType;
  title: string;
  description: string | null;
  status: string;
  opensAt: string;
  closesAt: string;
  isOpen: boolean;
  voteMeaning: 'NOMINATE' | 'SAVE' | 'EVICT';
  maxVotesPerUser: number;
  votesUsed: number;
  votesRemaining: number;
  totalVotes: number;
  candidates: RoundCandidateView[];
  /** Present once the round is published. Explicitly the *audience* view. */
  audienceResult: unknown | null;
  /** Present only when an authorised producer has published it. */
  officialOutcome: unknown | null;
  officialPublishedAt: string | null;
  /** Always sent, so no client can render a result without the caveat. */
  disclaimer: string;
}

function isOpen(round: { status: string; opensAt: Date; closesAt: Date }): boolean {
  const now = Date.now();
  return round.status === 'OPEN' && round.opensAt.getTime() <= now && round.closesAt.getTime() > now;
}

const CANDIDATE_INCLUDE = {
  contestant: {
    select: { id: true, displayName: true, avatarUrl: true, tagline: true, status: true },
  },
} as const;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface RoundRecord {
  id: string;
  title: string;
  description: string | null;
  status: string;
  opensAt: Date;
  closesAt: Date;
  maxVotesPerUser: number;
  totalVotes: number;
  audienceResult: Prisma.JsonValue | null;
  officialOutcome: Prisma.JsonValue | null;
  officialPublishedAt: Date | null;
  voteMeaning?: string;
}

interface CandidateRecord {
  contestantId: string;
  eligible: boolean;
  voteCount: number;
  weightedScore: number;
  contestant: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    tagline: string | null;
    status: string;
  };
}

function buildView(
  type: RoundType,
  round: RoundRecord,
  candidates: CandidateRecord[],
  myVotes: Set<string>,
  votesUsed: number,
): RoundView {
  // Total participation is public even while the round runs — knowing that
  // 2,000 people have voted tells you nothing about *who* is ahead.
  const total = candidates.reduce((sum, candidate) => sum + candidate.voteCount, 0);
  const published = round.status === 'PUBLISHED';

  return {
    id: round.id,
    type,
    title: round.title,
    description: round.description,
    status: round.status,
    opensAt: round.opensAt.toISOString(),
    closesAt: round.closesAt.toISOString(),
    isOpen: isOpen(round),
    voteMeaning:
      type === 'NOMINATION' ? 'NOMINATE' : ((round.voteMeaning as 'SAVE' | 'EVICT') ?? 'SAVE'),
    maxVotesPerUser: round.maxVotesPerUser,
    votesUsed,
    votesRemaining: Math.max(0, round.maxVotesPerUser - votesUsed),
    totalVotes: total,
    candidates: candidates
      .map((candidate) => ({
        contestantId: candidate.contestantId,
        displayName: candidate.contestant.displayName,
        avatarUrl: candidate.contestant.avatarUrl,
        tagline: candidate.contestant.tagline,
        status: candidate.contestant.status,
        eligible: candidate.eligible,
        // Live standings stay hidden until the round is published, so late
        // voters cannot pile onto whoever is already ahead.
        voteCount: published ? candidate.voteCount : 0,
        weightedScore: published ? candidate.weightedScore : 0,
        percentage: published && total > 0 ? Math.round((candidate.voteCount / total) * 1000) / 10 : 0,
        votedByMe: myVotes.has(candidate.contestantId),
      }))
      .sort((a, b) =>
        published ? b.voteCount - a.voteCount : a.displayName.localeCompare(b.displayName),
      ),
    audienceResult: published ? round.audienceResult : null,
    officialOutcome: round.officialOutcome,
    officialPublishedAt: round.officialPublishedAt?.toISOString() ?? null,
    disclaimer: AUDIENCE_RESULT_DISCLAIMER,
  };
}

export async function getCurrentRound(
  type: RoundType,
  userId: string | null,
): Promise<RoundView | null> {
  const showId = await getCurrentShowId();

  const round =
    type === 'NOMINATION'
      ? await prisma.nominationRound.findFirst({
          where: { showId, status: { in: ['OPEN', 'CLOSED', 'PUBLISHED'] } },
          orderBy: [{ status: 'asc' }, { closesAt: 'desc' }],
        })
      : await prisma.evictionRound.findFirst({
          where: { showId, status: { in: ['OPEN', 'CLOSED', 'PUBLISHED'] } },
          orderBy: [{ status: 'asc' }, { closesAt: 'desc' }],
        });

  if (!round) return null;
  return getRound(type, round.id, userId);
}

export async function getRound(
  type: RoundType,
  roundId: string,
  userId: string | null,
): Promise<RoundView> {
  if (type === 'NOMINATION') {
    const round = await prisma.nominationRound.findUnique({ where: { id: roundId } });
    if (!round || round.status === 'DRAFT') throw notFound('That round does not exist');

    const [candidates, myVotes, allowance] = await Promise.all([
      prisma.nominationCandidate.findMany({ where: { roundId }, include: CANDIDATE_INCLUDE }),
      userId
        ? prisma.nominationVote.findMany({ where: { roundId, userId }, select: { contestantId: true } })
        : Promise.resolve([]),
      userId ? readAllowance(type, roundId, userId) : Promise.resolve(0),
    ]);

    return buildView(type, round, candidates, new Set(myVotes.map((v) => v.contestantId)), allowance);
  }

  const round = await prisma.evictionRound.findUnique({ where: { id: roundId } });
  if (!round || round.status === 'DRAFT') throw notFound('That round does not exist');

  const [candidates, myVotes, allowance] = await Promise.all([
    prisma.evictionCandidate.findMany({ where: { roundId }, include: CANDIDATE_INCLUDE }),
    userId
      ? prisma.evictionVote.findMany({ where: { roundId, userId }, select: { contestantId: true } })
      : Promise.resolve([]),
    userId ? readAllowance(type, roundId, userId) : Promise.resolve(0),
  ]);

  return buildView(type, round, candidates, new Set(myVotes.map((v) => v.contestantId)), allowance);
}

async function readAllowance(type: RoundType, roundId: string, userId: string): Promise<number> {
  const allowance = await prisma.roundVoteAllowance.findUnique({
    where: { roundType_roundId_userId: { roundType: type, roundId, userId } },
  });
  return allowance?.votesUsed ?? 0;
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

export interface CastRoundVoteResult {
  round: RoundView;
  votesUsed: number;
  votesRemaining: number;
  pointsAwarded: number;
}

export async function castRoundVote(
  type: RoundType,
  roundId: string,
  userId: string,
  contestantId: string,
): Promise<CastRoundVoteResult> {
  const round =
    type === 'NOMINATION'
      ? await prisma.nominationRound.findUnique({ where: { id: roundId } })
      : await prisma.evictionRound.findUnique({ where: { id: roundId } });

  if (!round || round.status === 'DRAFT') throw notFound('That round does not exist');

  if (!isOpen(round)) {
    throw new AppError({
      code: ERROR_CODES.ROUND_CLOSED,
      message:
        round.status !== 'OPEN'
          ? 'This round is not open'
          : round.opensAt.getTime() > Date.now()
            ? 'This round has not opened yet'
            : 'This round has closed',
      statusCode: 409,
    });
  }

  const candidate =
    type === 'NOMINATION'
      ? await prisma.nominationCandidate.findUnique({
          where: { roundId_contestantId: { roundId, contestantId } },
        })
      : await prisma.evictionCandidate.findUnique({
          where: { roundId_contestantId: { roundId, contestantId } },
        });

  if (!candidate) throw notFound('That contestant is not in this round');
  if (!candidate.eligible) {
    throw new AppError({
      code: ERROR_CODES.NOT_ELIGIBLE,
      message: 'That contestant is not eligible in this round',
      statusCode: 409,
    });
  }

  const weight = weightFor(round.weighting, contestantId);

  // The allowance row must exist before it can be conditionally incremented.
  await prisma.roundVoteAllowance.upsert({
    where: { roundType_roundId_userId: { roundType: type, roundId, userId } },
    update: { voteLimit: round.maxVotesPerUser },
    create: {
      roundType: type,
      roundId,
      userId,
      voteLimit: round.maxVotesPerUser,
      votesUsed: 0,
    },
  });

  try {
    await prisma.$transaction(async (tx) => {
      // Atomic limit check. Two concurrent requests cannot both pass: the
      // second sees the first's committed increment, or blocks on the row.
      const claimed = await tx.roundVoteAllowance.updateMany({
        where: {
          roundType: type,
          roundId,
          userId,
          votesUsed: { lt: round.maxVotesPerUser },
        },
        data: { votesUsed: { increment: 1 } },
      });

      if (claimed.count === 0) {
        throw new AppError({
          code: ERROR_CODES.VOTE_LIMIT_REACHED,
          message: `You have used all ${round.maxVotesPerUser} of your votes in this round`,
          statusCode: 409,
        });
      }

      if (type === 'NOMINATION') {
        await tx.nominationVote.create({ data: { roundId, userId, contestantId, weight } });
        await tx.nominationCandidate.update({
          where: { roundId_contestantId: { roundId, contestantId } },
          data: { voteCount: { increment: 1 }, weightedScore: { increment: weight } },
        });
        await tx.nominationRound.update({
          where: { id: roundId },
          data: { totalVotes: { increment: 1 } },
        });
      } else {
        await tx.evictionVote.create({ data: { roundId, userId, contestantId, weight } });
        await tx.evictionCandidate.update({
          where: { roundId_contestantId: { roundId, contestantId } },
          data: { voteCount: { increment: 1 }, weightedScore: { increment: weight } },
        });
        await tx.evictionRound.update({
          where: { id: roundId },
          data: { totalVotes: { increment: 1 } },
        });
      }
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isUniqueViolation(error)) {
      // Rolled back together with the allowance increment, so a rejected
      // duplicate never costs the user one of their votes.
      throw conflict(ERROR_CODES.VOTE_DUPLICATE, 'You have already voted for this contestant');
    }
    throw error;
  }

  // Participation is credited once per round, not once per vote.
  const award = await awardPoints({
    userId,
    sourceType: type,
    sourceId: roundId,
    reason: 'participation',
    ruleKey: type === 'NOMINATION' ? 'NOMINATION_PARTICIPATION' : 'EVICTION_PARTICIPATION',
  });

  const view = await getRound(type, roundId, userId);

  return {
    round: view,
    votesUsed: view.votesUsed,
    votesRemaining: view.votesRemaining,
    pointsAwarded: award.delta,
  };
}

/** Optional per-contestant multiplier, e.g. `{"con_01": 1.5}`. Defaults to 1. */
function weightFor(weighting: Prisma.JsonValue | null, contestantId: string): number {
  if (!weighting || typeof weighting !== 'object' || Array.isArray(weighting)) return 1;
  const value = (weighting as Record<string, unknown>)[contestantId];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}

export async function withdrawRoundVote(
  type: RoundType,
  roundId: string,
  userId: string,
  contestantId: string,
): Promise<CastRoundVoteResult> {
  const round =
    type === 'NOMINATION'
      ? await prisma.nominationRound.findUnique({ where: { id: roundId } })
      : await prisma.evictionRound.findUnique({ where: { id: roundId } });

  if (!round) throw notFound('That round does not exist');
  if (!isOpen(round)) {
    throw new AppError({
      code: ERROR_CODES.ROUND_CLOSED,
      message: 'Votes cannot be changed once the round has closed',
      statusCode: 409,
    });
  }

  await prisma.$transaction(async (tx) => {
    const deleted =
      type === 'NOMINATION'
        ? await tx.nominationVote.deleteMany({ where: { roundId, userId, contestantId } })
        : await tx.evictionVote.deleteMany({ where: { roundId, userId, contestantId } });

    if (deleted.count === 0) throw notFound('You have not voted for that contestant');

    const weight = weightFor(round.weighting, contestantId);

    if (type === 'NOMINATION') {
      await tx.nominationCandidate.update({
        where: { roundId_contestantId: { roundId, contestantId } },
        data: { voteCount: { decrement: 1 }, weightedScore: { decrement: weight } },
      });
      await tx.nominationRound.update({
        where: { id: roundId },
        data: { totalVotes: { decrement: 1 } },
      });
    } else {
      await tx.evictionCandidate.update({
        where: { roundId_contestantId: { roundId, contestantId } },
        data: { voteCount: { decrement: 1 }, weightedScore: { decrement: weight } },
      });
      await tx.evictionRound.update({
        where: { id: roundId },
        data: { totalVotes: { decrement: 1 } },
      });
    }

    // Returning the vote to the allowance is what makes withdrawal meaningful.
    await tx.roundVoteAllowance.updateMany({
      where: { roundType: type, roundId, userId, votesUsed: { gt: 0 } },
      data: { votesUsed: { decrement: 1 } },
    });
  });

  const view = await getRound(type, roundId, userId);
  return {
    round: view,
    votesUsed: view.votesUsed,
    votesRemaining: view.votesRemaining,
    pointsAwarded: 0,
  };
}

// ---------------------------------------------------------------------------
// Operator lifecycle
// ---------------------------------------------------------------------------

export interface CreateRoundInput {
  title: string;
  description?: string | null;
  episodeId?: string | null;
  opensAt: string;
  closesAt: string;
  maxVotesPerUser?: number;
  voteMeaning?: 'SAVE' | 'EVICT';
  weighting?: Record<string, number> | null;
  contestantIds: string[];
}

export async function createRound(type: RoundType, input: CreateRoundInput, actorId: string) {
  const showId = await getCurrentShowId();

  const contestants = await prisma.contestant.findMany({
    where: { id: { in: input.contestantIds }, showId, deletedAt: null },
    select: { id: true },
  });
  if (contestants.length !== input.contestantIds.length) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'One or more contestants are not in this show',
      statusCode: 400,
    });
  }
  if (contestants.length < 2) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'A round needs at least two eligible contestants',
      statusCode: 400,
    });
  }

  const common = {
    showId,
    episodeId: input.episodeId ?? null,
    title: input.title,
    description: input.description ?? null,
    status: 'DRAFT' as const,
    opensAt: new Date(input.opensAt),
    closesAt: new Date(input.closesAt),
    maxVotesPerUser: input.maxVotesPerUser ?? 1,
    ...(input.weighting ? { weighting: input.weighting as Prisma.InputJsonValue } : {}),
    createdById: actorId,
  };

  if (type === 'NOMINATION') {
    return prisma.nominationRound.create({
      data: {
        ...common,
        candidates: { create: contestants.map((c) => ({ contestantId: c.id })) },
      },
      include: { candidates: true },
    });
  }

  return prisma.evictionRound.create({
    data: {
      ...common,
      voteMeaning: input.voteMeaning ?? 'SAVE',
      candidates: { create: contestants.map((c) => ({ contestantId: c.id })) },
    },
    include: { candidates: true },
  });
}

export async function setCandidateEligibility(
  type: RoundType,
  roundId: string,
  contestantId: string,
  eligible: boolean,
) {
  if (type === 'NOMINATION') {
    return prisma.nominationCandidate.update({
      where: { roundId_contestantId: { roundId, contestantId } },
      data: { eligible },
    });
  }
  return prisma.evictionCandidate.update({
    where: { roundId_contestantId: { roundId, contestantId } },
    data: { eligible },
  });
}

export async function openRound(type: RoundType, roundId: string) {
  const round =
    type === 'NOMINATION'
      ? await prisma.nominationRound.findUniqueOrThrow({ where: { id: roundId } })
      : await prisma.evictionRound.findUniqueOrThrow({ where: { id: roundId } });

  if (round.status !== 'DRAFT') {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: `A round cannot go from ${round.status} to OPEN`,
      statusCode: 409,
    });
  }
  if (round.closesAt.getTime() <= Date.now()) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'The close time is already in the past',
      statusCode: 400,
    });
  }

  const data = { status: 'OPEN' as const };
  return type === 'NOMINATION'
    ? prisma.nominationRound.update({ where: { id: roundId }, data })
    : prisma.evictionRound.update({ where: { id: roundId }, data });
}

export async function closeRound(type: RoundType, roundId: string) {
  const updated =
    type === 'NOMINATION'
      ? await prisma.nominationRound.updateMany({
          where: { id: roundId, status: 'OPEN' },
          data: { status: 'CLOSED' },
        })
      : await prisma.evictionRound.updateMany({
          where: { id: roundId, status: 'OPEN' },
          data: { status: 'CLOSED' },
        });

  if (updated.count === 0) {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: 'Only an open round can be closed',
      statusCode: 409,
    });
  }

  return { closed: true };
}

/**
 * Publishes the **audience** result.
 *
 * This is explicitly not an elimination. It records what people on this
 * platform voted for, tags it as such, and leaves `officialOutcome` untouched.
 */
export async function publishAudienceResult(type: RoundType, roundId: string, actorId: string) {
  const candidates =
    type === 'NOMINATION'
      ? await prisma.nominationCandidate.findMany({ where: { roundId }, include: CANDIDATE_INCLUDE })
      : await prisma.evictionCandidate.findMany({ where: { roundId }, include: CANDIDATE_INCLUDE });

  const ranked = [...candidates].sort(
    (a, b) => b.weightedScore - a.weightedScore || b.voteCount - a.voteCount,
  );
  const total = candidates.reduce((sum, candidate) => sum + candidate.voteCount, 0);

  const audienceResult = {
    kind: 'AUDIENCE_RESULT',
    disclaimer: AUDIENCE_RESULT_DISCLAIMER,
    totalVotes: total,
    computedAt: new Date().toISOString(),
    standings: ranked.map((candidate, index) => ({
      rank: index + 1,
      contestantId: candidate.contestantId,
      displayName: candidate.contestant.displayName,
      voteCount: candidate.voteCount,
      weightedScore: candidate.weightedScore,
      percentage: total > 0 ? Math.round((candidate.voteCount / total) * 1000) / 10 : 0,
    })),
  } satisfies Prisma.InputJsonValue;

  if (type === 'NOMINATION') {
    // The audience's top picks are recorded as AUDIENCE-sourced nominations,
    // kept distinct from any OFFICIAL nomination the show enters separately.
    const topCount = Math.min(2, ranked.length);
    for (let index = 0; index < topCount; index += 1) {
      const candidate = ranked[index]!;
      if (candidate.voteCount === 0) continue;
      await prisma.nomination.upsert({
        where: {
          roundId_contestantId_source: {
            roundId,
            contestantId: candidate.contestantId,
            source: 'AUDIENCE',
          },
        },
        update: { position: index + 1 },
        create: {
          roundId,
          contestantId: candidate.contestantId,
          source: 'AUDIENCE',
          position: index + 1,
          createdById: actorId,
        },
      });
    }

    return prisma.nominationRound.update({
      where: { id: roundId },
      data: { status: 'PUBLISHED', audienceResult, publishedAt: new Date() },
    });
  }

  return prisma.evictionRound.update({
    where: { id: roundId },
    data: { status: 'PUBLISHED', audienceResult, publishedAt: new Date() },
  });
}

/**
 * Records the show's **official** outcome.
 *
 * Separate column, separate permission (`official.publish`), separate action.
 * Nothing derives this from the audience vote — a producer types what the show
 * actually did.
 */
export async function publishOfficialOutcome(
  type: RoundType,
  roundId: string,
  actorId: string,
  outcome: { contestantIds: string[]; note?: string },
) {
  const contestants = await prisma.contestant.findMany({
    where: { id: { in: outcome.contestantIds } },
    select: { id: true, displayName: true },
  });
  if (contestants.length !== outcome.contestantIds.length) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'One or more contestants do not exist',
      statusCode: 400,
    });
  }

  const officialOutcome = {
    kind: 'OFFICIAL_OUTCOME',
    source: 'production',
    note: outcome.note ?? null,
    contestants: contestants.map((c) => ({ id: c.id, displayName: c.displayName })),
    publishedAt: new Date().toISOString(),
  } satisfies Prisma.InputJsonValue;

  if (type === 'NOMINATION') {
    for (const contestant of contestants) {
      await prisma.nomination.upsert({
        where: {
          roundId_contestantId_source: {
            roundId,
            contestantId: contestant.id,
            source: 'OFFICIAL',
          },
        },
        update: {},
        create: { roundId, contestantId: contestant.id, source: 'OFFICIAL', createdById: actorId },
      });
    }

    return prisma.nominationRound.update({
      where: { id: roundId },
      data: {
        officialOutcome,
        officialPublishedAt: new Date(),
        officialPublishedById: actorId,
      },
    });
  }

  return prisma.evictionRound.update({
    where: { id: roundId },
    data: {
      officialOutcome,
      officialPublishedAt: new Date(),
      officialPublishedById: actorId,
    },
  });
}

export async function listRounds(type: RoundType) {
  const showId = await getCurrentShowId();
  return type === 'NOMINATION'
    ? prisma.nominationRound.findMany({ where: { showId }, orderBy: { closesAt: 'desc' }, take: 20 })
    : prisma.evictionRound.findMany({ where: { showId }, orderBy: { closesAt: 'desc' }, take: 20 });
}

export function assertOperatorCanPublishOfficial(hasPermission: boolean): void {
  if (!hasPermission) {
    throw forbidden(
      'Publishing the official show outcome requires authorisation from the production team',
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
