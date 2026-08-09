import type { ChallengeStatus, Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  type ChallengeModerationView,
  type ChallengeView,
  type CreateChallengeInput,
  type ReportChallengeInput,
} from '@reality/shared';

import { AppError, conflict, forbidden, notFound } from '../../core/errors.js';
import { prisma } from '../../core/prisma.js';
import { awardPoints } from '../points/points.service.js';
import { getCurrentShowId } from '../show/show.service.js';
import { screenContent } from './content-moderation.js';
import { DEFAULT_RANKING_WEIGHTS, rankChallenges, type RankingWeights } from './ranking.js';

/**
 * Audience Challenges.
 *
 * Lifecycle, and who can move it:
 *
 *   DRAFT ─(author)→ SUBMITTED ─(auto)→ MODERATION
 *     MODERATION ─(moderator)→ APPROVED | REJECTED
 *     APPROVED ─(producer)→ COMMUNITY_VOTING
 *     COMMUNITY_VOTING ─(producer, ranked)→ TOP_CHALLENGES
 *     TOP_CHALLENGES ─(producer)→ PRODUCER_REVIEW
 *     PRODUCER_REVIEW ─(producer)→ SELECTED | REJECTED
 *     SELECTED ─(producer)→ EXECUTED ─(producer)→ COMPLETED
 *
 * Nothing skips moderation: a challenge can only reach community voting after a
 * human has approved it.
 */

const TRANSITIONS: Record<ChallengeStatus, ChallengeStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['MODERATION'],
  MODERATION: ['APPROVED', 'REJECTED'],
  APPROVED: ['COMMUNITY_VOTING', 'REJECTED'],
  REJECTED: [],
  COMMUNITY_VOTING: ['TOP_CHALLENGES', 'REJECTED'],
  TOP_CHALLENGES: ['PRODUCER_REVIEW', 'REJECTED'],
  PRODUCER_REVIEW: ['SELECTED', 'REJECTED'],
  SELECTED: ['EXECUTED'],
  EXECUTED: ['COMPLETED'],
  COMPLETED: [],
};

function assertTransition(from: ChallengeStatus, to: ChallengeStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: `A challenge cannot go from ${from} to ${to}`,
      statusCode: 409,
    });
  }
}

/** Only these statuses accept community votes. */
const VOTABLE_STATUSES: ChallengeStatus[] = ['COMMUNITY_VOTING', 'TOP_CHALLENGES'];

const CHALLENGE_INCLUDE = {
  author: { select: { id: true, email: true, profile: { select: { displayName: true, avatarUrl: true } } } },
  targetContestant: { select: { id: true, displayName: true, avatarUrl: true } },
} satisfies Prisma.AudienceChallengeInclude;

type ChallengeRow = Prisma.AudienceChallengeGetPayload<{ include: typeof CHALLENGE_INCLUDE }>;

function toView(
  challenge: ChallengeRow,
  viewerId: string | null,
  hasVoted: boolean,
): ChallengeView {
  const isOwn = challenge.authorId === viewerId;
  const votable = VOTABLE_STATUSES.includes(challenge.status);

  let voteBlockedReason: string | null = null;
  if (!votable) voteBlockedReason = 'Voting is not open for this challenge';
  else if (!viewerId) voteBlockedReason = 'Sign in to vote';
  else if (isOwn) voteBlockedReason = 'You cannot vote for your own challenge';
  else if (hasVoted) voteBlockedReason = 'You have already voted';

  return {
    id: challenge.id,
    title: challenge.title,
    description: challenge.description,
    category: challenge.category,
    targetType: challenge.targetType,
    targetContestant: challenge.targetContestant,
    status: challenge.status,
    author: {
      id: challenge.author.id,
      displayName: challenge.author.profile?.displayName ?? 'Viewer',
      avatarUrl: challenge.author.profile?.avatarUrl ?? null,
    },
    voteCount: challenge.voteCount,
    rank: null,
    createdAt: challenge.createdAt.toISOString(),
    executedAt: challenge.executedAt?.toISOString() ?? null,
    resultNotes: challenge.resultNotes,
    hasVoted,
    isOwn,
    canVote: voteBlockedReason === null,
    voteBlockedReason,
  };
}

