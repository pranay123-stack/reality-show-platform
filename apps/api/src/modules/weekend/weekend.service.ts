import type { Prisma, WeekendRoundStatus } from '@prisma/client';
import {
  ERROR_CODES,
  type ConfigureRewardsInput,
  type CreateWeekendRoundInput,
  type MySubmissionView,
  type WeekendRoundView,
  type WeekendSubmissionInput,
} from '@reality/shared';

import { AppError, conflict, forbidden, notFound } from '../../core/errors.js';
import { track } from '../analytics/analytics.service.js';
import { emitDomainEvent } from '../../core/domain-events.js';
import { prisma } from '../../core/prisma.js';
import { screenContent } from '../challenges/content-moderation.js';
import { awardPoints } from '../points/points.service.js';
import { getCurrentShowId } from '../show/show.service.js';
import {
  describeRewards,
  evaluateEligibility,
  parseEligibilityConfig,
  requiresPhysicalAuthorisation,
  type EngagementSnapshot,
} from './eligibility.js';

/**
 * Weekend Participation.
 *
 * A weekly funnel:
 *
 *   OPEN → SUBMIT → MODERATION → SHORTLIST → PRODUCER_SELECTION → SELECTED → COMPLETED
 *
 * Two rules matter more than the mechanics:
 *
 *  1. **Eligibility is earned.** A user qualifies through genuine participation
 *     across several features, not by farming one of them.
 *  2. **No unauthorised promises.** Physical appearances, house visits and
 *     meetings are off by default and cannot be implied by accident — see
 *     `describeRewards` and `configureRewards`.
 */

const TRANSITIONS: Record<WeekendRoundStatus, WeekendRoundStatus[]> = {
  OPEN: ['SUBMIT', 'CANCELLED'],
  SUBMIT: ['MODERATION', 'CANCELLED'],
  MODERATION: ['SHORTLIST', 'CANCELLED'],
  SHORTLIST: ['PRODUCER_SELECTION', 'CANCELLED'],
  PRODUCER_SELECTION: ['SELECTED', 'CANCELLED'],
  SELECTED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

function assertTransition(from: WeekendRoundStatus, to: WeekendRoundStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: `A weekend round cannot go from ${from} to ${to}`,
      statusCode: 409,
    });
  }
}

/** Submissions are only accepted while the round is taking them. */
const ACCEPTING_STATUSES: WeekendRoundStatus[] = ['OPEN', 'SUBMIT'];

