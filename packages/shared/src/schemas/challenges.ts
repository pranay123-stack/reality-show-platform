import { z } from 'zod';

import { TEXT_LIMITS } from '../constants';
import { CHALLENGE_CATEGORIES, CHALLENGE_STATUSES, CHALLENGE_TARGET_TYPES } from '../enums';
import { idSchema } from './common';

export const createChallengeSchema = z
  .object({
    title: z.string().trim().min(8).max(TEXT_LIMITS.CHALLENGE_TITLE_MAX),
    description: z.string().trim().min(20).max(TEXT_LIMITS.CHALLENGE_DESCRIPTION_MAX),
    category: z.enum(CHALLENGE_CATEGORIES),
    targetType: z.enum(CHALLENGE_TARGET_TYPES).default('HOUSE'),
    targetContestantId: idSchema.nullable().optional(),
    /** false saves a draft; true sends it straight to moderation. */
    submit: z.boolean().default(true),
  })
  .refine(
    (data) => data.targetType !== 'CONTESTANT' || Boolean(data.targetContestantId),
    { message: 'Pick the contestant this challenge is for', path: ['targetContestantId'] },
  );
export type CreateChallengeInput = z.infer<typeof createChallengeSchema>;

export const updateChallengeSchema = z.object({
  title: z.string().trim().min(8).max(TEXT_LIMITS.CHALLENGE_TITLE_MAX).optional(),
  description: z.string().trim().min(20).max(TEXT_LIMITS.CHALLENGE_DESCRIPTION_MAX).optional(),
  category: z.enum(CHALLENGE_CATEGORIES).optional(),
  targetType: z.enum(CHALLENGE_TARGET_TYPES).optional(),
  targetContestantId: idSchema.nullable().optional(),
});

export const reportChallengeSchema = z.object({
  reason: z.enum(['SPAM', 'OFFENSIVE', 'UNSAFE', 'OFF_TOPIC', 'DUPLICATE', 'OTHER']),
  details: z.string().trim().max(500).optional(),
});
export type ReportChallengeInput = z.infer<typeof reportChallengeSchema>;

export const moderateChallengeSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'ESCALATE']),
  reason: z.string().trim().max(500).optional(),
});

export const challengeFeedQuerySchema = z.object({
  scope: z.enum(['voting', 'top', 'selected', 'mine', 'all']).default('voting'),
  category: z.enum(CHALLENGE_CATEGORIES).optional(),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const moderationQueueQuerySchema = z.object({
  status: z.enum(CHALLENGE_STATUSES).optional(),
  reportedOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const executeChallengeSchema = z.object({
  resultNotes: z.string().trim().max(1000).optional(),
});

export interface ChallengeView {
  id: string;
  title: string;
  description: string;
  category: (typeof CHALLENGE_CATEGORIES)[number];
  targetType: (typeof CHALLENGE_TARGET_TYPES)[number];
  targetContestant: { id: string; displayName: string; avatarUrl: string | null } | null;
  status: (typeof CHALLENGE_STATUSES)[number];
  author: { id: string; displayName: string; avatarUrl: string | null };
  voteCount: number;
  rank: number | null;
  createdAt: string;
  executedAt: string | null;
  resultNotes: string | null;
  /** Relative to the signed-in caller. */
  hasVoted: boolean;
  isOwn: boolean;
  canVote: boolean;
  /** Why voting is unavailable, when it is. */
  voteBlockedReason: string | null;
}

/** Moderator-only view: adds the fields an ordinary user must not see. */
export interface ChallengeModerationView extends ChallengeView {
  moderationStatus: string;
  moderationNotes: string | null;
  reportCount: number;
  authorEmail: string;
  contentFlags: string[];
}
