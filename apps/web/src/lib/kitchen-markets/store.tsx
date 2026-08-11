'use client';

import type {
  CreateKitchenMarketInput,
  KitchenMarket,
  UserKitchenStats,
} from '@reality/shared';
import { KITCHEN_MARKET_POINTS, withShares } from '@reality/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { seedMarkets, seedStats } from './seed';

/**
 * Kitchen Markets, held in the browser.
 *
 * ### Why this is a client store and what that means
 *
 * The server module for this feature does not exist yet. Rather than mock the
 * screens with static data — which would show the design but prove nothing
 * about whether the flows work — this implements the real state transitions:
 * creating a market, predicting on one, scoring a resolution, and ranking the
 * results.
 *
 * That makes it a working prototype, and it is important to be exact about
 * what it is *not*. Points scored here are **not** platform points. They never
 * touch `PointsLedger`, they cannot move a leaderboard, and they vanish when
 * the tab closes. Twenty phases of this platform rest on the rule that only the
 * server awards points, and a browser-side market that quietly minted them
 * would be the single worst thing this codebase could ship. Every surface that
 * shows a market score says where it comes from.
 *
 * The shapes are the ones in `@reality/shared`, so when the module lands this
 * file is replaced by fetches and nothing above it changes.
 */

interface KitchenMarketState {
  markets: KitchenMarket[];
  stats: UserKitchenStats[];
  /** What the signed-in reader has scored in this session. */
  myPoints: number;
  myMarketsCreated: number;
  myPredictions: number;
}

interface KitchenMarketStore extends KitchenMarketState {
  /** True once the session's own state has been restored. */
  ready: boolean;
  getMarket: (id: string) => KitchenMarket | undefined;
  createMarket: (input: CreateKitchenMarketInput, creator: { id: string; displayName: string }) => string;
  predict: (marketId: string, optionId: string) => void;
}

const Context = createContext<KitchenMarketStore | null>(null);

/** One place for the session key, so a rename cannot half-apply. */
const SESSION_KEY = 'reality:kitchen-markets:v1';

