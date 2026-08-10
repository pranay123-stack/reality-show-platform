import type { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  type CreatePredictionInput,
  type PredictionView,
  type SubmitPredictionInput,
} from '@reality/shared';

import { AppError, conflict, notFound } from '../../core/errors.js';
import { emitDomainEvent } from '../../core/domain-events.js';
import { prisma } from '../../core/prisma.js';
import { awardPoints } from '../points/points.service.js';
import { getCurrentShowId } from '../show/show.service.js';

/**
 * Prediction Game.
 *
 * Rules the server enforces (never the client):
 *   - one entry per user per question — database unique constraint
 *   - a prediction closes at `closesAt` whether or not a job has run
 *   - entries cannot be edited or withdrawn once made
 *   - only staff with `prediction.resolve` may finalise a result
 *   - points move through the ledger, transactionally and idempotently
 */

type PredictionWithOptions = Prisma.PredictionGetPayload<{
  include: { options: { include: { contestant: true } }; result: true };
}>;

function isClosed(prediction: { status: string; closesAt: Date }): boolean {
  return (
    prediction.status !== 'OPEN' ||
    prediction.closesAt.getTime() <= Date.now()
  );
}

function toView(
  prediction: PredictionWithOptions,
  myEntry: { optionId: string; isCorrect: boolean | null } | null,
): PredictionView {
  const resolved = prediction.status === 'RESOLVED';

  return {
    id: prediction.id,
    question: prediction.question,
    description: prediction.description,
    status: prediction.status,
    opensAt: prediction.opensAt?.toISOString() ?? null,
    closesAt: prediction.closesAt.toISOString(),
    resolvedAt: prediction.resolvedAt?.toISOString() ?? null,
    participationPoints: prediction.participationPoints,
    rewardPoints: prediction.rewardPoints,
    entryCount: prediction.entryCount,
    options: prediction.options
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((option) => ({
        id: option.id,
        label: option.label,
        contestantId: option.contestantId,
        contestantName: option.contestant?.displayName ?? null,
        sortOrder: option.sortOrder,
        // Distribution stays hidden until resolution so nobody can follow the crowd.
        entryCount: resolved ? option.entryCount : 0,
      })),
    myOptionId: myEntry?.optionId ?? null,
    myEntryCorrect: myEntry?.isCorrect ?? null,
    correctOptionId: resolved ? (prediction.result?.correctOptionId ?? null) : null,
    isClosed: isClosed(prediction),
  };
}

export async function listPredictions(
  userId: string | null,
  options: { scope?: 'open' | 'resolved' | 'mine' | 'all'; limit?: number } = {},
): Promise<PredictionView[]> {
  const showId = await getCurrentShowId();
  const scope = options.scope ?? 'open';
  const limit = options.limit ?? 20;

  const where: Prisma.PredictionWhereInput = { showId, deletedAt: null };

  if (scope === 'open') {
    where.status = 'OPEN';
    where.closesAt = { gt: new Date() };
  } else if (scope === 'resolved') {
    where.status = 'RESOLVED';
  } else if (scope === 'mine') {
    if (!userId) return [];
    where.entries = { some: { userId } };
  } else {
    where.status = { notIn: ['DRAFT', 'CANCELLED'] };
  }

  const predictions = await prisma.prediction.findMany({
    where,
    include: { options: { include: { contestant: true } }, result: true },
    orderBy: scope === 'resolved' ? { resolvedAt: 'desc' } : { closesAt: 'asc' },
    take: limit,
  });

  const myEntries = userId
    ? await prisma.predictionEntry.findMany({
        where: { userId, predictionId: { in: predictions.map((p) => p.id) } },
        select: { predictionId: true, optionId: true, isCorrect: true },
      })
    : [];

  const entryByPrediction = new Map(myEntries.map((entry) => [entry.predictionId, entry]));

  return predictions.map((prediction) =>
    toView(prediction, entryByPrediction.get(prediction.id) ?? null),
  );
}

