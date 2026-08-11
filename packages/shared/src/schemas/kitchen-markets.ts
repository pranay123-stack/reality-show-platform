import { z } from 'zod';

import { idSchema } from './common';

/**
 * Kitchen Markets — community-created prediction markets about the kitchen.
 *
 * Distinct from `kitchen.ts`, which is production's budgeted food decision:
 * that one spends a real budget and is resolved by an operator. This is the
 * audience predicting *what the house will do* — who cooks, who wins, whether
 * the argument happens — and the two must not be confused, which is why they
 * are separate models rather than a flag on one.
 *
 * ### On where the authority lives
 *
 * These shapes are written to be the API contract, not just frontend props.
 * When the server module lands, `createMarketSchema` is what its route parses
 * and `KitchenMarket` is what it returns — so the client is already speaking
 * the right language.
 *
 * Two fields are deliberately absent from anything a client sends:
 * `pointsAwarded` and `winningOptionId`. A prediction market where the browser
 * can name the winner is not a prediction market. The client submits an intent
 * — "I pick option B" — and nothing else.
 */

export const KITCHEN_MARKET_CATEGORIES = [
  'COOKING',
  'CONTESTANT_BATTLE',
  'FOOD_CHOICE',
  'HOUSE_DECISION',
  'DRAMA',
] as const;
export type KitchenMarketCategory = (typeof KITCHEN_MARKET_CATEGORIES)[number];

export const KITCHEN_MARKET_SLOTS = ['MORNING', 'AFTERNOON', 'EVENING', 'NIGHT'] as const;
export type KitchenMarketSlot = (typeof KITCHEN_MARKET_SLOTS)[number];

export const KITCHEN_MARKET_STATUSES = ['OPEN', 'LOCKED', 'RESOLVED', 'VOID'] as const;
export type KitchenMarketStatus = (typeof KITCHEN_MARKET_STATUSES)[number];

/** What the audience is choosing between. */
export interface KitchenMarketOption {
  id: string;
  label: string;
  /** Set when the option *is* a contestant, so the card can show their face. */
  contestantId?: string | null;
  /** Server-counted. Never sent by a client. */
  predictions: number;
  /** Share of the market, 0–100, rounded to one place. Derived, never stored. */
  share: number;
}

export interface KitchenMarketCreator {
  id: string;
  displayName: string;
}

export interface KitchenMarket {
  id: string;
  creator: KitchenMarketCreator;
  category: KitchenMarketCategory;
  question: string;
  options: KitchenMarketOption[];
  /** Contestant ids the market is about, when it is about specific people. */
  participants: string[];
  slot: KitchenMarketSlot;
  startTime: string;
  endTime: string;
  status: KitchenMarketStatus;
  /** Distinct people who have predicted. */
  totalPredictions: number;
  /** The caller's own pick, if they have made one. */
  myOptionId?: string | null;
  /** Set only once an operator resolves the market. */
  winningOptionId?: string | null;
  /** What a correct prediction is worth here. */
  pointsReward: number;
  createdAt: string;
}

/** A single person's standing in the markets. */
export interface UserKitchenStats {
  userId: string;
  displayName: string;
  marketsCreated: number;
  predictionsMade: number;
  correctPredictions: number;
  pointsEarned: number;
  rank: number;
}

/**
 * The scoring rules, in one place.
 *
 * Here rather than in a component because the server will need exactly these
 * numbers, and two copies of a points table is how a platform ends up paying
 * out differently depending on which one you ask.
 */
export const KITCHEN_MARKET_POINTS = {
  /** Publishing a market. */
  CREATE_MARKET: 20,
  /** Making any prediction. */
  PARTICIPATE: 5,
  /** Predicting the outcome correctly. */
  CORRECT_PREDICTION: 100,
  /** Predicting correctly while the market was still young. */
  EARLY_BONUS: 50,
  /** A market you created that drew a crowd. */
  CREATOR_BONUS: 25,
  /** Predictions needed before the creator bonus pays. */
  CREATOR_BONUS_THRESHOLD: 25,
  /**
   * The early window, as a share of the market's life. A prediction made in
   * the first third counts as early — long enough to be reachable, short
   * enough that it rewards conviction rather than refreshing.
   */
  EARLY_WINDOW: 1 / 3,
} as const;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const kitchenMarketOptionInputSchema = z.object({
  label: z.string().trim().min(1).max(60),
  contestantId: idSchema.nullable().optional(),
});

export const createKitchenMarketSchema = z.object({
  category: z.enum(KITCHEN_MARKET_CATEGORIES),
  question: z.string().trim().min(10).max(140),
  slot: z.enum(KITCHEN_MARKET_SLOTS),
  /**
   * Two is a head-to-head, six is a menu. More than that and a market stops
   * being a prediction and starts being a wish.
   */
  options: z.array(kitchenMarketOptionInputSchema).min(2).max(6),
});
export type CreateKitchenMarketInput = z.infer<typeof createKitchenMarketSchema>;

export const predictKitchenMarketSchema = z.object({
  optionId: idSchema,
});
export type PredictKitchenMarketInput = z.infer<typeof predictKitchenMarketSchema>;

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export const KITCHEN_CATEGORY_LABELS: Record<KitchenMarketCategory, string> = {
  COOKING: 'Cooking',
  CONTESTANT_BATTLE: 'Contestant battle',
  FOOD_CHOICE: 'Food choice',
  HOUSE_DECISION: 'House decision',
  DRAMA: 'Drama',
};

export const KITCHEN_SLOT_LABELS: Record<KitchenMarketSlot, string> = {
  MORNING: 'Morning',
  AFTERNOON: 'Afternoon',
  EVENING: 'Evening',
  NIGHT: 'Night',
};

/**
 * Recomputes every option's share from its count.
 *
 * A derived value, never a stored one: a stored percentage is a number that can
 * disagree with the counts it came from, and the first time it does nobody
 * knows which to believe.
 */
export function withShares(options: KitchenMarketOption[]): KitchenMarketOption[] {
  const total = options.reduce((sum, option) => sum + option.predictions, 0);
  if (total === 0) return options.map((option) => ({ ...option, share: 0 }));

  return options.map((option) => ({
    ...option,
    share: Math.round((option.predictions / total) * 1000) / 10,
  }));
}
