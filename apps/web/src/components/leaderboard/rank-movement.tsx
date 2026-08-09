'use client';

import { cn } from '@reality/ui';
import { ArrowDown, ArrowUp, Minus, Sparkles } from 'lucide-react';

export interface RankMovementProps {
  /** previousRank - rank. Positive is a climb; null means no prior position. */
  movement: number | null;
  className?: string;
  /** Hides the label on narrow rows, keeping it for screen readers. */
  compact?: boolean;
}

/**
 * How far a user has moved since the last snapshot.
 *
 * Four distinct states, not three: "new" is deliberately separated from "no
 * change", because a first appearance and a stationary week look identical if
 * you only render a delta, and they mean opposite things.
 */
export function RankMovement({ movement, className, compact }: RankMovementProps) {
  if (movement === null) {
    return (
      <span
        className={cn('inline-flex items-center gap-1 text-xs text-muted', className)}
        title="First time on this board"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className={compact ? 'sr-only' : undefined}>New</span>
      </span>
    );
  }

  if (movement === 0) {
    return (
      <span
        className={cn('inline-flex items-center gap-1 text-xs text-muted', className)}
        title="No change since the last update"
      >
        <Minus className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="sr-only">No change</span>
      </span>
    );
  }

  const climbed = movement > 0;
  const Icon = climbed ? ArrowUp : ArrowDown;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium tabular-nums',
        climbed ? 'text-success' : 'text-danger',
        className,
      )}
      title={`${climbed ? 'Up' : 'Down'} ${Math.abs(movement)} since the last update`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {Math.abs(movement)}
      <span className="sr-only">{climbed ? 'places up' : 'places down'}</span>
    </span>
  );
}