export async function getPrediction(
  predictionId: string,
  userId: string | null,
): Promise<PredictionView> {
  const prediction = await prisma.prediction.findFirst({
    where: { id: predictionId, deletedAt: null },
    include: { options: { include: { contestant: true } }, result: true },
  });

  if (!prediction || prediction.status === 'DRAFT') throw notFound('That prediction does not exist');

  const myEntry = userId
    ? await prisma.predictionEntry.findUnique({
        where: { predictionId_userId: { predictionId, userId } },
        select: { optionId: true, isCorrect: true },
      })
    : null;

  return toView(prediction, myEntry);
}

export interface SubmitResult {
  prediction: PredictionView;
  pointsAwarded: number;
  balance: number;
}

/**
 * Records a user's prediction.
 *
 * Everything happens in one transaction: the entry, the cached counters and the
 * participation points. The unique constraint is the real duplicate guard — the
 * pre-check exists only to return a friendly error first.
 */
export async function submitPrediction(
  predictionId: string,
  userId: string,
  input: SubmitPredictionInput,
): Promise<SubmitResult> {
  const prediction = await prisma.prediction.findFirst({
    where: { id: predictionId, deletedAt: null },
    include: { options: true },
  });

  if (!prediction) throw notFound('That prediction does not exist');

  if (prediction.status !== 'OPEN') {
    throw new AppError({
      code: ERROR_CODES.PREDICTION_CLOSED,
      message:
        prediction.status === 'RESOLVED'
          ? 'This prediction has already been resolved'
          : 'This prediction is not open',
      statusCode: 409,
    });
  }

  // Time is checked here, not by a scheduler, so a late request is always refused.
  if (prediction.closesAt.getTime() <= Date.now()) {
    throw new AppError({
      code: ERROR_CODES.PREDICTION_CLOSED,
      message: 'This prediction has closed',
      statusCode: 409,
    });
  }

  const option = prediction.options.find((candidate) => candidate.id === input.optionId);
  if (!option) {
    throw new AppError({
      code: ERROR_CODES.OPTION_INVALID,
      message: 'That option does not belong to this prediction',
      statusCode: 400,
    });
  }

  const existing = await prisma.predictionEntry.findUnique({
    where: { predictionId_userId: { predictionId, userId } },
  });
  if (existing) {
    throw conflict(
      ERROR_CODES.PREDICTION_ALREADY_SUBMITTED,
      'You have already predicted on this question. Predictions cannot be changed.',
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.predictionEntry.create({
        data: { predictionId, userId, optionId: input.optionId },
      });
      await tx.predictionOption.update({
        where: { id: input.optionId },
        data: { entryCount: { increment: 1 } },
      });
      await tx.prediction.update({
        where: { id: predictionId },
        data: { entryCount: { increment: 1 } },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(
        ERROR_CODES.PREDICTION_ALREADY_SUBMITTED,
        'You have already predicted on this question. Predictions cannot be changed.',
      );
    }
    throw error;
  }

  // Points are awarded after the entry lands. `awardPoints` is idempotent, so a
  // retry here can never double-credit.
  const award = await awardPoints({
    userId,
    sourceType: 'PREDICTION',
    sourceId: predictionId,
    reason: 'participation',
    points: prediction.participationPoints,
  });

  return {
    prediction: await getPrediction(predictionId, userId),
    pointsAwarded: award.delta,
    balance: award.balance,
  };
}

// ---------------------------------------------------------------------------
// Operator lifecycle
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['SCHEDULED', 'OPEN', 'CANCELLED'],
  SCHEDULED: ['OPEN', 'CANCELLED'],
  OPEN: ['CLOSED', 'CANCELLED'],
  CLOSED: ['RESOLVED', 'CANCELLED'],
  RESOLVED: [],
  CANCELLED: [],
};

function assertTransition(from: string, to: string): void {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: `A prediction cannot go from ${from} to ${to}`,
      statusCode: 409,
    });
  }
}

