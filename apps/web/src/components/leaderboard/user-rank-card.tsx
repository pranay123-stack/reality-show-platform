'use client';

import type { LeaderboardMeView, LeaderboardView } from '@reality/shared';
import { Badge, Button, Card, ProgressBar, cn } from '@reality/ui';
import { Eye, EyeOff, Trophy } from 'lucide-react';

import { RankMovement } from '@/components/leaderboard/rank-movement';
import { useUpdatePrivacy } from '@/hooks/use-leaderboard';

export interface UserRankCardProps {
  me: LeaderboardMeView | null;
  board: LeaderboardView;
}

/**
 * The viewer's own standing.
 *
 * Percentile sits next to rank on purpose: "#312" is demoralising and
 * uninformative on a big board, while "top 8%" stays meaningful however many
 * people are playing.
 */
export function UserRankCard({ me, board }: UserRankCardProps) {
  const privacy = useUpdatePrivacy();

  if (!me) return null;

  const unranked = me.rank === null;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <span className="flex items-center gap-2 text-sm text-muted">
            <Trophy className="h-4 w-4 text-accent" aria-hidden />
            Your position
          </span>

          {unranked ? (
            <p className="text-lg font-medium">Not ranked yet</p>
          ) : (
            <div className="flex flex-wrap items-baseline gap-3">
              <p className="text-3xl font-semibold tabular-nums">
                <span className="text-base font-normal text-muted">#</span>
                {me.rank}
              </p>
              <RankMovement movement={me.movement} />
            </div>
          )}

          <p className="text-sm text-muted tabular-nums">
            {me.points.toLocaleString()} points{' '}
            {board.window === 'SEASON'
              ? 'this season'
              : board.window === 'WEEKLY'
                ? 'this week'
                : 'today'}
          </p>
        </div>

        <div className="space-y-2 sm:text-right">
          {me.percentile !== null && (
            <Badge tone={me.percentile >= 90 ? 'accent' : 'neutral'}>
              Top {Math.max(1, 100 - me.percentile)}%
            </Badge>
          )}
          <p className="text-xs text-muted tabular-nums">
            of {board.totalRanked.toLocaleString()} ranked
          </p>
        </div>
      </div>

      {me.percentile !== null && (
        <ProgressBar
          value={me.percentile}
          max={100}
          tone={me.percentile >= 90 ? 'accent' : 'primary'}
          size="sm"
          label="Percentile"
        />
      )}

      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3',
          'text-sm',
        )}
      >
        <span className="flex items-center gap-2 text-muted">
          {me.hidden ? (
            <EyeOff className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <Eye className="h-4 w-4 shrink-0" aria-hidden />
          )}
          {me.hidden
            ? 'You are hidden from other people’s boards'
            : 'You appear in public rankings'}
        </span>

        <Button
          size="sm"
          variant="ghost"
          loading={privacy.isPending}
          onClick={() => privacy.mutate({ leaderboardVisible: me.hidden })}
        >
          {me.hidden ? 'Show me' : 'Hide me'}
        </Button>
      </div>

      {me.hidden && (
        <p className="text-xs text-muted">
          Your rank is still counted and still yours to see — you are simply not listed for anyone
          else.
        </p>
      )}
    </Card>
  );
}