function toModerationView(challenge: ChallengeRow): ChallengeModerationView {
  const screening = screenContent(challenge.title, challenge.description);

  return {
    ...toView(challenge, null, false),
    moderationStatus: challenge.moderationStatus,
    moderationNotes: challenge.moderationNotes,
    reportCount: challenge.reportCount,
    authorEmail: challenge.author.email,
    contentFlags: screening.flags,
  };
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

export async function createChallenge(userId: string, input: CreateChallengeInput) {
  const showId = await getCurrentShowId();

  const screening = screenContent(input.title, input.description);
  if (screening.verdict === 'block') {
    throw new AppError({
      code: ERROR_CODES.CONTENT_REJECTED,
      message: screening.message ?? 'This challenge cannot be submitted as written.',
      statusCode: 422,
      details: { flags: screening.flags },
    });
  }

  if (input.targetType === 'CONTESTANT' && input.targetContestantId) {
    const contestant = await prisma.contestant.findFirst({
      where: { id: input.targetContestantId, showId, deletedAt: null },
      select: { id: true },
    });
    if (!contestant) throw notFound('That contestant is not in this show');
  }

  // A user with several items already in the pipeline is almost always spamming.
  const inFlight = await prisma.audienceChallenge.count({
    where: {
      authorId: userId,
      deletedAt: null,
      status: { in: ['SUBMITTED', 'MODERATION', 'APPROVED', 'COMMUNITY_VOTING'] },
    },
  });
  if (inFlight >= 5) {
    throw new AppError({
      code: ERROR_CODES.RATE_LIMITED,
      message: 'You already have five challenges awaiting review. Wait for those to be decided.',
      statusCode: 429,
    });
  }

  const challenge = await prisma.audienceChallenge.create({
    data: {
      showId,
      authorId: userId,
      title: input.title,
      description: input.description,
      category: input.category,
      targetType: input.targetType,
      targetContestantId: input.targetType === 'CONTESTANT' ? input.targetContestantId : null,
      status: input.submit ? 'MODERATION' : 'DRAFT',
      // A flagged submission still enters the queue; the flag just tells the
      // moderator where to look first.
      moderationStatus: screening.verdict === 'flag' ? 'ESCALATED' : 'PENDING',
      moderationNotes: screening.flags.length > 0 ? `auto-flags: ${screening.flags.join(', ')}` : null,
    },
    include: CHALLENGE_INCLUDE,
  });

  if (input.submit) {
    await awardPoints({
      userId,
      sourceType: 'CHALLENGE',
      sourceId: challenge.id,
      reason: 'submission',
      ruleKey: 'CHALLENGE_SUBMISSION',
    });
  }

  return toView(challenge, userId, false);
}

export async function updateOwnChallenge(
  challengeId: string,
  userId: string,
  input: Partial<CreateChallengeInput>,
) {
  const challenge = await prisma.audienceChallenge.findFirst({
    where: { id: challengeId, deletedAt: null },
  });
  if (!challenge) throw notFound('That challenge does not exist');
  if (challenge.authorId !== userId) throw forbidden('That is not your challenge');

  if (challenge.status !== 'DRAFT') {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: 'A challenge can only be edited while it is still a draft',
      statusCode: 409,
    });
  }

  if (input.title || input.description) {
    const screening = screenContent(
      input.title ?? challenge.title,
      input.description ?? challenge.description,
    );
    if (screening.verdict === 'block') {
      throw new AppError({
        code: ERROR_CODES.CONTENT_REJECTED,
        message: screening.message ?? 'This challenge cannot be saved as written.',
        statusCode: 422,
      });
    }
  }

  const updated = await prisma.audienceChallenge.update({
    where: { id: challengeId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.targetType !== undefined ? { targetType: input.targetType } : {}),
      ...(input.targetContestantId !== undefined
        ? { targetContestantId: input.targetContestantId }
        : {}),
    },
    include: CHALLENGE_INCLUDE,
  });

  return toView(updated, userId, false);
}

