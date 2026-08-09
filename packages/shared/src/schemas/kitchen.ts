import { z } from 'zod';

import type { KITCHEN_DECISION_STATUSES } from '../enums';
import { idSchema } from './common';

/**
 * Kitchen Control.
 *
 * The audience influences what the house is given; it never controls the money.
 * Two rules shape every contract below:
 *
 *  1. **No client ever sends a cost.** `unitCost` is set by production and read
 *     only from the database. A vote carries option ids and nothing else.
 *  2. **Audience decision ≠ official execution.** `audienceResult` is what
 *     people voted for; `implementedResult` is what production actually did.
 *     They are separate fields, written by separate endpoints.
 */

export const KITCHEN_OPTION_KINDS = ['MENU', 'QUANTITY', 'INGREDIENT', 'SPECIAL'] as const;
export type KitchenOptionKind = (typeof KITCHEN_OPTION_KINDS)[number];

export const kitchenVoteSchema = z.object({
  /** Option ids only. Costs and quantities are never accepted from a client. */
  optionIds: z.array(idSchema).min(1).max(10),
});
export type KitchenVoteInput = z.infer<typeof kitchenVoteSchema>;

export const kitchenOptionInputSchema = z.object({
  label: z.string().trim().min(1).max(120),
  kind: z.enum(KITCHEN_OPTION_KINDS).default('MENU'),
  /** Budget units. Producer-set; the audience never sees a way to change it. */
  unitCost: z.number().int().min(0).max(10_000_000),
  quantity: z.number().int().min(0).max(100_000).nullable().optional(),
  unit: z.string().trim().max(24).nullable().optional(),
  sortOrder: z.number().int().min(0).max(50).optional(),
});

export const createKitchenDecisionSchema = z
  .object({
    budgetId: idSchema,
    episodeId: idSchema.nullable().optional(),
    title: z.string().trim().min(4).max(160),
    question: z.string().trim().min(4).max(240),
    opensAt: z.string().datetime(),
    closesAt: z.string().datetime(),
    /** How many options one *user* may pick. */
    maxSelections: z.number().int().min(1).max(10).default(1),
    /** How many options the resolved decision actually buys. */
    winnerCount: z.number().int().min(1).max(10).default(1),
    /** Hard ceiling on total quantity the resolved decision may buy. */
    maxQuantity: z.number().int().min(1).max(100_000).nullable().optional(),
    participationPoints: z.number().int().min(0).max(1000).optional(),
    bonusPoints: z.number().int().min(0).max(5000).optional(),
    weighting: z.record(z.number().positive()).nullable().optional(),
    options: z.array(kitchenOptionInputSchema).min(2).max(12),
  })
  .refine((data) => new Date(data.closesAt) > new Date(data.opensAt), {
    message: 'The decision must close after it opens',
    path: ['closesAt'],
  });
export type CreateKitchenDecisionInput = z.infer<typeof createKitchenDecisionSchema>;

export const createKitchenBudgetSchema = z
  .object({
    label: z.string().trim().min(2).max(120),
    totalUnits: z.number().int().min(1).max(100_000_000),
    currencySymbol: z.string().trim().min(1).max(4).optional(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
  })
  .refine((data) => new Date(data.periodEnd) > new Date(data.periodStart), {
    message: 'The budget period must end after it starts',
    path: ['periodEnd'],
  });

export const implementKitchenResultSchema = z.object({
  /** What production actually gave the house. Need not match the audience. */
  optionIds: z.array(idSchema).min(1).max(10),
  note: z.string().trim().max(500).optional(),
});
export type ImplementKitchenResultInput = z.infer<typeof implementKitchenResultSchema>;

export const listKitchenQuerySchema = z.object({
  scope: z.enum(['open', 'finalized', 'all']).default('open'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// --- views -----------------------------------------------------------------

export interface KitchenOptionView {
  id: string;
  label: string;
  kind: KitchenOptionKind;
  quantity: number | null;
  unit: string | null;
  sortOrder: number;
  /** Cost is public — the audience should see what their choice costs. */
  unitCost: number;
  /** Zero while voting is open; the split is only revealed once finalised. */
  voteCount: number;
  percentage: number;
  selectedByMe: boolean;
  /** False when picking this would breach the remaining budget. */
  affordable: boolean;
}

export interface KitchenBudgetView {
  id: string;
  label: string;
  currencySymbol: string;
  totalUnits: number;
  spentUnits: number;
  remainingUnits: number;
  /** Spent as a percentage of total, one decimal place. */
  usedPercentage: number;
  periodStart: string;
  periodEnd: string;
}

export interface KitchenResultLine {
  optionId: string;
  label: string;
  quantity: number | null;
  unit: string | null;
  unitCost: number;
  voteCount: number;
  percentage: number;
}

export interface KitchenAudienceResult {
  kind: 'AUDIENCE_RESULT';
  disclaimer: string;
  selected: KitchenResultLine[];
  /** Options the audience ranked highly that did not fit the budget or caps. */
  skipped: (KitchenResultLine & { reason: 'BUDGET' | 'QUANTITY' | 'WINNER_LIMIT' })[];
  totalCost: number;
  budgetRemainingAfter: number;
  totalVotes: number;
  computedAt: string;
}

export interface KitchenImplementedResult {
  kind: 'IMPLEMENTED_RESULT';
  source: 'production';
  selected: KitchenResultLine[];
  totalCost: number;
  note: string | null;
  implementedAt: string;
  /** True when production gave the house exactly what the audience picked. */
  matchesAudience: boolean;
}

export interface KitchenDecisionView {
  id: string;
  title: string;
  question: string;
  status: (typeof KITCHEN_DECISION_STATUSES)[number];
  opensAt: string;
  closesAt: string;
  isOpen: boolean;
  maxSelections: number;
  winnerCount: number;
  maxQuantity: number | null;
  totalVotes: number;
  participationPoints: number;
  bonusPoints: number;
  selectionsUsed: number;
  selectionsRemaining: number;
  hasParticipated: boolean;
  options: KitchenOptionView[];
  budget: KitchenBudgetView;
  audienceResult: KitchenAudienceResult | null;
  implementedResult: KitchenImplementedResult | null;
  /** Always present, so no client can render a result without the caveat. */
  disclaimer: string;
}

export const KITCHEN_RESULT_DISCLAIMER =
  'This is what the audience voted for. What the house actually receives is decided and recorded by the production team.';