const ROUND_INCLUDE = {
  questions: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.WeekendParticipationRoundInclude;

type RoundRow = Prisma.WeekendParticipationRoundGetPayload<{ include: typeof ROUND_INCLUDE }>;

function acceptsSubmissions(round: {
  status: WeekendRoundStatus;
  opensAt: Date;
  submissionDeadline: Date;
}): boolean {
  const now = Date.now();
  return (
    ACCEPTING_STATUSES.includes(round.status) &&
    round.opensAt.getTime() <= now &&
    round.submissionDeadline.getTime() > now
  );
}

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------

/**
 * Gathers the user's participation across the platform.
 *
 * Counted from the vote and submission tables rather than from points, so a
 * producer changing a point value cannot accidentally change who is eligible.
 * `distinctFeatures` is the anti-gaming signal: how many *different* parts of
 * the show a person has actually joined in with.
 */
export async function getEngagement(userId: string): Promise<EngagementSnapshot> {
  const [user, predictions, polls, challenges, perspectives, nominations, evictions, kitchen] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          status: true,
          emailVerifiedAt: true,
          profile: { select: { lifetimePoints: true, pointsBalance: true } },
        },
      }),
      prisma.predictionEntry.count({ where: { userId } }),
      prisma.pollVote.count({ where: { userId } }),
      prisma.audienceChallenge.count({ where: { authorId: userId, deletedAt: null } }),
      prisma.perspectiveVote.count({ where: { userId } }),
      prisma.nominationVote.count({ where: { userId } }),
      prisma.evictionVote.count({ where: { userId } }),
      prisma.kitchenVote.count({ where: { userId } }),
    ]);

  const perFeature = [predictions, polls, challenges, perspectives, nominations, evictions, kitchen];

  return {
    points: user?.profile?.lifetimePoints ?? 0,
    activities: perFeature.reduce((sum, count) => sum + count, 0),
    distinctFeatures: perFeature.filter((count) => count > 0).length,
    emailVerified: user?.emailVerifiedAt !== null && user?.emailVerifiedAt !== undefined,
    accountStatus: user?.status ?? 'PENDING_VERIFICATION',
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function toMySubmission(submission: {
  id: string;
  participationType: string;
  questionId: string | null;
  contestantId: string | null;
  content: string;
  mediaUrl: string | null;
  status: string;
  moderationStatus: string;
  shortlistedAt: Date | null;
  createdAt: Date;
  selection: { position: number; completedAt: Date | null } | null;
}): MySubmissionView {
  return {
    id: submission.id,
    participationType: submission.participationType as MySubmissionView['participationType'],
    questionId: submission.questionId,
    contestantId: submission.contestantId,
    content: submission.content,
    mediaUrl: submission.mediaUrl,
    status: submission.status,
    // The author sees the outcome, never a moderator's private notes, and an
    // escalated item simply reads as still pending.
    moderationOutcome:
      submission.moderationStatus === 'APPROVED'
        ? 'APPROVED'
        : submission.moderationStatus === 'REJECTED'
          ? 'REJECTED'
          : 'PENDING',
    shortlisted: submission.shortlistedAt !== null,
    selected: submission.selection !== null,
    selectionPosition: submission.selection?.position ?? null,
    completedAt: submission.selection?.completedAt?.toISOString() ?? null,
    createdAt: submission.createdAt.toISOString(),
  };
}

async function buildRoundView(
  round: RoundRow,
  userId: string | null,
): Promise<WeekendRoundView> {
  const config = parseEligibilityConfig(round.eligibilityConfig);

  const [totalSubmissions, mySubmissions, engagement, selections] = await Promise.all([
    prisma.weekendSubmission.count({ where: { roundId: round.id, deletedAt: null } }),
    userId
      ? prisma.weekendSubmission.findMany({
          where: { roundId: round.id, userId, deletedAt: null },
          include: { selection: true },
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve([]),
    userId ? getEngagement(userId) : Promise.resolve(null),
    round.status === 'SELECTED' || round.status === 'COMPLETED'
      ? prisma.weekendSelection.findMany({
          where: { roundId: round.id },
          orderBy: { position: 'asc' },
          include: {
            submission: {
              include: { user: { select: { profile: { select: { displayName: true } } } } },
            },
          },
        })
      : Promise.resolve(null),
  ]);

  const eligibility = engagement
    ? evaluateEligibility(engagement, config)
    : {
        eligible: false,
        requirements: [],
        blockers: ['Sign in to see whether you are eligible.'],
      };

  const usedTypes = new Set(mySubmissions.map((submission) => submission.participationType));

  return {
    id: round.id,
    title: round.title,
    description: round.description,
    status: round.status,
    participationTypes: round.participationTypes,
    opensAt: round.opensAt.toISOString(),
    submissionDeadline: round.submissionDeadline.toISOString(),
    closesAt: round.closesAt.toISOString(),
    submissionsOpen: acceptsSubmissions(round),
    shortlistSize: round.shortlistSize,
    selectionCount: round.selectionCount,
    totalSubmissions,
    questions: round.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      type: question.type,
      sortOrder: question.sortOrder,
      required: question.required,
      maxLength: question.maxLength,
    })),
    eligibility,
    rewards: describeRewards(round),
    mySubmissions: mySubmissions.map(toMySubmission),
    availableTypes: round.participationTypes.filter((type) => !usedTypes.has(type)),
    selections:
      selections?.map((selection) => ({
        position: selection.position,
        displayName: selection.submission.user.profile?.displayName ?? 'Viewer',
        participationType: selection.submission.participationType,
        content: selection.submission.content,
        completedAt: selection.completedAt?.toISOString() ?? null,
      })) ?? null,
  };
}

export async function getCurrentRound(userId: string | null): Promise<WeekendRoundView | null> {
  const showId = await getCurrentShowId();

  const round = await prisma.weekendParticipationRound.findFirst({
    where: { showId, status: { not: 'CANCELLED' } },
    include: ROUND_INCLUDE,
    orderBy: [{ submissionDeadline: 'desc' }],
  });

  if (!round) return null;
  return buildRoundView(round, userId);
}