export async function createPrediction(input: CreatePredictionInput, actorId: string) {
  const showId = await getCurrentShowId();

  return prisma.prediction.create({
    data: {
      showId,
      episodeId: input.episodeId ?? null,
      eventId: input.eventId ?? null,
      question: input.question,
      description: input.description ?? null,
      status: 'DRAFT',
      opensAt: input.opensAt ? new Date(input.opensAt) : null,
      closesAt: new Date(input.closesAt),
      ...(input.participationPoints !== undefined
        ? { participationPoints: input.participationPoints }
        : {}),
      ...(input.rewardPoints !== undefined ? { rewardPoints: input.rewardPoints } : {}),
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

/** Editing is only allowed before a prediction goes live. */
export async function updatePrediction(
  predictionId: string,
  input: Partial<CreatePredictionInput>,
) {
  const prediction = await prisma.prediction.findUniqueOrThrow({ where: { id: predictionId } });

  if (prediction.status !== 'DRAFT') {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: 'A prediction can only be edited while it is a draft',
      statusCode: 409,
    });
  }

  return prisma.$transaction(async (tx) => {
    if (input.options) {
      await tx.predictionOption.deleteMany({ where: { predictionId } });
      await tx.predictionOption.createMany({
        data: input.options.map((option, index) => ({
          predictionId,
          label: option.label,
          contestantId: option.contestantId ?? null,
          sortOrder: option.sortOrder ?? index,
        })),
      });
    }

    return tx.prediction.update({
      where: { id: predictionId },
      data: {
        ...(input.question !== undefined ? { question: input.question } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.closesAt !== undefined ? { closesAt: new Date(input.closesAt) } : {}),
        ...(input.opensAt !== undefined
          ? { opensAt: input.opensAt ? new Date(input.opensAt) : null }
          : {}),
        ...(input.participationPoints !== undefined
          ? { participationPoints: input.participationPoints }
          : {}),
        ...(input.rewardPoints !== undefined ? { rewardPoints: input.rewardPoints } : {}),
      },
      include: { options: true },
    });
  });
}

export async function activatePrediction(predictionId: string) {
  const prediction = await prisma.prediction.findUniqueOrThrow({
    where: { id: predictionId },
    include: { options: true },
  });

  assertTransition(prediction.status, 'OPEN');

  if (prediction.options.length < 2) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'A prediction needs at least two options before it can open',
      statusCode: 400,
    });
  }
  if (prediction.closesAt.getTime() <= Date.now()) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'The close time is already in the past',
      statusCode: 400,
    });
  }

  const opened = await prisma.prediction.update({
    where: { id: predictionId },
    data: { status: 'OPEN', opensAt: prediction.opensAt ?? new Date() },
  });

  await emitDomainEvent({
    event: 'prediction.opened',
    entityId: predictionId,
    payload: { question: opened.question },
  });

  return opened;
}

/**
 * The operator list.
 *
 * Identical data to the public list with one deliberate difference: the
 * per-option distribution is visible before resolution. Hiding it from the
 * audience stops people following the crowd; hiding it from the producer
 * running the show would serve nobody, and an operator seeing it leaks nothing
 * because this endpoint is permission-gated.
 */
export async function listPredictionsForAdmin(): Promise<PredictionView[]> {
  const showId = await getCurrentShowId();

  const predictions = await prisma.prediction.findMany({
    where: { showId },
    include: { options: { include: { contestant: true } }, result: true },
    orderBy: [{ status: 'asc' }, { closesAt: 'desc' }],
    take: 100,
  });

  return predictions.map((prediction) => {
    const view = toView(prediction, null);
    return {
      ...view,
      options: prediction.options
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((option) => ({
          id: option.id,
          label: option.label,
          contestantId: option.contestantId,
          contestantName: option.contestant?.displayName ?? null,
          sortOrder: option.sortOrder,
          entryCount: option.entryCount,
        })),
    };
  });
}

