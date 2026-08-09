import { Flame, MessageSquare, Minus, TrendingDown, TrendingUp, Trophy } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Avatar, Badge, ProgressBar } from './primitives';
import { Card } from './card';

/**
 * Domain components. These encode product decisions (what a heat score looks
 * like, how a closed poll differs from a live one) so twenty screens cannot
 * drift apart.
 */

// ---------------------------------------------------------------------------
// Heat
// ---------------------------------------------------------------------------

export type HeatTrendValue = 'UP' | 'DOWN' | 'FLAT';

/** Five bands, each with its own token, so the colour itself carries meaning. */
export function heatBand(score: number): 1 | 2 | 3 | 4 | 5 {
  if (score >= 80) return 5;
  if (score >= 62) return 4;
  if (score >= 45) return 3;
  if (score >= 28) return 2;
  return 1;
}

const heatBandStyles = {
  1: 'border-heat-1/50 bg-heat-1/15 text-heat-1',
  2: 'border-heat-2/50 bg-heat-2/15 text-heat-2',
  3: 'border-heat-3/50 bg-heat-3/15 text-heat-3',
  4: 'border-heat-4/50 bg-heat-4/15 text-heat-4',
  5: 'border-heat-5/50 bg-heat-5/15 text-heat-5',
} as const;

const heatBandLabels = {
  1: 'Cooling',
  2: 'Steady',
  3: 'Warm',
  4: 'Hot',
  5: 'On fire',
} as const;

export interface HeatBadgeProps {
  score: number;
  trend?: HeatTrendValue;
  showLabel?: boolean;
  className?: string;
}

export function HeatBadge({ score, trend = 'FLAT', showLabel = true, className }: HeatBadgeProps) {
  const band = heatBand(score);
  const TrendIcon = trend === 'UP' ? TrendingUp : trend === 'DOWN' ? TrendingDown : Minus;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
        heatBandStyles[band],
        className,
      )}
    >
      <Flame className="h-3.5 w-3.5" aria-hidden />
      <span className="tabular-nums">{Math.round(score)}</span>
      {showLabel && <span className="font-normal opacity-80">{heatBandLabels[band]}</span>}
      <TrendIcon className="h-3 w-3" aria-hidden />
      <span className="sr-only">
        Heat score {Math.round(score)} of 100, {heatBandLabels[band]}, trending {trend.toLowerCase()}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Contestant
// ---------------------------------------------------------------------------

export interface ContestantCardProps {
  name: string;
  tagline?: string | null;
  avatarUrl?: string | null;
  heatScore: number;
  heatTrend?: HeatTrendValue;
  status?: string;
  occupation?: string | null;
  rank?: number;
  href?: string;
  as?: 'article' | 'li';
  className?: string;
  action?: ReactNode;
}

