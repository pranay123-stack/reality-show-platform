'use client';

import { Avatar, Button, Card, Countdown, cn } from '@reality/ui';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';

import { CountUp } from '@/components/system/premium';
import { arenaEvents, type ArenaEvent } from '@/lib/mock-arena';
import { cardHover, fadeUp, stagger, viewportOnce } from '@/lib/motion';

/**
 * Tonight's Arena.
 *
 * The page used to open with an explanation and then argue its case for four
 * sections before showing anything happening. This is the answer to the
 * question a visitor actually arrives with — *what is going on right now* —
 * and it sits immediately under the hero for that reason.
 *
 * Four things are open at once on a show night, and they are open in different
 * senses: a poll closes in two minutes, a weekend question closes on Friday.
 * The state drives the badge, the accent and how loudly the clock reads, so the
 * difference is visible before anything is read.
 */

const STATE = {
  live: {
    label: 'Live',
    chip: 'border-live/50 bg-live/12 text-live',
    ring: 'hover:border-live/40',
    dot: 'bg-live',
    pulse: true,
  },
  closing: {
    label: 'Closing',
    chip: 'border-warning/45 bg-warning/12 text-warning',
    ring: 'hover:border-warning/40',
    dot: 'bg-warning',
    pulse: true,
  },
  open: {
    label: 'Open',
    chip: 'border-success/45 bg-success/12 text-success',
    ring: 'hover:border-success/35',
    dot: 'bg-success',
    pulse: false,
  },
  upcoming: {
    label: 'Soon',
    chip: 'border-border bg-white/[0.04] text-muted',
    ring: 'hover:border-white/20',
    dot: 'bg-muted',
    pulse: false,
  },
} as const;

const ACCENT = {
  pink: 'from-neon-pink/70',
  cyan: 'from-neon-cyan/70',
  purple: 'from-neon-purple/70',
  gold: 'from-neon-gold/70',
} as const;

export function LiveArena() {
  return (
    <section id="arena" className="relative border-t border-white/5 py-20">
      {/* The arena is lit from below, so it reads as a floor rather than a page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,hsl(var(--neon-purple)/0.12),transparent_70%)]"
      />

      <div className="container relative space-y-10">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          className="flex flex-wrap items-end justify-between gap-4"
        >
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neon-purple">
              Tonight’s arena
            </p>
            <h2 className="text-display-md font-semibold">Four ways to change the night</h2>
            <p className="max-w-2xl text-muted">
              Everything here is open while the episode airs. Counts and clocks come from the
              server — your browser never decides a result.
            </p>
          </div>

          <Button asChild variant="secondary">
            <Link href="/dashboard">
              Open the arena
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </motion.div>

        <motion.ul
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          {arenaEvents.map((event) => (
            <li key={event.key}>
              <ArenaCard event={event} />
            </li>
          ))}
        </motion.ul>

        <p className="text-center text-xs text-muted">
          Illustrative arena using fictional placeholder data.
        </p>
      </div>
    </section>
  );
}

function ArenaCard({ event }: { event: ArenaEvent }) {
  const state = STATE[event.state];
  const reduced = useReducedMotion();

  // Anchored to mount, so the clock is always ahead of the reader rather than
  // stuck at a timestamp baked in at build time.
  const closesAt = useMemo(
    () => new Date(Date.now() + event.closesInSeconds * 1000).toISOString(),
    [event.closesInSeconds],
  );

  return (
    <motion.div variants={fadeUp} whileHover={reduced ? undefined : cardHover} className="h-full">
      <Card className={cn('relative flex h-full flex-col overflow-hidden p-5', state.ring)}>
        <div
          aria-hidden
          className={cn('absolute inset-x-0 top-0 h-px bg-gradient-to-r to-transparent', ACCENT[event.theme])}
        />

        <div className="flex items-start justify-between gap-3">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]',
              state.chip,
            )}
          >
            <span className="relative flex h-1.5 w-1.5">
              {state.pulse && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute inline-flex h-full w-full animate-ping rounded-full opacity-70',
                    state.dot,
                  )}
                />
              )}
              <span aria-hidden className={cn('relative h-1.5 w-1.5 rounded-full', state.dot)} />
            </span>
            {state.label}
          </span>

          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
            <Users className="h-3.5 w-3.5" aria-hidden />
            <CountUp value={event.participants} className="font-semibold text-foreground" />
          </span>
        </div>

        <div className="mt-4 space-y-1.5">
          <h3 className="text-base font-semibold leading-tight">{event.title}</h3>
          <p className="text-sm leading-relaxed text-muted">{event.subtitle}</p>
        </div>

        <p className="mt-3 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-muted">
          {event.standing}
        </p>

        <div className="mt-auto space-y-3 pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted">
              {event.state === 'live' ? 'Voting closes' : 'Closes'}
            </span>
            <Countdown to={closesAt} finishedLabel="Closed" />
          </div>

          <Button asChild size="sm" variant="secondary" fullWidth>
            <Link href={event.cta.href}>
              {event.cta.label}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}

/** Stacked contestant avatars — "these people are in it". */
export function AvatarStack({ names, className }: { names: string[]; className?: string }) {
  return (
    <span className={cn('flex -space-x-2', className)}>
      {names.map((name) => (
        <Avatar
          key={name}
          name={name}
          size="sm"
          className="ring-2 ring-[hsl(var(--surface))]"
        />
      ))}
    </span>
  );
}
