import { z } from 'zod';

import { REWARD_TYPES } from '../enums';
import { idSchema } from './common';

/**
 * Reward economy.
 *
 * Three rules shape every contract here:
 *
 *  1. **The ledger is the source of truth.** A redemption records *that* points
 *     were spent; the `PointsLedger` row records the spend itself. Nothing here
 *     ever writes a balance.
 *  2. **Category governs policy.** DIGITAL rewards can be published freely;
 *     EXPERIENCE and PHYSICAL need production sign-off, exactly as an in-person
 *     weekend opportunity does.
 *  3. **A client never sends a price.** `pointCost` is producer-set and read
 *     from the database on every redemption.
 */

export const REWARD_CATEGORIES = ['DIGITAL', 'EXPERIENCE', 'PHYSICAL'] as const;
export type RewardCategory = (typeof REWARD_CATEGORIES)[number];

export const REWARD_STATUSES = ['DRAFT', 'AVAILABLE', 'PAUSED', 'RETIRED'] as const;
export type RewardStatus = (typeof REWARD_STATUSES)[number];

export const REDEMPTION_STATES = [
  'REQUESTED',
  'RESERVED',
  'APPROVED',
  'FULFILLED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type RedemptionState = (typeof REDEMPTION_STATES)[number];

/** Categories that cannot be published without production authorisation. */
export const AUTHORISED_CATEGORIES: RewardCategory[] = ['EXPERIENCE', 'PHYSICAL'];

export const rewardRuleSchema = z.object({
  minLevel: z.number().int().min(0).max(100).default(0),
  minLifetimePoints: z.number().int().min(0).max(10_000_000).default(0),
  minActivities: z.number().int().min(0).max(10_000).default(0),
  minDistinctFeatures: z.number().int().min(0).max(8).default(0),
  minAccountAgeDays: z.number().int().min(0).max(3650).default(0),
  requiredFeatures: z
    .array(z.enum(['PREDICTION', 'POLL', 'CHALLENGE', 'PERSPECTIVE', 'NOMINATION', 'EVICTION', 'KITCHEN', 'WEEKEND']))
    .max(8)
    .default([]),
  description: z.string().trim().max(300).optional(),
});
export type RewardRuleInput = z.infer<typeof rewardRuleSchema>;

export const createRewardSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(60)
    .regex(/^[A-Z0-9_]+$/, 'Use upper-case letters, numbers and underscores'),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  category: z.enum(REWARD_CATEGORIES),
  type: z.enum(REWARD_TYPES),
  pointCost: z.number().int().min(0).max(10_000_000),
  oncePerUser: z.boolean().default(true),
  requiresApproval: z.boolean().default(false),
  availableFrom: z.string().datetime().nullable().optional(),
  availableUntil: z.string().datetime().nullable().optional(),
  /** Null total means unlimited — a digital badge has no scarcity. */
  totalUnits: z.number().int().min(0).max(1_000_000).nullable().optional(),
  rule: rewardRuleSchema.optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});
export type CreateRewardInput = z.infer<typeof createRewardSchema>;

export const updateRewardSchema = createRewardSchema.partial().omit({ code: true });

export const addInventorySchema = z.object({
  /** Units to add. Negative values are not accepted; retire the reward instead. */
  units: z.number().int().min(1).max(1_000_000),
  note: z.string().trim().max(300).optional(),
});

export const setRewardStatusSchema = z.object({
  status: z.enum(REWARD_STATUSES),
});

/**
 * Authorising an EXPERIENCE or PHYSICAL reward.
 *
 * Deliberately awkward, and deliberately identical in shape to the weekend
 * in-person gate: a specific permission, an explicit acknowledgement and a
 * disclaimer. Nothing here should be possible by accident.
 */
export const authoriseRewardSchema = z
  .object({
    authorised: z.boolean(),
    disclaimer: z.string().trim().max(1000).nullable().optional(),
    acknowledgeProductionAuthorisation: z.boolean().optional(),
  })
  .refine(
    (data) =>
      !data.authorised ||
      (data.acknowledgeProductionAuthorisation === true &&
        typeof data.disclaimer === 'string' &&
        data.disclaimer.trim().length >= 20),
    {
      message:
        'Authorising a physical or experience reward requires production authorisation and a disclaimer of at least 20 characters',
      path: ['disclaimer'],
    },
  );
export type AuthoriseRewardInput = z.infer<typeof authoriseRewardSchema>;

export const redeemRewardSchema = z.object({
  /** Optional idempotency key so a double-tap cannot redeem twice. */
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const decideRedemptionSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export const rejectRedemptionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const listRewardsQuerySchema = z.object({
  category: z.enum(REWARD_CATEGORIES).optional(),
  affordable: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const listRedemptionsQuerySchema = z.object({
  status: z.enum(REDEMPTION_STATES).optional(),
  rewardId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// --- views -----------------------------------------------------------------

export interface RewardRequirementView {
  key: string;
  label: string;
  met: boolean;
  current: number | string;
  required: number | string;
}

export interface RewardEligibilityView {
  eligible: boolean;
  /** Separate from eligibility: you can qualify and still not afford it. */
  affordable: boolean;
  inStock: boolean;
  alreadyHeld: boolean;
  requirements: RewardRequirementView[];
  blockers: string[];
}

export interface RewardInventoryView {
  /** Null means unlimited. */
  totalUnits: number | null;
  remaining: number | null;
  reserved: number;
  fulfilled: number;
  unlimited: boolean;
}

export interface RewardView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: RewardCategory;
  type: (typeof REWARD_TYPES)[number];
  pointCost: number;
  status: RewardStatus;
  oncePerUser: boolean;
  requiresApproval: boolean;
  /** True for a category that needs production sign-off. */
  requiresProductionApproval: boolean;
  authorised: boolean;
  disclaimer: string | null;
  availableFrom: string | null;
  availableUntil: string | null;
  /** Computed: published, in its window, and authorised if it needs to be. */
  available: boolean;
  inventory: RewardInventoryView;
  eligibility: RewardEligibilityView | null;
  rule: (RewardRuleInput & { description?: string }) | null;
}

export interface RedemptionView {
  id: string;
  status: RedemptionState;
  pointsSpent: number;
  createdAt: string;
  reservedAt: string | null;
  approvedAt: string | null;
  fulfilledAt: string | null;
  closedAt: string | null;
  notes: string | null;
  /** Present once a cancellation has refunded the points. */
  refunded: boolean;
  reward: {
    id: string;
    code: string;
    name: string;
    category: RewardCategory;
    type: (typeof REWARD_TYPES)[number];
    pointCost: number;
    disclaimer: string | null;
  };
  history: { toStatus: RedemptionState; note: string | null; at: string }[];
}

export interface UserLevelView {
  level: number;
  lifetimePoints: number;
  pointsIntoLevel: number;
  pointsForNextLevel: number | null;
}

export const REWARD_PHYSICAL_DISCLAIMER =
  'Physical and experience rewards are arranged by the production team. Nothing is confirmed until production approves and fulfils your redemption.';
