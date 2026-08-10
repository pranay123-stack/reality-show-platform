import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { apiMock, renderScreen } from '../helpers/render';

import { ChallengesScreen } from '@/components/challenges/challenges-screen';
import { KitchenScreen } from '@/components/kitchen/kitchen-screen';
import { LeaderboardScreen } from '@/components/leaderboard/leaderboard-screen';
import { PerspectivesScreen } from '@/components/perspectives/perspectives-screen';
import { PollsScreen } from '@/components/polls/polls-screen';
import { PredictionsScreen } from '@/components/predictions/predictions-screen';
import { WeekendScreen } from '@/components/weekend/weekend-screen';

/**
 * Loading, failure and empty are three different answers and a screen has to
 * tell them apart. "Nothing is here" and "we could not find out" look identical
 * if a screen only ever renders an empty list.
 */

const DATA_SCREENS: [name: string, element: () => ReactElement][] = [
  ['polls', () => <PollsScreen />],
  ['predictions', () => <PredictionsScreen />],
  ['challenges', () => <ChallengesScreen />],
  ['perspectives', () => <PerspectivesScreen />],
  ['kitchen', () => <KitchenScreen />],
  ['weekend', () => <WeekendScreen />],
  ['leaderboard', () => <LeaderboardScreen />],
];

describe('loading states', () => {
  it.each(DATA_SCREENS)('%s announces loading politely while the request is in flight', async (
    _name,
    element,
  ) => {
    renderScreen(element(), { pending: true });

    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(/loading/i);
  });

  it.each(DATA_SCREENS)('%s keeps its heading visible while loading', async (_name, element) => {
    renderScreen(element(), { pending: true });

    // A page that blanks itself while loading loses the user's place.
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});

describe('error states', () => {
  it.each(DATA_SCREENS)('%s reports a failed request as an alert', async (_name, element) => {
    renderScreen(element(), { failing: true });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it.each(DATA_SCREENS)('%s offers a retry that re-requests', async (_name, element) => {
    const user = userEvent.setup();
    renderScreen(element(), { failing: true });

    await screen.findByRole('alert');
    const retry = screen.getByRole('button', { name: /try again/i });

    const before = apiMock.get.mock.calls.length;
    await user.click(retry);

    await waitFor(() => expect(apiMock.get.mock.calls.length).toBeGreaterThan(before));
  });

  it('never leaks a raw transport message to the reader', async () => {
    renderScreen(<PollsScreen />, {
      routes: { '/polls': new Error('connect ECONNREFUSED 127.0.0.1:4000') },
    });

    await screen.findByRole('alert');
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
    expect(screen.queryByText(/127\.0\.0\.1/)).not.toBeInTheDocument();
  });
});

describe('empty states', () => {
  it('says a poll list is empty rather than rendering nothing', async () => {
    renderScreen(<PollsScreen />, { routes: { '/polls': [] } });

    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Something explains the emptiness; the page is not silently blank.
    expect(document.body.textContent).toMatch(/no|nothing|yet|open/i);
  });

  it('distinguishes an empty result from a failed one', async () => {
    const { unmount } = renderScreen(<PollsScreen />, { routes: { '/polls': [] } });
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    unmount();

    renderScreen(<PollsScreen />, { failing: true });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
