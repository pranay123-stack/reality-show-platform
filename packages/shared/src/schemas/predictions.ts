import { z } from 'zod';

import { TEXT_LIMITS } from '../constants';
import { PREDICTION_STATUSES } from '../enums';
import { idSchema, idempotencyKeySchema } from './common';

export const submitPredictionSchema = z.object({
  optionId: idSchema,
  idempotencyKey: idempotencyKeySchema.optional(),
});
export type SubmitPredictionInput = z.infer<typeof submitPredictionSchema>;

export const predictionOptionInputSchema = z.object({
  label: z.string().trim().min(1).max(120),
  contestantId: idSchema.optional().nullable(),
  sortOrder: z.number().int().min(0).max(50).optional(),
});

export const createPredictionSchema = z.object({
  question: z.string().trim().min(8).max(TEXT_LIMITS.QUESTION_MAX),
  description: z.string().trim().max(500).optional().nullable(),
  episodeId: idSchema.optional().nullable(),
  eventId: idSchema.optional().nullable(),
  opensAt: z.string().datetime().optional().nullable(),
  closesAt: z.string().datetime(),
  participationPoints: z.number().int().min(0).max(1000).optional(),
  rewardPoints: z.number().int().min(0).max(10_000).optional(),
  options: z.array(predictionOptionInputSchema).min(2).max(12),
});
export type CreatePredictionInput = z.infer<typeof createPredictionSchema>;

/** Only editable while the question is still a DRAFT. */
export const updatePredictionSchema = createPredictionSchema.partial().omit({ options: true }).extend({
  options: z.array(predictionOptionInputSchema).min(2).max(12).optional(),
});

export const resolvePredictionSchema = z.object({
  correctOptionId: idSchema,
  notes: z.string().trim().max(500).optional(),
});

export const listPredictionsQuerySchema = z.object({
  status: z.enum(PREDICTION_STATUSES).optional(),
  scope: z.enum(['open', 'resolved', 'mine', 'all']).default('open'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export interface PredictionOptionView {
  id: string;
  label: string;
  contestantId: string | null;
  contestantName: string | null;
  sortOrder: number;
  entryCount: number;
}

export interface PredictionView {
  id: string;
  question: string;
  description: string | null;
  status: (typeof PREDICTION_STATUSES)[number];
  opensAt: string | null;
  closesAt: string;
  resolvedAt: string | null;
  participationPoints: number;
  rewardPoints: number;
  entryCount: number;
  options: PredictionOptionView[];
  /** The signed-in user's entry, if any. Null for anonymous callers. */
  myOptionId: string | null;
  myEntryCorrect: boolean | null;
  correctOptionId: string | null;
  /** True when the deadline has passed, regardless of the stored status. */
  isClosed: boolean;
}
