import { z } from 'zod';

import { TEXT_LIMITS } from '../constants';
import { WEEKEND_PARTICIPATION_TYPES, type WEEKEND_ROUND_STATUSES } from '../enums';
import { idSchema, safeUrlSchema } from './common';

/**
 * Weekend Participation.
 *
 * Two rules constrain everything here:
 *
 *  1. **Eligibility is earned, not bought.** A user qualifies through genuine
 *     participation across the platform — and across *different* features, so
 *     hammering one of them does not open the door.
 *  2. **No reward is promised that production has not authorised.** Physical
 *     appearances, house visits and meetings are off by default. Turning them
 *     on takes a specific permission and a mandatory disclaimer; until then
 *     every surface says the rewards are on-air recognition and points only.
 */

export const weekendSubmissionSchema = z.object({
  participationType: z.enum(WEEKEND_PARTICIPATION_TYPES),
  questionId: idSchema.nullable().optional(),
  contestantId: idSchema.nullable().optional(),
  content: z.string().trim().min(10).max(TEXT_LIMITS.SUBMISSION_MAX),
  /** A link to media the user hosts themselves; nothing is uploaded here. */
  mediaUrl: safeUrlSchema.nullable().optional(),
});
export type WeekendSubmissionInput = z.infer<typeof weekendSubmissionSchema>;

export const weekendQuestionInputSchema = z.object({
  prompt: z.string().trim().min(8).max(TEXT_LIMITS.QUESTION_MAX),
  type: z.enum(WEEKEND_PARTICIPATION_TYPES).default('ASK_CONTESTANT'),
  sortOrder: z.number().int().min(0).max(50).optional(),
  required: z.boolean().optional(),
  maxLength: z.number().int().min(50).max(TEXT_LIMITS.SUBMISSION_MAX).optional(),
});

export const eligibilityConfigSchema = z.object({
  minPoints: z.number().int().min(0).max(1_000_000).default(0),
  minActivities: z.number().int().min(0).max(1000).default(0),
  /** How many *different* features must have been used. Anti-gaming. */
  minDistinctFeatures: z.number().int().min(0).max(8).default(0),
});
export type EligibilityConfigInput = z.infer<typeof eligibilityConfigSchema>;

export const createWeekendRoundSchema = z
  .object({
    title: z.string().trim().min(4).max(160),
    description: z.string().trim().max(1000).nullable().optional(),
    episodeId: idSchema.nullable().optional(),
    participationTypes: z.array(z.enum(WEEKEND_PARTICIPATION_TYPES)).min(1).max(6),
    opensAt: z.string().datetime(),
    submissionDeadline: z.string().datetime(),
    closesAt: z.string().datetime(),
    shortlistSize: z.number().int().min(1).max(100).default(10),
    selectionCount: z.number().int().min(1).max(20).default(3),
    eligibility: eligibilityConfigSchema.optional(),
    questions: z.array(weekendQuestionInputSchema).max(10).optional(),
  })
  .refine((data) => new Date(data.submissionDeadline) > new Date(data.opensAt), {
    message: 'Submissions must close after the round opens',
    path: ['submissionDeadline'],
  })
  .refine((data) => new Date(data.closesAt) >= new Date(data.submissionDeadline), {
    message: 'The round must end no earlier than its submission deadline',
    path: ['closesAt'],
  });
export type CreateWeekendRoundInput = z.infer<typeof createWeekendRoundSchema>;

/**
 * Enabling an in-person opportunity.
 *
 * Deliberately awkward: it needs the `weekend.physical_rewards` permission, a
 * disclaimer, and an explicit acknowledgement. Nothing about this should be
 * possible by accident.
 */
export const configureRewardsSchema = z
  .object({
    allowPhysicalRewards: z.boolean(),
    rewardDisclaimer: z.string().trim().max(1000).nullable().optional(),
    /** Must be true to switch physical rewards on. */
    acknowledgeProductionAuthorisation: z.boolean().optional(),
  })
  .refine(
    (data) =>
      !data.allowPhysicalRewards ||
      (data.acknowledgeProductionAuthorisation === true &&
        typeof data.rewardDisclaimer === 'string' &&
        data.rewardDisclaimer.trim().length >= 20),
    {
      message:
        'Enabling an in-person opportunity requires production authorisation and a disclaimer of at least 20 characters',
      path: ['rewardDisclaimer'],
    },
  );
