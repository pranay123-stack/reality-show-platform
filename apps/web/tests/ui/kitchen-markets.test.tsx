import { KITCHEN_MARKET_POINTS, createKitchenMarketSchema, withShares } from '@reality/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '../helpers/render';

import { MarketDetail } from '@/components/kitchen-markets/market-detail';
import { KitchenMarketsScreen } from '@/components/kitchen-markets/markets-screen';
import { KitchenMarketProvider } from '@/lib/kitchen-markets/store';
import { scoreCreator, scorePrediction } from '@/lib/kitchen-markets/store';

/**
 * Kitchen Markets.
 *
 * The scoring tests matter most: those numbers are what the server module will
 * be checked against, and a points table that only exists in a component is a
 * points table nobody can verify.
 */

const HOUR = 3_600_000;

function withProvider(ui: React.ReactElement) {
  return <KitchenMarketProvider>{ui}</KitchenMarketProvider>;
}

// ---------------------------------------------------------------------------

describe('scoring', () => {
  const opened = 0;
  const closes = 12 * HOUR;

  it('pays participation for a wrong call and nothing more', () => {
    const result = scorePrediction({
      correct: false,
      predictedAt: 1 * HOUR,
      marketOpenedAt: opened,
      marketClosesAt: closes,
    });

    expect(result.total).toBe(KITCHEN_MARKET_POINTS.PARTICIPATE);
    expect(result.breakdown.map((entry) => entry.label)).toEqual(['Took part']);
  });

  it('pays the early bonus inside the first third of a market', () => {
    const result = scorePrediction({
      correct: true,
      // Three hours into a twelve-hour market: a quarter of its life.
      predictedAt: 3 * HOUR,
      marketOpenedAt: opened,
      marketClosesAt: closes,
    });

    expect(result.total).toBe(
      KITCHEN_MARKET_POINTS.PARTICIPATE +
        KITCHEN_MARKET_POINTS.CORRECT_PREDICTION +
        KITCHEN_MARKET_POINTS.EARLY_BONUS,
    );
  });

  it('withholds the early bonus after the window closes', () => {
    const result = scorePrediction({
      correct: true,
      // Eight hours in: two-thirds through, comfortably past the window.
      predictedAt: 8 * HOUR,
      marketOpenedAt: opened,
      marketClosesAt: closes,
    });

    expect(result.total).toBe(
      KITCHEN_MARKET_POINTS.PARTICIPATE + KITCHEN_MARKET_POINTS.CORRECT_PREDICTION,
    );
    expect(result.breakdown).toHaveLength(2);
  });

  it('treats the boundary itself as early', () => {
    const onTheLine = scorePrediction({
      correct: true,
      predictedAt: closes * KITCHEN_MARKET_POINTS.EARLY_WINDOW,
      marketOpenedAt: opened,
      marketClosesAt: closes,
    });

    expect(onTheLine.breakdown.some((entry) => entry.label === 'Called it early')).toBe(true);
  });

  it('pays the creator bonus only once a market draws a crowd', () => {
    expect(scoreCreator(0)).toBe(KITCHEN_MARKET_POINTS.CREATE_MARKET);
    expect(scoreCreator(KITCHEN_MARKET_POINTS.CREATOR_BONUS_THRESHOLD - 1)).toBe(
      KITCHEN_MARKET_POINTS.CREATE_MARKET,
    );
    expect(scoreCreator(KITCHEN_MARKET_POINTS.CREATOR_BONUS_THRESHOLD)).toBe(
      KITCHEN_MARKET_POINTS.CREATE_MARKET + KITCHEN_MARKET_POINTS.CREATOR_BONUS,
    );
  });
});

describe('shares', () => {
  it('derives every share from the counts and sums to about a hundred', () => {
    const options = withShares([
      { id: 'a', label: 'A', contestantId: null, predictions: 42, share: 0 },
      { id: 'b', label: 'B', contestantId: null, predictions: 31, share: 0 },
      { id: 'c', label: 'C', contestantId: null, predictions: 27, share: 0 },
    ]);

    expect(options.map((option) => option.share)).toEqual([42, 31, 27]);
  });

  it('reports zero rather than dividing by nothing on a fresh market', () => {
    const options = withShares([
      { id: 'a', label: 'A', contestantId: null, predictions: 0, share: 0 },
      { id: 'b', label: 'B', contestantId: null, predictions: 0, share: 0 },
    ]);

    expect(options.every((option) => option.share === 0)).toBe(true);
  });
});

