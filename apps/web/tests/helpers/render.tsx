import type { AuthUser } from '@reality/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { AuthProvider } from '@/providers/auth-provider';

import { apiMock } from './api-mock';

export { apiMock };

/**
 * Renders a screen against a scripted API.
 *
 * Routes are matched by prefix against the paths the screens actually request,
 * so a test only has to name the endpoints it cares about. Anything unscripted
 * resolves empty rather than throwing — a screen should not fall over because a
 * side panel it also renders had no fixture.
 */

export interface ApiScript {
  /** Path prefix (without the API base) mapped to the value `api.get` resolves. */
  [pathPrefix: string]: unknown;
}

/** A complete `AuthUser`, so a screen never crashes on a field the fixture forgot. */
export const VIEWER: AuthUser = {
  id: 'user-1',
  email: 'viewer1@reality.local',
  role: 'USER',
  status: 'ACTIVE',
  emailVerified: true,
  phoneVerified: false,
  displayName: 'Ada Viewer',
  avatarUrl: null,
  bio: null,
  country: 'GB',
  timezone: 'Europe/London',
  pointsBalance: 1200,
  lifetimePoints: 4300,
  createdAt: '2026-01-05T10:00:00.000Z',
  permissions: [],
};

export const PRODUCER: AuthUser = {
  ...VIEWER,
  id: 'user-2',
  email: 'producer@reality.local',
  displayName: 'Pat Producer',
  role: 'PRODUCER',
  permissions: [
    'analytics.view',
    'analytics.rebuild',
    'leaderboard.inspect',
    'notification.inspect',
    'notification.manage',
  ],
};

export interface RenderScreenOptions {
  /** `null` renders the signed-out view. */
  user?: AuthUser | null;
  routes?: ApiScript;
  /** Makes every unscripted request hang, so loading states can be asserted. */
  pending?: boolean;
  /** Makes every unscripted request reject, so error states can be asserted. */
  failing?: boolean;
}

function scriptApi({ user, routes = {}, pending, failing }: RenderScreenOptions): void {
  const entries = Object.entries(routes);

  apiMock.get.mockImplementation((path: string) => {
    if (path.startsWith('/auth/me')) {
      return user ? Promise.resolve(user) : Promise.reject(new Error('Unauthorised'));
    }
    const match = entries.find(([prefix]) => path.startsWith(prefix));
    if (match) {
      const value = match[1];
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    if (pending) return new Promise(() => {});
    if (failing) return Promise.reject(new Error('Request failed'));
    return Promise.resolve([]);
  });

  for (const fn of [apiMock.post, apiMock.patch, apiMock.put, apiMock.delete]) {
    fn.mockImplementation(() => Promise.resolve({}));
  }
}

export function renderScreen(ui: ReactElement, options: RenderScreenOptions = {}): RenderResult {
  scriptApi({ user: options.user === undefined ? VIEWER : options.user, ...options });

  const queryClient = new QueryClient({
    defaultOptions: {
      // A test asserting an error state should not wait through three retries.
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper });
}