export type ConfigureRewardsInput = z.infer<typeof configureRewardsSchema>;

export const moderateSubmissionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'ESCALATE']),
  reason: z.string().trim().max(500).optional(),
});

export const shortlistSchema = z.object({
  submissionIds: z.array(idSchema).min(1).max(100),
});

export const selectSubmissionSchema = z.object({
  submissionId: idSchema,
  position: z.number().int().min(1).max(20).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const completeSelectionSchema = z.object({
  submissionId: idSchema,
  notes: z.string().trim().max(500).optional(),
});

export const moderationQueueSchema = z.object({
  status: z.enum(['SUBMITTED', 'IN_MODERATION', 'APPROVED', 'REJECTED', 'SHORTLISTED', 'SELECTED', 'COMPLETED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// --- views -----------------------------------------------------------------

export interface EligibilityRequirement {
  key: 'points' | 'activities' | 'distinctFeatures' | 'verifiedEmail' | 'accountStatus';
  label: string;
  met: boolean;
  current: number | string;
  required: number | string;
}

export interface EligibilityView {
  eligible: boolean;
  requirements: EligibilityRequirement[];
  /** Plain-language reasons the user is not yet eligible. Empty when they are. */
  blockers: string[];
}

export interface WeekendRewardsView {
  /** Always true — every round offers these. */
  onAirRecognition: boolean;
  pointsForSubmitting: number;
  pointsForShortlist: number;
  pointsForSelection: number;
  /** Only ever true when authorised production staff have enabled it. */
  inPersonOpportunity: boolean;
  disclaimer: string;
}

export interface WeekendQuestionView {
  id: string;
  prompt: string;
  type: (typeof WEEKEND_PARTICIPATION_TYPES)[number];
  sortOrder: number;
  required: boolean;
  maxLength: number;
}

export interface MySubmissionView {
  id: string;
  participationType: (typeof WEEKEND_PARTICIPATION_TYPES)[number];
  questionId: string | null;
  contestantId: string | null;
  content: string;
  mediaUrl: string | null;
  status: string;
  /** Only the outcome is exposed to the author, never a moderator's notes. */
  moderationOutcome: 'PENDING' | 'APPROVED' | 'REJECTED';
  shortlisted: boolean;
  selected: boolean;
  selectionPosition: number | null;
  completedAt: string | null;
  createdAt: string;
}

export interface WeekendRoundView {
  id: string;
  title: string;
  description: string | null;
  status: (typeof WEEKEND_ROUND_STATUSES)[number];
  participationTypes: (typeof WEEKEND_PARTICIPATION_TYPES)[number][];
  opensAt: string;
  submissionDeadline: string;
  closesAt: string;
  submissionsOpen: boolean;
  shortlistSize: number;
  selectionCount: number;
  totalSubmissions: number;
  questions: WeekendQuestionView[];
  eligibility: EligibilityView;
  rewards: WeekendRewardsView;
  mySubmissions: MySubmissionView[];
  /** Which types this user may still submit. */
  availableTypes: (typeof WEEKEND_PARTICIPATION_TYPES)[number][];
  /** Published once the round reaches SELECTED. */
  selections:
    | {
        position: number;
        displayName: string;
        participationType: string;
        content: string;
        completedAt: string | null;
      }[]
    | null;
}

export const WEEKEND_DEFAULT_REWARD_DISCLAIMER =
  'Rewards for this round are on-air recognition and platform points only. No physical appearance, house visit or meeting is offered.';

export const WEEKEND_PARTICIPATION_TYPE_LABELS: Record<
  (typeof WEEKEND_PARTICIPATION_TYPES)[number],
  string
> = {
  ASK_CONTESTANT: 'Ask a contestant',
  VIDEO_QUESTION: 'Submit a video question',
  CHALLENGE_WINNER: 'Audience challenge winner',
  MINI_GAME: 'Weekend mini game',
  VIRTUAL_AUDIENCE: 'Virtual audience opportunity',
  SPECIAL_INTERACTION: 'Special show interaction',
};
