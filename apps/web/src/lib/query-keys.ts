/**
 * Central query-key registry.
 *
 * Keeping every key in one place is what makes targeted invalidation possible:
 * a mutation can invalidate `queryKeys.polls.all` without a component needing to
 * know which screens happen to be mounted.
 */
export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
    sessions: ['auth', 'sessions'] as const,
  },
  show: {
    current: ['show', 'current'] as const,
    live: ['show', 'live'] as const,
  },
  contestants: {
    all: ['contestants'] as const,
    list: (params?: unknown) => ['contestants', 'list', params ?? {}] as const,
    detail: (id: string) => ['contestants', 'detail', id] as const,
    heat: (id: string, window: string) => ['contestants', 'heat', id, window] as const,
  },
  predictions: {
    all: ['predictions'] as const,
    list: (params?: unknown) => ['predictions', 'list', params ?? {}] as const,
    detail: (id: string) => ['predictions', 'detail', id] as const,
    mine: ['predictions', 'mine'] as const,
  },
  polls: {
    all: ['polls'] as const,
    active: ['polls', 'active'] as const,
    detail: (id: string) => ['polls', 'detail', id] as const,
  },
  challenges: {
    all: ['challenges'] as const,
    feed: (params?: unknown) => ['challenges', 'feed', params ?? {}] as const,
    detail: (id: string) => ['challenges', 'detail', id] as const,
    mine: ['challenges', 'mine'] as const,
  },
  perspectives: {
    all: ['perspectives'] as const,
    list: (params?: unknown) => ['perspectives', 'list', params ?? {}] as const,
    detail: (id: string) => ['perspectives', 'detail', id] as const,
  },
  nominations: {
    current: ['nominations', 'current'] as const,
    detail: (id: string) => ['nominations', 'detail', id] as const,
  },
  evictions: {
    current: ['evictions', 'current'] as const,
    detail: (id: string) => ['evictions', 'detail', id] as const,
  },
  kitchen: {
    current: ['kitchen', 'current'] as const,
    detail: (id: string) => ['kitchen', 'detail', id] as const,
  },
  weekend: {
    current: ['weekend', 'current'] as const,
    mine: ['weekend', 'mine'] as const,
  },
  points: {
    balance: ['points', 'balance'] as const,
    history: (params?: unknown) => ['points', 'history', params ?? {}] as const,
  },
  rewards: {
    catalogue: ['rewards', 'catalogue'] as const,
    mine: ['rewards', 'mine'] as const,
  },
  leaderboards: {
    all: ['leaderboards'] as const,
    board: (type: string, params?: unknown) => ['leaderboards', type, params ?? {}] as const,
  },
  notifications: {
    list: ['notifications', 'list'] as const,
    unread: ['notifications', 'unread'] as const,
    preferences: ['notifications', 'preferences'] as const,
  },
  dashboard: ['dashboard'] as const,
  admin: {
    overview: ['admin', 'overview'] as const,
    section: (section: string, params?: unknown) => ['admin', section, params ?? {}] as const,
  },
} as const;
