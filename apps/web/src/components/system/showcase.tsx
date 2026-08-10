'use client';

import { cn } from '@reality/ui';
import type { ReactNode } from 'react';

/**
 * The two effects every interactive card on the marketing surface shares.
 *
 * Both are pure CSS on the compositor and both are children of the card rather
 * than properties of it, so a card opts in by rendering them. That keeps the
 * effects off the application shell, where a light sweeping across a data table
 * would be an irritation rather than a flourish.
 */

/**
 * A light crossing the card, once, on hover.
 *
 * `overflow-hidden` on the card clips it; the parent must be `group` and
 * `relative`. It runs on hover only — a sweep on a timer is a casino, not a
 * broadcast.
 */
export function LightSweep({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 opacity-0',
        'bg-gradient-to-r from-transparent via-white/[0.07] to-transparent',
        'group-hover:animate-sweep group-hover:opacity-100',
        // No sweep for a reader who asked for less motion; the card still lifts.
        'motion-reduce:hidden',
        className,
      )}
    />
  );
}

/**
 * A hairline border that lights up from the top edge outward on hover.
 *
 * Drawn as a masked gradient ring rather than a `border-image`, because a
 * gradient border on a rounded element needs a mask either way and this version
 * animates opacity only — one compositor property, no repaint.
 */
export function GlowBorder({ tint, className }: { tint: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 rounded-lg opacity-0 transition-opacity duration-500',
        'group-hover:opacity-100',
        className,
      )}
      style={{
        padding: '1px',
        background: `linear-gradient(140deg, ${tint}, transparent 45%, transparent 60%, ${tint})`,
        // The mask leaves only the 1px padding ring painted.
        WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
        WebkitMaskComposite: 'xor',
        maskComposite: 'exclude',
      }}
    />
  );
}

/**
 * Three bars rising out of step — the universal "signal is live" glyph.
 *
 * Decorative: the surrounding badge already says "live" in words, so this is
 * `aria-hidden` and adds nothing to the accessibility tree.
 */
export function SignalBars({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('flex h-3 items-end gap-[2px]', className)}>
      {[0, 0.25, 0.5].map((delay) => (
        <span
          key={delay}
          className="w-[2px] origin-bottom rounded-full bg-current animate-signal"
          style={{ height: '100%', animationDelay: `${delay}s` }}
        />
      ))}
    </span>
  );
}

/** Wraps a card so it drifts almost imperceptibly, out of step with its row. */
export function Floating({
  children,
  index = 0,
  className,
}: {
  children: ReactNode;
  index?: number;
  className?: string;
}) {
  return (
    <div
      className={cn('h-full animate-float motion-reduce:animate-none', className)}
      // Offsetting by index stops a row of four bobbing in unison, which reads
      // as a broken layout rather than as life.
      style={{ animationDelay: `${(index % 4) * -1.5}s` }}
    >
      {children}
    </div>
  );
}
