'use client';

import type { LeaderboardRowView } from '@reality/shared';
import { Avatar, EmptyState, Skeleton, cn } from '@reality/ui';
import { Trophy } from 'lucide-react';

import { RankMovement } from '@/components/leaderboard/rank-movement';

export interface LeaderboardTableProps {
  rows: LeaderboardRowView[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

/** The top three get a colour; past that a medal means nothing. */
const RANK_TONE: Record<number, string> = {
  1: 'text-heat-3',
  2: 'text-muted-foreground',
  3: 'text-heat-4',
};

export function LeaderboardTable({
  rows,
  loading,
  emptyTitle = 'Nobody has scored yet',
  emptyDescription = 'Points earned by taking part show up here.',
}: LeaderboardTableProps) {
  if (loading) {
    return (
      <ul className="space-y-2" aria-busy="true">
        {Array.from({ length: 6 }, (_, index) => (
          <li key={index}>
            <Skeleton className="h-14 w-full rounded-lg" />
          </li>
        ))}
      </ul>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        icon={<Trophy className="h-6 w-6" aria-hidden />}
      />
    );
  }

  return (
    <ol className="space-y-2">
      {rows.map((row) => (
        <li key={row.userId}>
          <div
            className={cn(
              'flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
              row.isYou
                ? 'border-primary/50 bg-primary/10'
                : 'border-border/60 hover:border-border-strong',
            )}
          >
            <span
              className={cn(
                'w-9 shrink-0 text-center font-mono text-sm font-semibold tabular-nums',
                RANK_TONE[row.rank],
              )}
            >
              {row.rank}
            </span>

            <Avatar name={row.displayName} src={row.avatarUrl} size="sm" />

            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {row.displayName}
              {row.isYou && <span className="ml-2 text-xs text-primary">You</span>}
            </span>

            <RankMovement movement={row.movement} compact className="shrink-0" />

            <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums sm:w-24">
              {row.points.toLocaleString()}
              <span className="ml-1 hidden text-xs font-normal text-muted sm:inline">pts</span>
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
