import { screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { PRODUCER, VIEWER, renderScreen } from '../helpers/render';

import { ChallengesScreen } from '@/components/challenges/challenges-screen';
import { KitchenScreen } from '@/components/kitchen/kitchen-screen';
import { LeaderboardScreen } from '@/components/leaderboard/leaderboard-screen';
import { NotificationPage } from '@/components/notifications/notification-page';
import { PerspectivesScreen } from '@/components/perspectives/perspectives-screen';
import { PollsScreen } from '@/components/polls/polls-screen';
import { PredictionsScreen } from '@/components/predictions/predictions-screen';
import { ProfileScreen } from '@/components/profile/profile-screen';
import { RewardsPage } from '@/components/rewards/rewards-page';
import { WeekendScreen } from '@/components/weekend/weekend-screen';

/**
 * Every audience screen renders, and each one owns exactly one `h1`.
 *
 * The heading assertion is the point: before these screens went through
 * `PageHeader` they carried two different `h1` treatments, and the sign-in
 * pages carried none at all — a document outline starting at level three.
 */

interface ScreenCase {
  name: string;
  heading: RegExp;
  element: () => ReactElement;
  /** Endpoints whose shape the screen dereferences directly. */
  routes?: Record<string, unknown>;
  /**
   * Screens that deliberately replace themselves with a sign-in prompt rather
   * than render a heading over nothing.
   */
  signedOutPrompt?: RegExp;
}

const SCREENS: ScreenCase[] = [
  { name: 'polls', heading: /Live Polls/i, element: () => <PollsScreen /> },
  { name: 'predictions', heading: /Make Your Prediction/i, element: () => <PredictionsScreen /> },
  { name: 'challenges', heading: /Change The House/i, element: () => <ChallengesScreen /> },
  { name: 'perspectives', heading: /Pick A Side/i, element: () => <PerspectivesScreen /> },
  { name: 'kitchen', heading: /Kitchen Battle/i, element: () => <KitchenScreen /> },
  {
    name: 'weekend',
    heading: /Weekend Spotlight/i,
    element: () => <WeekendScreen />,
    // `null` is the real "no round is open" answer, not a missing fixture.
    routes: { '/weekend/current': null },
  },
  { name: 'rewards', heading: /Points & Rewards/i, element: () => <RewardsPage /> },
  { name: 'leaderboard', heading: /Leaderboard/i, element: () => <LeaderboardScreen /> },
  { name: 'notifications', heading: /Notifications/i, element: () => <NotificationPage /> },
  {
    name: 'profile',
    heading: /Your profile/i,
    element: () => <ProfileScreen />,
    signedOutPrompt: /signed out/i,
  },
];

describe('every audience screen', () => {
  it.each(SCREENS)('renders $name under a single h1', async ({ heading, element, routes }) => {
    renderScreen(element(), { routes });

    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent(heading);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it.each(SCREENS)(
    'gives a signed-out visitor $name or a reason, never a blank page',
    async ({ heading, element, routes, signedOutPrompt }) => {
      renderScreen(element(), { user: null, routes });

      if (signedOutPrompt) {
        expect(await screen.findByText(signedOutPrompt)).toBeInTheDocument();
        return;
      }
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(heading);
    },
  );
});

describe('heading hierarchy', () => {
  it('never skips from h1 straight past h2', async () => {
    renderScreen(<PollsScreen />);
    await screen.findByRole('heading', { level: 1 });

    const levels = screen
      .getAllByRole('heading')
      .map((node) => Number(node.tagName.slice(1)))
      .sort((a, b) => a - b);

    // Every level present must have its parent level present too.
    for (const level of levels) {
      if (level > 1) expect(levels).toContain(level - 1);
    }
  });
});

describe('permission states', () => {
  it('refuses the analytics dashboard to an account without the permission', async () => {
    const { AnalyticsDashboard } = await import('@/components/admin/analytics-dashboard');
    renderScreen(<AnalyticsDashboard />, { user: VIEWER });

    expect(await screen.findByText(/visible to producers and administrators/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Analytics$/ })).not.toBeInTheDocument();
  });

  it('shows the analytics dashboard to a producer', async () => {
    const { AnalyticsDashboard } = await import('@/components/admin/analytics-dashboard');
    renderScreen(<AnalyticsDashboard />, {
      user: PRODUCER,
      routes: {
        '/analytics/admin/overview': {
          generatedAt: new Date('2026-01-01').toISOString(),
          asOf: '2026-01-01',
          rangeDays: 30,
          stale: false,
          summary: [],
          engagementFunnel: [],
          featureUsage: [],
          contestantTrends: [],
          economy: { pointsEarned: [], pointsSpent: [], redemptions: [] },
          participation: [],
          privacy: { optedOut: 0, totalUsers: 10, coveragePercent: 100 },
        },
        '/analytics/admin/events': [],
      },
    });

    expect(await screen.findByRole('heading', { level: 1, name: /Analytics/ })).toBeInTheDocument();
  });

  it('refuses leaderboard operations to an account without the permission', async () => {
    const { LeaderboardAdmin } = await import('@/components/leaderboard/leaderboard-admin');
    renderScreen(<LeaderboardAdmin />, { user: VIEWER });

    await waitFor(() =>
      expect(screen.getByText(/do not have access to leaderboard operations/i)).toBeInTheDocument(),
    );
  });

  it('tells a signed-out visitor to sign in rather than showing an empty profile', async () => {
    renderScreen(<ProfileScreen />, { user: null });

    expect(await screen.findByText(/signed out/i)).toBeInTheDocument();
  });
});