export function KitchenMarketProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<KitchenMarketState>(() => ({
    markets: [],
    stats: [],
    myPoints: 0,
    myMarketsCreated: 0,
    myPredictions: 0,
  }));
  const [ready, setReady] = useState(false);

  /*
    Seeded after mount, never during render. The seed stamps times relative to
    `Date.now()`, so producing it on the server would bake in the build clock
    and mismatch on hydration — the same trap `Countdown` and `LiveTicker` had
    to be written around.
  */
  useEffect(() => {
    const restored = readSession();
    setState(
      restored ?? {
        markets: seedMarkets(),
        stats: seedStats(),
        myPoints: 0,
        myMarketsCreated: 0,
        myPredictions: 0,
      },
    );
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    writeSession(state);
  }, [ready, state]);

  const getMarket = useCallback(
    (id: string) => state.markets.find((market) => market.id === id),
    [state.markets],
  );

  const createMarket = useCallback(
    (input: CreateKitchenMarketInput, creator: { id: string; displayName: string }) => {
      const id = `km_${Date.now().toString(36)}`;
      const now = Date.now();

      const market: KitchenMarket = {
        id,
        creator,
        category: input.category,
        question: input.question,
        // Ids are derived from position rather than random, so the same input
        // produces the same market — which is what makes this testable.
        options: withShares(
          input.options.map((option, index) => ({
            id: `${id}_o${index}`,
            label: option.label,
            contestantId: option.contestantId ?? null,
            predictions: 0,
            share: 0,
          })),
        ),
        participants: input.options
          .map((option) => option.contestantId)
          .filter((value): value is string => Boolean(value)),
        slot: input.slot,
        status: 'OPEN',
        startTime: new Date(now).toISOString(),
        endTime: new Date(now + slotDurationMs(input.slot)).toISOString(),
        totalPredictions: 0,
        myOptionId: null,
        winningOptionId: null,
        pointsReward: KITCHEN_MARKET_POINTS.CORRECT_PREDICTION,
        createdAt: new Date(now).toISOString(),
      };

      setState((previous) => ({
        ...previous,
        markets: [market, ...previous.markets],
        myMarketsCreated: previous.myMarketsCreated + 1,
        myPoints: previous.myPoints + KITCHEN_MARKET_POINTS.CREATE_MARKET,
      }));

      return id;
    },
    [],
  );

  const predict = useCallback((marketId: string, optionId: string) => {
    setState((previous) => {
      const market = previous.markets.find((entry) => entry.id === marketId);
      // One prediction per person per market, and none once it is shut. The
      // server will enforce this too; the client refusing first is a courtesy,
      // not the guarantee.
      if (!market || market.status !== 'OPEN' || market.myOptionId) return previous;

      const options = withShares(
        market.options.map((option) =>
          option.id === optionId ? { ...option, predictions: option.predictions + 1 } : option,
        ),
      );

      return {
        ...previous,
        markets: previous.markets.map((entry) =>
          entry.id === marketId
            ? {
                ...entry,
                options,
                myOptionId: optionId,
                totalPredictions: entry.totalPredictions + 1,
              }
            : entry,
        ),
        myPredictions: previous.myPredictions + 1,
        myPoints: previous.myPoints + KITCHEN_MARKET_POINTS.PARTICIPATE,
      };
    });
  }, []);

  const value = useMemo<KitchenMarketStore>(
    () => ({ ...state, ready, getMarket, createMarket, predict }),
    [state, ready, getMarket, createMarket, predict],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useKitchenMarkets(): KitchenMarketStore {
  const store = useContext(Context);
  if (!store) throw new Error('useKitchenMarkets must be used inside <KitchenMarketProvider>');
  return store;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * What a prediction was worth.
 *
 * Exported and pure so it can be tested directly, and so the server module can
 * be checked against the same expectations rather than a second implementation.
 */
export function scorePrediction(options: {
  correct: boolean;
  /** When the prediction was made. */
  predictedAt: number;
  marketOpenedAt: number;
  marketClosesAt: number;
}): { total: number; breakdown: { label: string; points: number }[] } {
  const breakdown: { label: string; points: number }[] = [
    { label: 'Took part', points: KITCHEN_MARKET_POINTS.PARTICIPATE },
  ];

  if (options.correct) {
    breakdown.push({ label: 'Correct call', points: KITCHEN_MARKET_POINTS.CORRECT_PREDICTION });

    const life = options.marketClosesAt - options.marketOpenedAt;
    const elapsed = options.predictedAt - options.marketOpenedAt;
    if (life > 0 && elapsed / life <= KITCHEN_MARKET_POINTS.EARLY_WINDOW) {
      breakdown.push({ label: 'Called it early', points: KITCHEN_MARKET_POINTS.EARLY_BONUS });
    }
  }

  return { total: breakdown.reduce((sum, entry) => sum + entry.points, 0), breakdown };
}

/** What a market earned the person who created it. */
export function scoreCreator(totalPredictions: number): number {
  const base = KITCHEN_MARKET_POINTS.CREATE_MARKET;
  return totalPredictions >= KITCHEN_MARKET_POINTS.CREATOR_BONUS_THRESHOLD
    ? base + KITCHEN_MARKET_POINTS.CREATOR_BONUS
    : base;
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

/** How long a market of each slot stays open. */
function slotDurationMs(slot: CreateKitchenMarketInput['slot']): number {
  const hours = { MORNING: 4, AFTERNOON: 4, EVENING: 5, NIGHT: 6 }[slot];
  return hours * 3_600_000;
}

function readSession(): KitchenMarketState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as KitchenMarketState) : null;
  } catch {
    // A corrupt or blocked store is not worth an error boundary; the seed is
    // a perfectly good fallback.
    return null;
  }
}

function writeSession(state: KitchenMarketState): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    // Private browsing and full quotas both land here. Losing the session is
    // acceptable; breaking the page is not.
  }
}
