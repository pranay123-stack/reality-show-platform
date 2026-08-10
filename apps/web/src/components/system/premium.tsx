'use client';

import { cn } from '@reality/ui';
import { animate, useInView, useReducedMotion } from 'framer-motion';
import { Radio } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The small pieces that make a broadcast interface feel live.
 *
 * Each one earns its animation by carrying information: the live badge pulses
 * because something is genuinely on air, and a number counts up because it
 * changed. Nothing here moves purely for decoration.
 */

// ---------------------------------------------------------------------------
// Numbers that arrive
// ---------------------------------------------------------------------------

export interface CountUpProps {
  value: number;
  /** Seconds. Long enough to read as motion, short enough not to be waited on. */
  duration?: number;
  format?: (value: number) => string;
  className?: string;
}

/**
 * A number that counts to its value when it scrolls into view.
 *
 * Renders the *final* value on the server and until it animates, so the page
 * never ships a meaningless zero to a reader without JavaScript, to a crawler,
 * or to anyone who has asked for reduced motion.
 */
export function CountUp({
  value,
  duration = 1.1,
  format = (input) => Math.round(input).toLocaleString(),
  className,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (!inView || reduced) {
      setDisplay(value);
      return;
    }

    const controls = animate(0, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setDisplay(latest),
    });
    return () => controls.stop();
  }, [inView, reduced, value, duration]);

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {format(display)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

/** `● LIVE NOW`, with a pulse that stops when nothing is live. */
export function LiveBadge({ label = 'Live now', live = true }: { label?: string; live?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]',
        live
          ? 'border-live/50 bg-live/10 text-live shadow-[0_0_20px_-6px_hsl(var(--live))]'
          : 'border-border bg-surface-raised text-muted',
      )}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {live && (
          <span
            aria-hidden
            className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-70"
          />
        )}
        <span
          aria-hidden
          className={cn('relative inline-flex h-2 w-2 rounded-full', live ? 'bg-live' : 'bg-muted')}
        />
      </span>
      {label}
    </span>
  );
}

/** `EPISODE 12 · ON AIR` — the show's own state, not the platform's. */
export function EpisodeBadge({
  episode,
  status = 'On air',
}: {
  episode: string | number;
  status?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2.5 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted backdrop-blur">
      <Radio className="h-3.5 w-3.5 text-accent" aria-hidden />
      <span className="text-foreground">Episode {episode}</span>
      <span aria-hidden className="h-3 w-px bg-white/15" />
      {status}
    </span>
  );
}

/** A single engagement figure, e.g. "12,480 viewers playing". */
export function EngagementStat({
  value,
  label,
  icon,
  className,
}: {
  value: number;
  label: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm text-muted', className)}>
      {icon}
      <CountUp value={value} className="font-semibold text-foreground" />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------

export interface MeterProps {
  /** 0–100. */
  percent: number;
  tone?: 'pink' | 'cyan' | 'purple' | 'gold';
  /** Grows from zero when it scrolls into view. */
  animateOnView?: boolean;
  className?: string;
}

const METER_TONES = {
  pink: 'bg-neon-pink',
  cyan: 'bg-neon-cyan',
  purple: 'bg-neon-purple',
  gold: 'bg-neon-gold',
} as const;

/**
 * A share bar that fills on arrival.
 *
 * The width is a CSS transition rather than a Framer animation: one property,
 * on the compositor, and it stays correct if the value updates from a socket
 * mid-animation.
 */
export function Meter({ percent, tone = 'pink', animateOnView = true, className }: MeterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const reduced = useReducedMotion();
  const grown = !animateOnView || reduced || inView;

  return (
    <div
      ref={ref}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]', className)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-[900ms] ease-out',
          METER_TONES[tone],
        )}
        style={{ width: `${grown ? Math.max(2, Math.min(100, percent)) : 0}%` }}
      />
    </div>
  );
}