export async function getRound(roundId: string, userId: string | null): Promise<WeekendRoundView> {
  const round = await prisma.weekendParticipationRound.findUnique({
    where: { id: roundId },
    include: ROUND_INCLUDE,
  });
  if (!round) throw notFound('That weekend round does not exist');
  return buildRoundView(round, userId);
}

export async function getMyEligibility(userId: string, roundId?: string) {
  const engagement = await getEngagement(userId);

  const config = roundId
    ? parseEligibilityConfig(
        (
          await prisma.weekendParticipationRound.findUnique({
            where: { id: roundId },
            select: { eligibilityConfig: true },
          })
        )?.eligibilityConfig,
      )
    : undefined;

  return { engagement, eligibility: evaluateEligibility(engagement, config) };
}

// ---------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------

export interface SubmitResult {
  submission: MySubmissionView;
  round: WeekendRoundView;
  pointsAwarded: number;
}

export async function submitEntry(
  roundId: string,
  userId: string,
  input: WeekendSubmissionInput,
): Promise<SubmitResult> {
  const round = await prisma.weekendParticipationRound.findUnique({
    where: { id: roundId },
    include: ROUND_INCLUDE,
  });
  if (!round) throw notFound('That weekend round does not exist');

  if (!acceptsSubmissions(round)) {
    throw new AppError({
      code: ERROR_CODES.SUBMISSION_CLOSED,
      message:
        round.status === 'CANCELLED'
          ? 'This weekend round was cancelled'
          : !ACCEPTING_STATUSES.includes(round.status)
            ? 'This weekend round is no longer taking submissions'
            : round.opensAt.getTime() > Date.now()
              ? 'This weekend round has not opened yet'
              : 'The submission deadline has passed',
      statusCode: 409,
    });
  }

  if (!round.participationTypes.includes(input.participationType)) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'That kind of entry is not open in this round',
      statusCode: 400,
    });
  }

  // Eligibility is checked here, not just rendered in the UI.
  const engagement = await getEngagement(userId);
  const eligibility = evaluateEligibility(engagement, parseEligibilityConfig(round.eligibilityConfig));
  if (!eligibility.eligible) {
    throw new AppError({
      code: ERROR_CODES.NOT_ELIGIBLE,
      message: eligibility.blockers[0] ?? 'You are not eligible for this round yet',
      statusCode: 403,
      details: { requirements: eligibility.requirements },
    });
  }

  if (input.questionId) {
    const question = round.questions.find((candidate) => candidate.id === input.questionId);
    if (!question) throw notFound('That question is not part of this round');
    if (input.content.length > question.maxLength) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: `That answer is longer than the ${question.maxLength} characters allowed`,
        statusCode: 400,
      });
    }
  }

  if (input.contestantId) {
    const showId = await getCurrentShowId();
    const contestant = await prisma.contestant.findFirst({
      where: { id: input.contestantId, showId, deletedAt: null },
      select: { id: true },
    });
    if (!contestant) throw notFound('That contestant is not in this show');
  }

  // The same screening the challenge module uses: block abuse outright, flag
  // anything merely suspicious for a human.
  const screening = screenContent(input.content);
  if (screening.verdict === 'block') {
    throw new AppError({
      code: ERROR_CODES.CONTENT_REJECTED,
      message: screening.message ?? 'This entry cannot be submitted as written.',
      statusCode: 422,
      details: { flags: screening.flags },
    });
  }

  let submission;
  try {
    submission = await prisma.weekendSubmission.create({
      data: {
        roundId,
        userId,
        questionId: input.questionId ?? null,
        contestantId: input.contestantId ?? null,
        participationType: input.participationType,
        content: input.content,
        mediaUrl: input.mediaUrl ?? null,
        status: 'SUBMITTED',
        moderationStatus: screening.verdict === 'flag' ? 'ESCALATED' : 'PENDING',
        moderationNotes:
          screening.flags.length > 0 ? `auto-flags: ${screening.flags.join(', ')}` : null,
      },
      include: { selection: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(
        ERROR_CODES.CONFLICT,
        'You have already submitted that kind of entry for this weekend',
      );
    }
    throw error;
  }

  const award = await awardPoints({
    userId,
    sourceType: 'WEEKEND',
    sourceId: roundId,
    reason: 'submission',
    ruleKey: 'WEEKEND_SUBMISSION',
  });

  void track({ name: 'weekend_submitted', userId, entityId: round.id });

  return {
    submission: toMySubmission(submission),
    round: await getRound(roundId, userId),
    pointsAwarded: award.delta,
  };
}

export async function withdrawEntry(submissionId: string, userId: string) {
  const submission = await prisma.weekendSubmission.findFirst({
    where: { id: submissionId, deletedAt: null },
    include: { round: true, selection: true },
  });
  if (!submission) throw notFound('That entry does not exist');
  if (submission.userId !== userId) throw forbidden('That is not your entry');

  if (submission.selection) {
    throw conflict(
      ERROR_CODES.CONFLICT,
      'That entry has been selected for the show and can no longer be withdrawn',
    );
  }
  if (!acceptsSubmissions(submission.round)) {
    throw new AppError({
      code: ERROR_CODES.SUBMISSION_CLOSED,
      message: 'Entries cannot be withdrawn after the deadline',
      statusCode: 409,
    });
  }

  // Soft delete: the moderation trail should survive a withdrawal.
  await prisma.weekendSubmission.update({
    where: { id: submissionId },
    data: { deletedAt: new Date() },
  });

  return { withdrawn: true };
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

export async function getSubmissionQueue(
  roundId: string,
  options: { status?: string; limit?: number } = {},
) {
  const submissions = await prisma.weekendSubmission.findMany({
    where: {
      roundId,
      deletedAt: null,
      ...(options.status ? { status: options.status as never } : {}),
    },
    include: {
      user: { select: { id: true, email: true, profile: { select: { displayName: true } } } },
      question: { select: { id: true, prompt: true } },
      contestant: { select: { id: true, displayName: true } },
      selection: true,
    },
    orderBy: [{ moderationStatus: 'asc' }, { score: 'desc' }, { createdAt: 'asc' }],
    take: options.limit ?? 50,
  });

  return submissions.map((submission) => ({
    id: submission.id,
    participationType: submission.participationType,
    content: submission.content,
    mediaUrl: submission.mediaUrl,
    status: submission.status,
    moderationStatus: submission.moderationStatus,
    moderationNotes: submission.moderationNotes,
    score: submission.score,
    shortlisted: submission.shortlistedAt !== null,
    selected: submission.selection !== null,
    author: {
      id: submission.user.id,
      displayName: submission.user.profile?.displayName ?? 'Viewer',
      email: submission.user.email,
    },
    question: submission.question,
    contestant: submission.contestant,
    contentFlags: screenContent(submission.content).flags,
    createdAt: submission.createdAt.toISOString(),
  }));
}

export async function moderateSubmission(
  submissionId: string,
  moderatorId: string,
  decision: 'APPROVE' | 'REJECT' | 'ESCALATE',
  reason?: string,
) {
  const submission = await prisma.weekendSubmission.findFirst({
    where: { id: submissionId, deletedAt: null },
  });
  if (!submission) throw notFound('That entry does not exist');

  const moderationStatus =
    decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'ESCALATED';
  const status =
    decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'IN_MODERATION';

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.weekendSubmission.update({
      where: { id: submissionId },
      data: { moderationStatus, status, moderationNotes: reason ?? submission.moderationNotes },
    });

    await tx.moderationDecision.create({
      data: {
        moderatorId,
        targetType: 'WeekendSubmission',
        targetId: submissionId,
        decision: moderationStatus,
        reason: reason ?? null,
      },
    });

    return result;
  });

  if (decision === 'REJECT') {
    await emitDomainEvent({
      event: 'weekend.submission_rejected',
      entityId: submissionId,
      payload: {
        userId: submission.userId,
        reason: reason ?? 'It did not meet the entry guidelines.',
      },
    });
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Shortlist and selection
// ---------------------------------------------------------------------------

export async function shortlistSubmissions(
  roundId: string,
  submissionIds: string[],
  actorId: string,
) {
  const round = await prisma.weekendParticipationRound.findUniqueOrThrow({
    where: { id: roundId },
  });

  if (submissionIds.length > round.shortlistSize) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: `This round shortlists at most ${round.shortlistSize} entries`,
      statusCode: 400,
    });
  }

  const submissions = await prisma.weekendSubmission.findMany({
    where: { id: { in: submissionIds }, roundId, deletedAt: null },
  });
  if (submissions.length !== submissionIds.length) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'One or more entries do not belong to this round',
      statusCode: 400,
    });
  }

  // Only moderated entries can be shortlisted — the funnel has no back door.
  const unmoderated = submissions.filter((submission) => submission.moderationStatus !== 'APPROVED');
  if (unmoderated.length > 0) {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: 'Every shortlisted entry must be approved by a moderator first',
      statusCode: 409,
      details: { unmoderatedIds: unmoderated.map((submission) => submission.id) },
    });
  }

  await prisma.$transaction([
    // Replacing the shortlist clears the previous one, so the set always
    // reflects the latest decision rather than accumulating.
    prisma.weekendSubmission.updateMany({
      where: { roundId, shortlistedAt: { not: null } },
      data: { shortlistedAt: null, status: 'APPROVED' },
    }),
    prisma.weekendSubmission.updateMany({
      where: { id: { in: submissionIds } },
      data: { shortlistedAt: new Date(), status: 'SHORTLISTED' },
    }),
  ]);

  for (const submission of submissions) {
    await awardPoints({
      userId: submission.userId,
      sourceType: 'WEEKEND',
      sourceId: roundId,
      reason: `shortlisted:${submission.id}`,
      ruleKey: 'WEEKEND_SHORTLISTED',
      createdById: actorId,
    });
  }

  return { shortlisted: submissionIds.length };
}