describe('the create schema is the API contract', () => {
  const valid = {
    category: 'COOKING' as const,
    question: 'Who will cook pasta tonight?',
    slot: 'EVENING' as const,
    options: [{ label: 'Mira Sol' }, { label: 'Aria Vale' }],
  };

  it('accepts a well-formed market', () => {
    expect(createKitchenMarketSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses a market with only one option', () => {
    const result = createKitchenMarketSchema.safeParse({ ...valid, options: [{ label: 'Only' }] });
    expect(result.success).toBe(false);
  });

  it('refuses a question too short to settle', () => {
    expect(createKitchenMarketSchema.safeParse({ ...valid, question: 'Who?' }).success).toBe(false);
  });

  it('strips anything a client should not be sending', () => {
    const result = createKitchenMarketSchema.safeParse({
      ...valid,
      // The two fields that would make this not a prediction market.
      winningOptionId: 'kmo_rigged',
      pointsAwarded: 999_999,
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data).not.toHaveProperty('winningOptionId');
    expect(result.success && result.data).not.toHaveProperty('pointsAwarded');
  });
});

describe('the markets screen', () => {
  it('renders the slate under a single h1 and says the points are separate', async () => {
    renderScreen(withProvider(<KitchenMarketsScreen />));

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/Kitchen Markets/i);
    // The honesty notice is load-bearing, not decoration.
    expect(screen.getByText(/separate from your platform points/i)).toBeInTheDocument();
  });

  it('shows every seeded market and filters down to one category', async () => {
    const user = userEvent.setup();
    renderScreen(withProvider(<KitchenMarketsScreen />));

    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(screen.getByText(/Who will cook pasta tonight\?/)).toBeInTheDocument());
    expect(screen.getByText(/Will the kitchen argument happen tonight\?/)).toBeInTheDocument();

    const filters = screen.getByRole('group', { name: /filter markets/i });
    await user.click(within(filters).getByRole('button', { name: /^Drama/ }));

    expect(screen.getByText(/Will the kitchen argument happen tonight\?/)).toBeInTheDocument();
    expect(screen.queryByText(/Who will cook pasta tonight\?/)).not.toBeInTheDocument();
  });

  it('ranks today’s champions with the leader first', async () => {
    renderScreen(withProvider(<KitchenMarketsScreen />));
    await screen.findByRole('heading', { level: 1 });

    const champions = await screen.findByRole('heading', { name: /kitchen champions/i });
    expect(champions).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('NightOwl')).toBeInTheDocument());
  });
});

describe('predicting on a market', () => {
  it('records the pick, moves the share and locks out a second prediction', async () => {
    const user = userEvent.setup();
    renderScreen(withProvider(<MarketDetail marketId="km_argument" />));

    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(screen.getByRole('button', { name: /^Yes/ })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^Yes/ }));

    // The option list becomes standings: no option is a button any more.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^No/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/Where the house stands/i)).toBeInTheDocument();
  });

  it('refuses to predict when the account cannot take part', async () => {
    renderScreen(withProvider(<MarketDetail marketId="km_argument" />), { user: null });

    await screen.findByRole('heading', { level: 1 });
    await waitFor(() =>
      expect(screen.getByText(/Confirm your email address to predict/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /^Yes/ })).not.toBeInTheDocument();
  });

  it('shows a settled market as settled and never as predictable', async () => {
    renderScreen(withProvider(<MarketDetail marketId="km_lunch_resolved" />));

    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(screen.getByText(/was the outcome/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Dev Rahman/ })).not.toBeInTheDocument();
  });

  it('explains a market that does not exist rather than rendering nothing', async () => {
    renderScreen(withProvider(<MarketDetail marketId="km_does_not_exist" />));

    expect(await screen.findByText(/That market is not here/i)).toBeInTheDocument();
  });
});
