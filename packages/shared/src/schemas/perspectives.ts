import { z } from 'zod';

import { TEXT_LIMITS } from '../constants';
import type { PERSPECTIVE_STATUSES } from '../enums';
import { idSchema } from './common';

/**
 * Audience Perspective is **opinion about an event that already happened**
 * ("who was right?"), and is deliberately a separate feature from Live Polls,
 * which are real-time decisions taken *during* the broadcast.
 *
 * The practical differences that follow from that:
 *   - a perspective is always anchored to an `Event`; a poll never is
 *   - a perspective runs for hours or days; a poll runs for seconds or minutes
 *   - perspective results are visible while voting is open — there is no
 *     outcome to influence, so hiding the split would serve no purpose
 *   - no realtime channel: perspectives are polled over HTTP, not pushed
 */

export const submitPerspectiveVoteSchema = z.object({
  optionId: idSchema,
});
export type SubmitPerspectiveVoteInput = z.infer<typeof submitPerspectiveVoteSchema>;

export const perspectiveOptionInputSchema = z.object({
  label: z.string().trim().min(1).max(160),
  contestantId: idSchema.nullable().optional(),
  sortOrder: z.number().int().min(0).max(50).optional(),
});

export const createPerspectiveSchema = z.object({
  eventId: idSchema,
  episodeId: idSchema.nullable().optional(),
  question: z.string().trim().min(8).max(TEXT_LIMITS.QUESTION_MAX),
  description: z.string().trim().max(500).nullable().optional(),
  opensAt: z.string().datetime().nullable().optional(),
  closesAt: z.string().datetime(),
  options: z.array(perspectiveOptionInputSchema).min(2).max(8),
});
export type CreatePerspectiveInput = z.infer<typeof createPerspectiveSchema>;

export const listPerspectivesQuerySchema = z.object({
  scope: z.enum(['open', 'closed', 'mine', 'all']).default('open'),
  eventId: idSchema.optional(),
  contestantId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export interface PerspectiveOptionView {
  id: string;
  label: string;
  contestantId: string | null;
  contestantName: string | null;
  sortOrder: number;
  voteCount: number;
  /** Share of the vote, one decimal place. */
  percentage: number;
}

export interface PerspectiveView {
  id: string;
  question: string;
  description: string | null;
  status: (typeof PERSPECTIVE_STATUSES)[number];
  opensAt: string | null;
  closesAt: string;
  totalVotes: number;
  options: PerspectiveOptionView[];
  event: {
    id: string;
    type: string;
    title: string;
    description: string | null;
    occurredAt: string;
    contestants: { id: string; displayName: string; avatarUrl: string | null }[];
  };
  myOptionId: string | null;
  isClosed: boolean;
  /** The option currently ahead. Null while nobody has voted or on a dead heat. */
  leadingOptionId: string | null;
}

export interface PerspectiveAnalytics {
  totalPerspectives: number;
  totalVotes: number;
  averageVotesPerPerspective: number;
  /** How often the audience split closely versus decisively. */
  consensus: { decisive: number; split: number; contested: number };
  byContestant: {
    contestantId: string;
    displayName: string;
    votesFor: number;
    appearances: number;
    /** Share of votes this contestant attracted across every perspective. */
    supportRate: number;
  }[];
  recent: { id: string; question: string; closesAt: string; totalVotes: number; margin: number }[];
}