export async function selectSubmission(
  roundId: string,
  submissionId: string,
  actorId: string,
  options: { position?: number; notes?: string } = {},
) {
  const round = await prisma.weekendParticipationRound.findUniqueOrThrow({
    where: { id: roundId },
  });

  const submission = await prisma.weekendSubmission.findFirst({
    where: { id: submissionId, roundId, deletedAt: null },
  });
  if (!submission) throw notFound('That entry does not exist in this round');

  if (submission.shortlistedAt === null) {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: 'Only a shortlisted entry can be selected',
      statusCode: 409,
    });
  }

  const alreadySelected = await prisma.weekendSelection.count({ where: { roundId } });
  if (alreadySelected >= round.selectionCount) {
    throw new AppError({
      code: ERROR_CODES.CONFLICT,
      message: `This round selects at most ${round.selectionCount} entries`,
      statusCode: 409,
    });
  }

  const position = options.position ?? alreadySelected + 1;

  try {
    await prisma.$transaction([
      prisma.weekendSelection.create({
        data: {
          roundId,
          submissionId,
          position,
          selectedById: actorId,
          notes: options.notes ?? null,
        },
      }),
      prisma.weekendSubmission.update({
        where: { id: submissionId },
        data: { status: 'SELECTED' },
      }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(
        ERROR_CODES.CONFLICT,
        'That entry is already selected, or that position is taken',
      );
    }
    throw error;
  }

  await awardPoints({
    userId: submission.userId,
    sourceType: 'WEEKEND',
    sourceId: roundId,
    reason: `selected:${submissionId}`,
    ruleKey: 'WEEKEND_SELECTED',
    createdById: actorId,
  });

  await emitDomainEvent({
    event: 'weekend.submission_selected',
    entityId: submissionId,
    payload: { userId: submission.userId, title: round.title },
  });

  return getRound(roundId, null);
}

export async function completeSelection(
  roundId: string,
  submissionId: string,
  notes?: string,
) {
  const selection = await prisma.weekendSelection.findFirst({ where: { roundId, submissionId } });
  if (!selection) throw notFound('That entry was not selected');

  await prisma.$transaction([
    prisma.weekendSelection.update({
      where: { id: selection.id },
      data: { completedAt: new Date(), ...(notes ? { notes } : {}) },
    }),
    prisma.weekendSubmission.update({
      where: { id: submissionId },
      data: { status: 'COMPLETED' },
    }),
  ]);

  return { completed: true };
}

// ---------------------------------------------------------------------------
// Operator lifecycle
// ---------------------------------------------------------------------------

export async function createRound(input: CreateWeekendRoundInput, actorId: string) {
  const showId = await getCurrentShowId();

  // A round cannot offer an in-person type at creation: enabling that is a
  // separate, permission-gated step with a mandatory disclaimer.
  if (requiresPhysicalAuthorisation(input.participationTypes)) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message:
        'An in-person opportunity must be authorised separately by production before it can be offered',
      statusCode: 403,
    });
  }

  return prisma.weekendParticipationRound.create({
    data: {
      showId,
      episodeId: input.episodeId ?? null,
      title: input.title,
      description: input.description ?? null,
      status: 'OPEN',
      participationTypes: input.participationTypes,
      opensAt: new Date(input.opensAt),
      submissionDeadline: new Date(input.submissionDeadline),
      closesAt: new Date(input.closesAt),
      shortlistSize: input.shortlistSize,
      selectionCount: input.selectionCount,
      ...(input.eligibility ? { eligibilityConfig: input.eligibility as Prisma.InputJsonValue } : {}),
      allowPhysicalRewards: false,
      createdById: actorId,
      ...(input.questions && input.questions.length > 0
        ? {
            questions: {
              create: input.questions.map((question, index) => ({
                prompt: question.prompt,
                type: question.type,
                sortOrder: question.sortOrder ?? index,
                required: question.required ?? false,
                ...(question.maxLength !== undefined ? { maxLength: question.maxLength } : {}),
              })),
            },
          }
        : {}),
    },
    include: ROUND_INCLUDE,
  });
}