/** Moves an author's own draft into the moderation queue. */
export async function submitChallenge(challengeId: string, userId: string) {
  const challenge = await prisma.audienceChallenge.findFirst({
    where: { id: challengeId, deletedAt: null },
  });
  if (!challenge) throw notFound('That challenge does not exist');
  if (challenge.authorId !== userId) throw forbidden('That is not your challenge');

  assertTransition(challenge.status, 'SUBMITTED');

  const updated = await prisma.audienceChallenge.update({
    where: { id: challengeId },
    data: { status: 'MODERATION' },
    include: CHALLENGE_INCLUDE,
  });

  await awardPoints({
    userId,
    sourceType: 'CHALLENGE',
    sourceId: challengeId,
    reason: 'submission',
    ruleKey: 'CHALLENGE_SUBMISSION',
  });

  return toView(updated, userId, false);
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

export interface VoteResult {
  challengeId: string;
  voteCount: number;
  hasVoted: boolean;
}

export async function voteForChallenge(challengeId: string, userId: string): Promise<VoteResult> {
  const challenge = await prisma.audienceChallenge.findFirst({
    where: { id: challengeId, deletedAt: null },
    select: { id: true, authorId: true, status: true },
  });

  if (!challenge) throw notFound('That challenge does not exist');

  if (!VOTABLE_STATUSES.includes(challenge.status)) {
    throw new AppError({
      code: ERROR_CODES.ROUND_CLOSED,
      message: 'Voting is not open for this challenge',
      statusCode: 409,
    });
  }

  // Self-voting would make the ranking a measure of who has the most accounts.
  if (challenge.authorId === userId) {
    throw new AppError({
      code: ERROR_CODES.SELF_VOTE_FORBIDDEN,
      message: 'You cannot vote for your own challenge',
      statusCode: 403,
    });
  }

  try {
    const [, updated] = await prisma.$transaction([
      prisma.challengeVote.create({ data: { challengeId, userId } }),
      prisma.audienceChallenge.update({
        where: { id: challengeId },
        data: { voteCount: { increment: 1 } },
        select: { voteCount: true },
      }),
    ]);

    return { challengeId, voteCount: updated.voteCount, hasVoted: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(ERROR_CODES.VOTE_DUPLICATE, 'You have already voted for this challenge');
    }
    throw error;
  }
}

export async function withdrawVote(challengeId: string, userId: string): Promise<VoteResult> {
  const deleted = await prisma.challengeVote.deleteMany({ where: { challengeId, userId } });
  if (deleted.count === 0) throw notFound('You have not voted for this challenge');

  const updated = await prisma.audienceChallenge.update({
    where: { id: challengeId },
    data: { voteCount: { decrement: 1 } },
    select: { voteCount: true },
  });

  return { challengeId, voteCount: updated.voteCount, hasVoted: false };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface FeedOptions {
  scope?: 'voting' | 'top' | 'selected' | 'mine' | 'all';
  category?: string;
  cursor?: string;
  limit?: number;
}

export async function getChallengeFeed(viewerId: string | null, options: FeedOptions = {}) {
  const showId = await getCurrentShowId();
  const scope = options.scope ?? 'voting';
  const limit = options.limit ?? 20;

  const where: Prisma.AudienceChallengeWhereInput = {
    showId,
    deletedAt: null,
    ...(options.category ? { category: options.category as never } : {}),
  };

  if (scope === 'voting') where.status = 'COMMUNITY_VOTING';
  else if (scope === 'top') where.status = { in: ['TOP_CHALLENGES', 'PRODUCER_REVIEW'] };
  else if (scope === 'selected') where.status = { in: ['SELECTED', 'EXECUTED', 'COMPLETED'] };
  else if (scope === 'mine') {
    if (!viewerId) return { items: [], nextCursor: null, hasMore: false };
    where.authorId = viewerId;
  } else {
    // "all" still hides drafts and anything a moderator rejected.
    where.status = { notIn: ['DRAFT', 'REJECTED', 'SUBMITTED', 'MODERATION'] };
  }

  const rows = await prisma.audienceChallenge.findMany({
    where,
    include: CHALLENGE_INCLUDE,
    orderBy:
      scope === 'mine'
        ? [{ createdAt: 'desc' }, { id: 'desc' }]
        : [{ voteCount: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  const votedIds = viewerId
    ? new Set(
        (
          await prisma.challengeVote.findMany({
            where: { userId: viewerId, challengeId: { in: items.map((row) => row.id) } },
            select: { challengeId: true },
          })
        ).map((vote) => vote.challengeId),
      )
    : new Set<string>();

  return {
    items: items.map((row, index) => ({
      ...toView(row, viewerId, votedIds.has(row.id)),
      rank: scope === 'mine' ? null : index + 1,
    })),
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    hasMore,
  };
}

export async function getChallenge(challengeId: string, viewerId: string | null) {
  const challenge = await prisma.audienceChallenge.findFirst({
    where: { id: challengeId, deletedAt: null },
    include: CHALLENGE_INCLUDE,
  });

  if (!challenge) throw notFound('That challenge does not exist');

  // Work in progress is visible to its author only.
  const isHidden = ['DRAFT', 'SUBMITTED', 'MODERATION', 'REJECTED'].includes(challenge.status);
  if (isHidden && challenge.authorId !== viewerId) {
    throw notFound('That challenge does not exist');
  }

  const hasVoted = viewerId
    ? (await prisma.challengeVote.count({ where: { challengeId, userId: viewerId } })) > 0
    : false;

  return toView(challenge, viewerId, hasVoted);
}

// ---------------------------------------------------------------------------
// Abuse reporting
// ---------------------------------------------------------------------------

export async function reportChallenge(
  challengeId: string,
  reporterId: string,
  input: ReportChallengeInput,
) {
  const challenge = await prisma.audienceChallenge.findFirst({
    where: { id: challengeId, deletedAt: null },
    select: { id: true, authorId: true, reportCount: true },
  });
  if (!challenge) throw notFound('That challenge does not exist');
  if (challenge.authorId === reporterId) {
    throw forbidden('You cannot report your own challenge');
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.challengeReport.create({
        data: {
          challengeId,
          reporterId,
          reason: input.reason,
          details: input.details ?? null,
        },
      });

      const updated = await tx.audienceChallenge.update({
        where: { id: challengeId },
        data: { reportCount: { increment: 1 } },
        select: { reportCount: true, status: true },
      });

      // Enough independent reports pulls it back for a human to look at, but it
      // is never auto-removed — that decision stays with a moderator.
      if (updated.reportCount >= 3 && updated.status === 'COMMUNITY_VOTING') {
        await tx.audienceChallenge.update({
          where: { id: challengeId },
          data: { moderationStatus: 'ESCALATED' },
        });
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(ERROR_CODES.CONFLICT, 'You have already reported this challenge');
    }
    throw error;
  }

  return { reported: true };
}

// ---------------------------------------------------------------------------
// Moderation and production
// ---------------------------------------------------------------------------

export async function getModerationQueue(options: { reportedOnly?: boolean; limit?: number } = {}) {
  const showId = await getCurrentShowId();

  const rows = await prisma.audienceChallenge.findMany({
    where: {
      showId,
      deletedAt: null,
      ...(options.reportedOnly
        ? { reportCount: { gt: 0 } }
        : { status: { in: ['MODERATION', 'SUBMITTED'] } }),
    },
    include: CHALLENGE_INCLUDE,
    // Escalated and reported items first — that is what a queue is for.
    orderBy: [{ moderationStatus: 'asc' }, { reportCount: 'desc' }, { createdAt: 'asc' }],
    take: options.limit ?? 50,
  });

  return rows.map(toModerationView);
}

export async function moderateChallenge(
  challengeId: string,
  moderatorId: string,
  decision: 'APPROVE' | 'REJECT' | 'ESCALATE',
  reason?: string,
) {
  const challenge = await prisma.audienceChallenge.findFirst({
    where: { id: challengeId, deletedAt: null },
  });
  if (!challenge) throw notFound('That challenge does not exist');

  if (decision === 'ESCALATE') {
    const updated = await prisma.audienceChallenge.update({
      where: { id: challengeId },
      data: { moderationStatus: 'ESCALATED', moderationNotes: reason ?? challenge.moderationNotes },
      include: CHALLENGE_INCLUDE,
    });
    await recordModerationDecision(moderatorId, challengeId, 'ESCALATED', reason);
    return toModerationView(updated);
  }

  const target: ChallengeStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  assertTransition(challenge.status, target);

  const updated = await prisma.audienceChallenge.update({
    where: { id: challengeId },
    data: {
      status: target,
      moderationStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      moderationNotes: reason ?? null,
    },
    include: CHALLENGE_INCLUDE,
  });

  await recordModerationDecision(
    moderatorId,
    challengeId,
    decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    reason,
  );

  if (decision === 'APPROVE') {
    await awardPoints({
      userId: challenge.authorId,
      sourceType: 'CHALLENGE',
      sourceId: challengeId,
      reason: 'approved',
      ruleKey: 'CHALLENGE_APPROVED',
      createdById: moderatorId,
    });
  }

  return toModerationView(updated);
}

async function recordModerationDecision(
  moderatorId: string,
  challengeId: string,
  decision: 'APPROVED' | 'REJECTED' | 'ESCALATED',
  reason?: string,
) {
  await prisma.moderationDecision.create({
    data: {
      moderatorId,
      targetType: 'AudienceChallenge',
      targetId: challengeId,
      decision,
      reason: reason ?? null,
    },
  });
}

/** Opens community voting on an approved challenge. */
export async function openForVoting(challengeId: string, cycleId?: string) {
  const challenge = await prisma.audienceChallenge.findFirstOrThrow({
    where: { id: challengeId, deletedAt: null },
  });
  assertTransition(challenge.status, 'COMMUNITY_VOTING');

  const updated = await prisma.audienceChallenge.update({
    where: { id: challengeId },
    data: { status: 'COMMUNITY_VOTING' },
    include: CHALLENGE_INCLUDE,
  });

  if (cycleId) {
    await prisma.challengeSubmission.upsert({
      where: { challengeId_cycleId: { challengeId, cycleId } },
      update: { status: 'APPROVED' },
      create: { challengeId, cycleId, status: 'APPROVED' },
    });
  }

  return toView(updated, null, false);
}

/**
 * Ranks a cycle's challenges and promotes the top N.
 *
 * Ranking is recomputed from scratch every time, so the result is reproducible
 * and an operator can re-run it after late votes land.
 */
export async function promoteTopChallenges(cycleId: string) {
  const cycle = await prisma.challengeCycle.findUniqueOrThrow({ where: { id: cycleId } });

  const submissions = await prisma.challengeSubmission.findMany({
    where: { cycleId },
    include: {
      challenge: {
        include: { author: { select: { profile: { select: { lifetimePoints: true } } } } },
      },
    },
  });

  const eligible = submissions.filter(
    (submission) => submission.challenge.status === 'COMMUNITY_VOTING',
  );
  if (eligible.length === 0) return { cycleId, promoted: [], ranked: [] };

  const weights = (cycle.rankingConfig as Partial<RankingWeights> | null) ?? DEFAULT_RANKING_WEIGHTS;

  const ranked = rankChallenges(
    eligible.map((submission) => ({
      id: submission.challenge.id,
      voteCount: submission.challenge.voteCount,
      createdAt: submission.challenge.createdAt,
      authorLifetimePoints: submission.challenge.author.profile?.lifetimePoints ?? 0,
    })),
    { cycleOpensAt: cycle.opensAt, cycleClosesAt: cycle.closesAt, weights },
  );

  const topN = ranked.slice(0, cycle.topN);

  for (const entry of ranked) {
    await prisma.challengeSubmission.update({
      where: { challengeId_cycleId: { challengeId: entry.id, cycleId } },
      data: { score: entry.score, rank: entry.rank },
    });
  }

  for (const entry of topN) {
    await prisma.audienceChallenge.update({
      where: { id: entry.id },
      data: { status: 'TOP_CHALLENGES' },
    });

    const challenge = await prisma.audienceChallenge.findUniqueOrThrow({
      where: { id: entry.id },
      select: { authorId: true },
    });

    await awardPoints({
      userId: challenge.authorId,
      sourceType: 'CHALLENGE',
      sourceId: entry.id,
      reason: 'top-challenges',
      ruleKey: 'CHALLENGE_TOP3',
    });
  }

  return { cycleId, promoted: topN, ranked };
}

export async function sendToProducerReview(challengeId: string) {
  const challenge = await prisma.audienceChallenge.findUniqueOrThrow({ where: { id: challengeId } });
  assertTransition(challenge.status, 'PRODUCER_REVIEW');
  const updated = await prisma.audienceChallenge.update({
    where: { id: challengeId },
    data: { status: 'PRODUCER_REVIEW' },
    include: CHALLENGE_INCLUDE,
  });
  return toView(updated, null, false);
}

export async function selectChallenge(challengeId: string, producerId: string) {
  const challenge = await prisma.audienceChallenge.findUniqueOrThrow({ where: { id: challengeId } });
  assertTransition(challenge.status, 'SELECTED');

  const updated = await prisma.audienceChallenge.update({
    where: { id: challengeId },
    data: { status: 'SELECTED', selectedAt: new Date(), selectedById: producerId },
    include: CHALLENGE_INCLUDE,
  });

  await awardPoints({
    userId: challenge.authorId,
    sourceType: 'CHALLENGE',
    sourceId: challengeId,
    reason: 'selected',
    ruleKey: 'CHALLENGE_SELECTED',
    createdById: producerId,
  });

  return toView(updated, null, false);
}

export async function markExecuted(challengeId: string, resultNotes?: string) {
  const challenge = await prisma.audienceChallenge.findUniqueOrThrow({ where: { id: challengeId } });
  assertTransition(challenge.status, 'EXECUTED');

  const updated = await prisma.audienceChallenge.update({
    where: { id: challengeId },
    data: { status: 'EXECUTED', executedAt: new Date(), resultNotes: resultNotes ?? null },
    include: CHALLENGE_INCLUDE,
  });
  return toView(updated, null, false);
}

export async function markCompleted(challengeId: string, resultNotes?: string) {
  const challenge = await prisma.audienceChallenge.findUniqueOrThrow({ where: { id: challengeId } });
  assertTransition(challenge.status, 'COMPLETED');

  const updated = await prisma.audienceChallenge.update({
    where: { id: challengeId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      ...(resultNotes ? { resultNotes } : {}),
    },
    include: CHALLENGE_INCLUDE,
  });
  return toView(updated, null, false);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
