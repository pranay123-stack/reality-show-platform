'use client';

import type { LeaderboardScope, LeaderboardWindow } from '@reality/shared';
import { FilterChips } from '@reality/ui';

export interface LeaderboardTabsProps {
  scope: LeaderboardScope;
  window: LeaderboardWindow;
  onScopeChange: (scope: LeaderboardScope) => void;
  onWindowChange: (window: LeaderboardWindow) => void;
  /** Friends and communities need an account. */
  authenticated: boolean;
}

const SCOPES: { key: LeaderboardScope; label: string; needsAuth?: boolean }[] = [
  { key: 'SEASON', label: 'Everyone' },
  { key: 'FRIENDS', label: 'Friends', needsAuth: true },
  { key: 'COMMUNITY', label: 'Communities' },
];

const WINDOWS: { key: LeaderboardWindow; label: string }[] = [
  { key: 'DAILY', label: 'Today' },
  { key: 'WEEKLY', label: 'This week' },
  { key: 'SEASON', label: 'Season' },
];

/**
 * Two independent axes: *who* is ranked and *over what period*.
 *
 * Kept as separate controls rather than one flat list of five tabs, because
 * "my friends, this week" is a real question and a flat list cannot express it.
 */
export function LeaderboardTabs({
  scope,
  window,
  onScopeChange,
  onWindowChange,
  authenticated,
}: LeaderboardTabsProps) {
  const scopes = SCOPES.filter((entry) => authenticated || !entry.needsAuth);

  return (
    <div className="space-y-2">
      <FilterChips
        label="Who is ranked"
        value={scope}
        onChange={onScopeChange}
        options={scopes.map((entry) => ({ value: entry.key, label: entry.label }))}
      />
      <FilterChips
        label="Time period"
        variant="quiet"
        value={window}
        onChange={onWindowChange}
        options={WINDOWS.map((entry) => ({ value: entry.key, label: entry.label }))}
      />
    </div>
  );
}