/**
 * Turns an in-person opportunity on or off for a round.
 *
 * Requires the `weekend.physical_rewards` permission (checked on the route), an
 * explicit acknowledgement and a disclaimer (checked by the schema). Who
 * enabled it is recorded, because "who authorised this" is exactly the question
 * that gets asked afterwards.
 */
export async function configureRewards(
  roundId: string,
  actorId: string,
  input: ConfigureRewardsInput,
) {
  const round = await prisma.weekendParticipationRound.findUniqueOrThrow({
    where: { id: roundId },
  });

  if (!input.allowPhysicalRewards && requiresPhysicalAuthorisation(round.participationTypes)) {
    throw new AppError({
      code: ERROR_CODES.CONFLICT,
      message:
        'This round offers an in-person entry type; remove it before withdrawing authorisation',
      statusCode: 409,
    });
  }

  return prisma.weekendParticipationRound.update({
    where: { id: roundId },
    data: {
      allowPhysicalRewards: input.allowPhysicalRewards,
      rewardDisclaimer: input.rewardDisclaimer ?? null,
      enabledById: input.allowPhysicalRewards ? actorId : null,
    },
  });
}

/** Adds an in-person entry type, only to a round already authorised for one. */
export async function addParticipationType(
  roundId: string,
  type: string,
): Promise<void> {
  const round = await prisma.weekendParticipationRound.findUniqueOrThrow({
    where: { id: roundId },
  });

  if (requiresPhysicalAuthorisation([type]) && !round.allowPhysicalRewards) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message:
        'This round has not been authorised by production for an in-person opportunity',
      statusCode: 403,
    });
  }

  if (round.participationTypes.includes(type as never)) return;

  await prisma.weekendParticipationRound.update({
    where: { id: roundId },
    data: { participationTypes: { push: type as never } },
  });
}

export async function advanceRound(roundId: string, to: WeekendRoundStatus) {
  const round = await prisma.weekendParticipationRound.findUniqueOrThrow({
    where: { id: roundId },
  });
  assertTransition(round.status, to);

  const updated = await prisma.weekendParticipationRound.update({
    where: { id: roundId },
    data: { status: to },
  });

  // SUBMIT is the moment entries actually open, which is the only transition
  // worth interrupting everybody for.
  if (to === 'SUBMIT') {
    await emitDomainEvent({
      event: 'weekend.round_opened',
      entityId: roundId,
      payload: { title: round.title },
    });
  }

  return updated;
}

export async function listRounds() {
  const showId = await getCurrentShowId();
  return prisma.weekendParticipationRound.findMany({
    where: { showId },
    include: ROUND_INCLUDE,
    orderBy: { submissionDeadline: 'desc' },
    take: 20,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