export function ContestantCard({
  name,
  tagline,
  avatarUrl,
  heatScore,
  heatTrend = 'FLAT',
  status,
  occupation,
  rank,
  className,
  action,
}: ContestantCardProps) {
  return (
    <Card
      className={cn(
        'group relative overflow-hidden p-4 transition-colors hover:border-border-strong',
        className,
      )}
    >
      <div
        aria-hidden
        className={cn(
          'absolute inset-x-0 top-0 h-0.5 opacity-70',
          heatBand(heatScore) >= 4 ? 'bg-heat-5' : 'bg-heat-2',
        )}
      />

      <div className="flex items-start gap-3">
        <div className="relative">
          <Avatar name={name} src={avatarUrl} size="lg" />
          {rank !== undefined && (
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface-overlay text-[11px] font-semibold tabular-nums">
              {rank}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold leading-tight">{name}</h3>
            {status && status !== 'ACTIVE' && (
              <Badge tone={status === 'EVICTED' ? 'danger' : status === 'IMMUNE' ? 'success' : 'warning'} size="sm">
                {status.toLowerCase()}
              </Badge>
            )}
          </div>

          {occupation && <p className="text-xs text-muted">{occupation}</p>}
          {tagline && <p className="line-clamp-2 text-sm text-muted">{tagline}</p>}

          <div className="pt-1">
            <HeatBadge score={heatScore} trend={heatTrend} />
          </div>
        </div>
      </div>

      {action && <div className="mt-4">{action}</div>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Option results (shared by polls, predictions, perspectives, kitchen)
// ---------------------------------------------------------------------------

export interface OptionResultProps {
  label: string;
  votes: number;
  total: number;
  selected?: boolean;
  winner?: boolean;
  /** Hides the tally until results are published. */
  hideCounts?: boolean;
  className?: string;
}

export function OptionResult({
  label,
  votes,
  total,
  selected,
  winner,
  hideCounts,
  className,
}: OptionResultProps) {
  const percent = total > 0 ? (votes / total) * 100 : 0;

  return (
    <div
      className={cn(
        'rounded-md border p-3',
        winner ? 'border-success/50 bg-success/5' : selected ? 'border-primary/50 bg-primary/5' : 'border-border',
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{label}</span>
          {selected && (
            <Badge tone="primary" size="sm">
              Your pick
            </Badge>
          )}
          {winner && (
            <Badge tone="success" size="sm">
              <Trophy className="h-3 w-3" aria-hidden /> Result
            </Badge>
          )}
        </span>
        {!hideCounts && (
          <span className="shrink-0 tabular-nums text-muted">
            {Math.round(percent)}%{' '}
            <span className="text-xs">({votes.toLocaleString()})</span>
          </span>
        )}
      </div>

      {!hideCounts && (
        <ProgressBar
          value={percent}
          size="sm"
          tone={winner ? 'success' : selected ? 'primary' : 'accent'}
          label={`${label}: ${Math.round(percent)} percent`}
          className="[&_span]:sr-only"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------

export interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  trend?: { direction: 'up' | 'down' | 'flat'; value: string };
  className?: string;
}

export function StatCard({ label, value, hint, icon, trend, className }: StatCardProps) {
  const TrendIcon =
    trend?.direction === 'up' ? TrendingUp : trend?.direction === 'down' ? TrendingDown : Minus;

  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
        {icon && <span className="text-muted">{icon}</span>}
      </div>

      <p className="mt-2 text-2xl font-semibold tabular-nums">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>

      <div className="mt-1 flex items-center gap-2 text-xs">
        {trend && (
          <span
            className={cn(
              'inline-flex items-center gap-1',
              trend.direction === 'up' && 'text-success',
              trend.direction === 'down' && 'text-danger',
              trend.direction === 'flat' && 'text-muted',
            )}
          >
            <TrendIcon className="h-3 w-3" aria-hidden />
            {trend.value}
          </span>
        )}
        {hint && <span className="text-muted">{hint}</span>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard row
// ---------------------------------------------------------------------------

export interface LeaderboardRowProps {
  rank: number;
  name: string;
  points: number;
  avatarUrl?: string | null;
  isCurrentUser?: boolean;
  previousRank?: number | null;
  className?: string;
}

export function LeaderboardRow({
  rank,
  name,
  points,
  avatarUrl,
  isCurrentUser,
  previousRank,
  className,
}: LeaderboardRowProps) {
  const movement = previousRank == null ? 0 : previousRank - rank;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors',
        isCurrentUser ? 'border-primary/50 bg-primary/10' : 'border-transparent hover:bg-surface-raised',
        className,
      )}
    >
      <span
        className={cn(
          'w-8 shrink-0 text-center font-mono text-sm font-semibold tabular-nums',
          rank === 1 && 'text-heat-3',
          rank === 2 && 'text-muted-foreground',
          rank === 3 && 'text-heat-4',
        )}
      >
        {rank}
      </span>

      <Avatar name={name} src={avatarUrl} size="sm" />

      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {name}
        {isCurrentUser && <span className="ml-2 text-xs text-primary">You</span>}
      </span>

      {movement !== 0 && (
        <span
          className={cn(
            'inline-flex items-center gap-0.5 text-xs tabular-nums',
            movement > 0 ? 'text-success' : 'text-danger',
          )}
        >
          {movement > 0 ? (
            <TrendingUp className="h-3 w-3" aria-hidden />
          ) : (
            <TrendingDown className="h-3 w-3" aria-hidden />
          )}
          {Math.abs(movement)}
          <span className="sr-only">
            {movement > 0 ? 'up' : 'down'} {Math.abs(movement)} places
          </span>
        </span>
      )}

      <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
        {points.toLocaleString()}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Challenge card
// ---------------------------------------------------------------------------

export interface ChallengeCardProps {
  title: string;
  description: string;
  category: string;
  status: string;
  author: string;
  voteCount: number;
  hasVoted?: boolean;
  isOwn?: boolean;
  action?: ReactNode;
  className?: string;
}

const challengeStatusTone: Record<
  string,
  'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger'
> = {
  DRAFT: 'neutral',
  SUBMITTED: 'neutral',
  MODERATION: 'warning',
  APPROVED: 'primary',
  REJECTED: 'danger',
  COMMUNITY_VOTING: 'primary',
  TOP_CHALLENGES: 'accent',
  PRODUCER_REVIEW: 'warning',
  SELECTED: 'success',
  EXECUTED: 'success',
  COMPLETED: 'success',
};

export function ChallengeCard({
  title,
  description,
  category,
  status,
  author,
  voteCount,
  hasVoted,
  isOwn,
  action,
  className,
}: ChallengeCardProps) {
  return (
    <Card className={cn('flex h-full flex-col p-4', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={challengeStatusTone[status] ?? 'neutral'} size="sm">
          {status.replace(/_/g, ' ').toLowerCase()}
        </Badge>
        <Badge size="sm">{category.toLowerCase()}</Badge>
        {isOwn && (
          <Badge tone="primary" size="sm">
            Yours
          </Badge>
        )}
      </div>

      <h3 className="mt-3 font-semibold leading-tight">{title}</h3>
      <p className="mt-1.5 line-clamp-3 flex-1 text-sm text-muted">{description}</p>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
        <span className="flex items-center gap-2 text-xs text-muted">
          <Avatar name={author} size="sm" className="h-6 w-6 text-[10px]" />
          {author}
        </span>

        <span className="flex items-center gap-1.5 text-sm tabular-nums">
          <MessageSquare className="h-3.5 w-3.5 text-muted" aria-hidden />
          {voteCount.toLocaleString()}
          <span className="sr-only">votes</span>
          {hasVoted && <span className="text-xs text-primary">· voted</span>}
        </span>
      </div>

      {action && <div className="mt-3">{action}</div>}
    </Card>
  );
}
