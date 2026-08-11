import type {
  KitchenMarket,
  KitchenMarketOption,
  UserKitchenStats,
} from '@reality/shared';
import { KITCHEN_MARKET_POINTS, withShares } from '@reality/shared';

/**
 * The opening slate of markets, one per template.
 *
 * Fictional, like everything else demonstrated ahead of the server module.
 * Times are expressed as offsets from load rather than fixed dates, so a market
 * is never already closed by the time somebody opens the page.
 */

const HOUR = 3_600_000;

function option(id: string, label: string, predictions: number, contestantId?: string): KitchenMarketOption {
  return { id, label, contestantId: contestantId ?? null, predictions, share: 0 };
}

function market(
  input: Omit<KitchenMarket, 'options' | 'totalPredictions' | 'startTime' | 'endTime' | 'createdAt'> & {
    options: KitchenMarketOption[];
    opensInHours: number;
    closesInHours: number;
  },
): KitchenMarket {
  const { opensInHours, closesInHours, options, ...rest } = input;
  const now = Date.now();

  return {
    ...rest,
    options: withShares(options),
    totalPredictions: options.reduce((sum, entry) => sum + entry.predictions, 0),
    startTime: new Date(now + opensInHours * HOUR).toISOString(),
    endTime: new Date(now + closesInHours * HOUR).toISOString(),
    createdAt: new Date(now - 2 * HOUR).toISOString(),
  };
}

/** Rebuilt on each call so the clocks are always relative to now. */
export function seedMarkets(): KitchenMarket[] {
  return [
    // Type 1 — dish challenge.
    market({
      id: 'km_dish_pasta',
      creator: { id: 'u_nightowl', displayName: 'NightOwl' },
      category: 'COOKING',
      question: 'Who will cook pasta tonight?',
      participants: ['con_03', 'con_01', 'con_02', 'con_05'],
      slot: 'EVENING',
      status: 'OPEN',
      pointsReward: KITCHEN_MARKET_POINTS.CORRECT_PREDICTION,
      myOptionId: null,
      winningOptionId: null,
      opensInHours: -1,
      closesInHours: 2.6,
      options: [
        option('kmo_pasta_mira', 'Mira Sol', 1_840, 'con_03'),
        option('kmo_pasta_aria', 'Aria Vale', 1_355, 'con_01'),
        option('kmo_pasta_dev', 'Dev Rahman', 790, 'con_02'),
        option('kmo_pasta_lena', 'Lena Frost', 395, 'con_05'),
      ],
    }),

    // Type 2 — contestant versus contestant.
    market({
      id: 'km_battle_mira_aria',
      creator: { id: 'u_couchcritic', displayName: 'CouchCritic' },
      category: 'CONTESTANT_BATTLE',
      question: 'Who will win the cooking battle?',
      participants: ['con_03', 'con_01'],
      slot: 'AFTERNOON',
      status: 'OPEN',
      pointsReward: KITCHEN_MARKET_POINTS.CORRECT_PREDICTION,
      myOptionId: null,
      winningOptionId: null,
      opensInHours: -2,
      closesInHours: 0.8,
      options: [
        option('kmo_battle_mira', 'Mira wins', 2_610, 'con_03'),
        option('kmo_battle_aria', 'Aria wins', 2_190, 'con_01'),
      ],
    }),

    // Type 3 — whole-house decision.
    market({
      id: 'km_breakfast',
      creator: { id: 'u_popcornpro', displayName: 'PopcornPro' },
      category: 'FOOD_CHOICE',
      question: 'What will the house eat tomorrow morning?',
      participants: [],
      slot: 'MORNING',
      status: 'OPEN',
      pointsReward: KITCHEN_MARKET_POINTS.CORRECT_PREDICTION,
      myOptionId: null,
      winningOptionId: null,
      opensInHours: -3,
      closesInHours: 9,
      options: [
        option('kmo_bf_pancakes', 'Pancakes', 980),
        option('kmo_bf_eggs', 'Eggs', 1_420),
        option('kmo_bf_rice', 'Rice', 610),
        option('kmo_bf_fruit', 'Fruits', 340),
      ],
    }),

    // Type 4 — cooking responsibility.
    market({
      id: 'km_dinner_duty',
      creator: { id: 'u_remoteruler', displayName: 'RemoteRuler' },
      category: 'HOUSE_DECISION',
      question: 'Who will prepare dinner?',
      participants: ['con_01', 'con_02', 'con_03', 'con_05'],
      slot: 'EVENING',
      status: 'OPEN',
      pointsReward: KITCHEN_MARKET_POINTS.CORRECT_PREDICTION,
      myOptionId: null,
      winningOptionId: null,
      opensInHours: -0.5,
      closesInHours: 4,
      options: [
        option('kmo_duty_aria', 'Aria Vale', 1_120, 'con_01'),
        option('kmo_duty_dev', 'Dev Rahman', 940, 'con_02'),
        option('kmo_duty_mira', 'Mira Sol', 705, 'con_03'),
        option('kmo_duty_lena', 'Lena Frost', 505, 'con_05'),
      ],
    }),

    // Type 5 — drama.
    market({
      id: 'km_argument',
      creator: { id: 'u_primetimesam', displayName: 'PrimeTimeSam' },
      category: 'DRAMA',
      question: 'Will the kitchen argument happen tonight?',
      participants: [],
      slot: 'NIGHT',
      status: 'OPEN',
      pointsReward: KITCHEN_MARKET_POINTS.CORRECT_PREDICTION,
      myOptionId: null,
      winningOptionId: null,
      opensInHours: -1.5,
      closesInHours: 5.5,
      options: [
        option('kmo_arg_yes', 'Yes', 3_910),
        option('kmo_arg_no', 'No', 1_240),
      ],
    }),

    // One already settled, so the resolved state is visible without waiting.
    market({
      id: 'km_lunch_resolved',
      creator: { id: 'u_nightowl', displayName: 'NightOwl' },
      category: 'COOKING',
      question: 'Who burned lunch this afternoon?',
      participants: ['con_02', 'con_05'],
      slot: 'AFTERNOON',
      status: 'RESOLVED',
      pointsReward: KITCHEN_MARKET_POINTS.CORRECT_PREDICTION,
      myOptionId: null,
      winningOptionId: 'kmo_burn_dev',
      opensInHours: -6,
      closesInHours: -1,
      options: [
        option('kmo_burn_dev', 'Dev Rahman', 2_240, 'con_02'),
        option('kmo_burn_lena', 'Lena Frost', 1_060, 'con_05'),
      ],
    }),
  ];
}

