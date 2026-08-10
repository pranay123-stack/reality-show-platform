'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '../lib/cn';

export interface CountdownProps {
  /** ISO string or Date the countdown runs to. */
  to: string | Date;
  onComplete?: () => void;
  /** `compact` for inline chips, `blocks` for a prominent timer. */
  variant?: 'compact' | 'blocks';
  className?: string;
  /** Text shown once the deadline has passed. */
  finishedLabel?: string;
}

/**
 * A countdown to a server-provided deadline.
 *
 * The clock is only a display: whether a poll or prediction is actually still
 * open is decided by the server when the vote arrives. A client whose system
 * clock is wrong sees the wrong number here, but cannot vote late because of it.
 *
 * ### On `suppressHydrationWarning`
 *
 * This renders the remaining time on the *first* render, which is what keeps a
 * countdown from flashing in a second after the page settles. On a statically
 * prerendered page that text is produced at build time and again at hydration,
 * and if those two moments fall either side of a second boundary the strings
 * differ by one — a real mismatch that React reports as error #418.
 *
 * The content is legitimately time-dependent, so this is the case the escape
 * hatch exists for. React still renders the client's value; it just stops
 * treating a clock that has moved as a bug. Only the numeric text carries it,
 * so a genuine structural mismatch anywhere else is still reported.
 */
export function Countdown({
  to,
  onComplete,
  variant = 'compact',
  className,
  finishedLabel = 'Closed',
}: CountdownProps) {
  const target = useMemo(() => (typeof to === 'string' ? new Date(to) : to).getTime(), [to]);
  const [remaining, setRemaining] = useState(() => Math.max(0, target - Date.now()));
  const completed = useRef(false);

  useEffect(() => {
    completed.current = false;
    setRemaining(Math.max(0, target - Date.now()));

    const id = setInterval(() => {
      const next = Math.max(0, target - Date.now());
      setRemaining(next);
      if (next === 0 && !completed.current) {
        completed.current = true;
        onComplete?.();
      }
    }, 1000);

    return () => clearInterval(id);
  }, [target, onComplete]);

  const { days, hours, minutes, seconds } = splitDuration(remaining);
  const finished = remaining <= 0;
  const urgent = !finished && remaining < 60_000;

  if (finished) {
    return (
      <span className={cn('text-sm font-medium text-muted', className)} role="timer">
        {finishedLabel}
      </span>
    );
  }

  if (variant === 'compact') {
    return (
      <span
        role="timer"
        aria-live="off"
        className={cn(
          'font-mono text-sm tabular-nums',
          urgent ? 'text-danger' : 'text-foreground',
          className,
        )}
      >
        <span className="sr-only">Time remaining: </span>
        <span suppressHydrationWarning>
          {days > 0 && `${days}d `}
          {pad(hours)}:{pad(minutes)}:{pad(seconds)}
        </span>
      </span>
    );
  }

  const blocks = [
    ...(days > 0 ? [{ label: 'days', value: days }] : []),
    { label: 'hrs', value: hours },
    { label: 'min', value: minutes },
    { label: 'sec', value: seconds },
  ];

  return (
    <div role="timer" aria-live="off" className={cn('flex items-center gap-2', className)}>
      <span className="sr-only" suppressHydrationWarning>
        Time remaining: {days} days {hours} hours {minutes} minutes {seconds} seconds
      </span>
      {blocks.map((block) => (
        <div
          key={block.label}
          aria-hidden
          className={cn(
            'flex min-w-14 flex-col items-center rounded-md border px-2.5 py-1.5',
            urgent ? 'border-danger/50 bg-danger/10' : 'border-border bg-surface-raised',
          )}
        >
          <span
            suppressHydrationWarning
            className={cn('font-mono text-xl font-semibold tabular-nums', urgent && 'text-danger')}
          >
            {pad(block.value)}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-muted">{block.label}</span>
        </div>
      ))}
    </div>
  );
}

function splitDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}