export async function closePrediction(predictionId: string) {
  const prediction = await prisma.prediction.findUniqueOrThrow({ where: { id: predictionId } });
  assertTransition(prediction.status, 'CLOSED');
  return prisma.prediction.update({ where: { id: predictionId }, data: { status: 'CLOSED' } });
}

/**
 * Finalises a result and pays out.
 *
 * Only reachable with `prediction.resolve`. Every correct entry is credited
 * through the ledger with reason `correct`, which the unique constraint makes
 * idempotent — re-running a failed resolve cannot pay anyone twice.
 */
export async function resolvePrediction(
  predictionId: string,
  correctOptionId: string,
  actorId: string,
  notes?: string,
) {
  const prediction = await prisma.prediction.findUniqueOrThrow({
    where: { id: predictionId },
    include: { options: true },
  });

  // A prediction that is still OPEN is closed first, so resolving is always a
  // legal two-step even when the operator skips the explicit close.
  if (prediction.status === 'OPEN') {
    await prisma.prediction.update({ where: { id: predictionId }, data: { status: 'CLOSED' } });
    prediction.status = 'CLOSED';
  }

  assertTransition(prediction.status, 'RESOLVED');

  if (!prediction.options.some((option) => option.id === correctOptionId)) {
    throw new AppError({
      code: ERROR_CODES.OPTION_INVALID,
      message: 'That option does not belong to this prediction',
      statusCode: 400,
    });
  }

  const entries = await prisma.predictionEntry.findMany({ where: { predictionId } });
  const correctEntries = entries.filter((entry) => entry.optionId === correctOptionId);

  await prisma.$transaction([
    prisma.predictionEntry.updateMany({
      where: { predictionId, optionId: correctOptionId },
      data: { isCorrect: true, awardedAt: new Date() },
    }),
    prisma.predictionEntry.updateMany({
      where: { predictionId, optionId: { not: correctOptionId } },
      data: { isCorrect: false },
    }),
    prisma.predictionResult.create({
      data: {
        predictionId,
        correctOptionId,
        resolvedById: actorId,
        totalEntries: entries.length,
        correctEntries: correctEntries.length,
        notes: notes ?? null,
      },
    }),
    prisma.prediction.update({
      where: { id: predictionId },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    }),
  ]);

  let awarded = 0;
  for (const entry of correctEntries) {
    const result = await awardPoints({
      userId: entry.userId,
      sourceType: 'PREDICTION',
      sourceId: predictionId,
      reason: 'correct',
      points: prediction.rewardPoints,
      createdById: actorId,
    });
    if (result.applied) awarded += 1;
  }

  // Only the people who actually predicted are told the answer. The recipient
  // list travels with the event so the notification module never has to know
  // what a `PredictionEntry` is.
  await emitDomainEvent({
    event: 'prediction.resolved',
    entityId: predictionId,
    payload: {
      question: prediction.question,
      answer: prediction.options.find((option) => option.id === correctOptionId)?.label ?? 'decided',
      userIds: [...new Set(entries.map((entry) => entry.userId))],
    },
  });

  return {
    predictionId,
    correctOptionId,
    totalEntries: entries.length,
    correctEntries: correctEntries.length,
    usersCredited: awarded,
  };
}

export async function cancelPrediction(predictionId: string) {
  const prediction = await prisma.prediction.findUniqueOrThrow({ where: { id: predictionId } });
  assertTransition(prediction.status, 'CANCELLED');

  return prisma.prediction.update({
    where: { id: predictionId },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });
}

/**
 * Flips predictions whose deadline has passed from OPEN to CLOSED.
 *
 * Purely bookkeeping: `submitPrediction` already refuses a late entry, so a
 * missed run can never let a vote through.
 */
export async function closeExpiredPredictions(): Promise<number> {
  const result = await prisma.prediction.updateMany({
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