/** Today's standings, for the champions board. */
export function seedStats(): UserKitchenStats[] {
  return [
    {
      userId: 'u_nightowl',
      displayName: 'NightOwl',
      marketsCreated: 4,
      predictionsMade: 18,
      correctPredictions: 12,
      pointsEarned: 850,
      rank: 1,
    },
    {
      userId: 'u_couchcritic',
      displayName: 'CouchCritic',
      marketsCreated: 2,
      predictionsMade: 15,
      correctPredictions: 9,
      pointsEarned: 620,
      rank: 2,
    },
    {
      userId: 'u_popcornpro',
      displayName: 'PopcornPro',
      marketsCreated: 3,
      predictionsMade: 11,
      correctPredictions: 7,
      pointsEarned: 410,
      rank: 3,
    },
    {
      userId: 'u_remoteruler',
      displayName: 'RemoteRuler',
      marketsCreated: 1,
      predictionsMade: 9,
      correctPredictions: 5,
      pointsEarned: 300,
      rank: 4,
    },
    {
      userId: 'u_primetimesam',
      displayName: 'PrimeTimeSam',
      marketsCreated: 2,
      predictionsMade: 7,
      correctPredictions: 4,
      pointsEarned: 245,
      rank: 5,
    },
  ];
}

/** The market's own top predictors, shown on a detail page. */
export const topPredictors: { displayName: string; points: number }[] = [
  { displayName: 'NightOwl', points: 250 },
  { displayName: 'CouchCritic', points: 180 },
  { displayName: 'PopcornPro', points: 120 },
];
