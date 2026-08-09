'use client';

import type { LeaderboardScope, LeaderboardWindow } from '@reality/shared';
import { cn } from '@reality/ui';

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
    <div className="space-y-3">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Who">
        {scopes.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={scope === entry.key}
            onClick={() => onScopeChange(entry.key)}
            className={cn(
              'shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
              scope === entry.key
                ? 'border-primary/50 bg-primary/15 text-foreground'
                : 'border-border text-muted hover:border-border-strong hover:text-foreground',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
        role="tablist"
        aria-label="Time period"
      >
        {WINDOWS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={window === entry.key}
            onClick={() => onWindowChange(entry.key)}
            className={cn(
              'shrink-0 rounded-md px-3 py-1 text-sm transition-colors',
              window === entry.key
                ? 'bg-surface-raised font-medium text-foreground'
                : 'text-muted hover:text-foreground',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
}
