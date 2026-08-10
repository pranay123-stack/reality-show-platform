'use client';

import { Card, cn } from '@reality/ui';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { CountUp } from '@/components/system/premium';
import { cardHover, fadeUp } from '@/lib/motion';

/**
 * A feature as an entertainment widget.
 *
 * The previous card led with a title and a two-line description, then showed
 * the interesting part underneath. That is the shape of a documentation entry.
 * A viewer glancing at a second screen wants, in order: is this live, how many
 * people are in, what am I being asked, and how do I answer.
 *
 * So the structure is fixed and the description is gone. What replaced it is a
 * *question* — the thing the feature actually asks you — which does the same
 * explanatory work in six words instead of twenty.
 */

export type CardTheme = 'pink' | 'cyan' | 'purple' | 'gold';
export type LiveStatus = 'live' | 'closing' | 'open' | 'idle';

/**
 * One place where a theme becomes colour.
 *
 * Written out rather than interpolated (`text-neon-${theme}`) because Tailwind
 * scans source text for class names and would find nothing to generate.
 */
const THEME = {
  pink: {
    text: 'text-neon-pink',
    border: 'group-hover:border-neon-pink/45',
    glow: 'group-hover:shadow-[0_18px_55px_-20px_hsl(var(--neon-pink)/0.6)]',
    halo: 'bg-neon-pink/20',
    rule: 'from-neon-pink/70',
  },
  cyan: {
    text: 'text-neon-cyan',
    border: 'group-hover:border-neon-cyan/45',
    glow: 'group-hover:shadow-[0_18px_55px_-20px_hsl(var(--neon-cyan)/0.6)]',
    halo: 'bg-neon-cyan/20',
    rule: 'from-neon-cyan/70',
  },
  purple: {
    text: 'text-neon-purple',
    border: 'group-hover:border-neon-purple/45',
    glow: 'group-hover:shadow-[0_18px_55px_-20px_hsl(var(--neon-purple)/0.6)]',
    halo: 'bg-neon-purple/20',
    rule: 'from-neon-purple/70',
  },
  gold: {
    text: 'text-neon-gold',
    border: 'group-hover:border-neon-gold/45',
    glow: 'group-hover:shadow-[0_18px_55px_-20px_hsl(var(--neon-gold)/0.6)]',
    halo: 'bg-neon-gold/20',
    rule: 'from-neon-gold/70',
  },
} as const;

const STATUS = {
  live: { label: 'Live', chip: 'border-live/50 bg-live/12 text-live', dot: 'bg-live', pulse: true },
  closing: {
    label: 'Closing',
    chip: 'border-warning/45 bg-warning/12 text-warning',
    dot: 'bg-warning',
    pulse: true,
  },
  open: {
    label: 'Open',
    chip: 'border-success/45 bg-success/12 text-success',
    dot: 'bg-success',
    pulse: false,
  },
  idle: {
    label: 'Weekends',
    chip: 'border-border bg-white/[0.04] text-muted',
    dot: 'bg-muted',
    pulse: false,
  },
} as const;

export interface EntertainmentCardProps {
  icon: ReactNode;
  /** The feature's name, as the audience would say it. */
  title: string;
  /** What this feature asks you. Six words, not a sentence about it. */
  question: string;
  theme: CardTheme;
  status: LiveStatus;
  statusLabel?: string;
  /** The number this card leads with, set large. */
  metric: { value: number; label: string };
  /** The live shape underneath: a vote split, a heat list, a budget meter. */
  preview?: ReactNode;
  cta: { label: string; href: string };
  className?: string;
}

export function EntertainmentCard({
  icon,
  title,
  question,
  theme: themeKey,
  status: statusKey,
  statusLabel,
  metric,
  preview,
  cta,
  className,
}: EntertainmentCardProps) {
  const theme = THEME[themeKey];
  const status = STATUS[statusKey];
  const reduced = useReducedMotion();

  return (
    <motion.div
      variants={fadeUp}
      whileHover={reduced ? undefined : cardHover}
      className={cn('group h-full', className)}
    >
      <Card className={cn('relative flex h-full flex-col overflow-hidden p-5', theme.border, theme.glow)}>
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl',
            'opacity-0 transition-opacity duration-500 group-hover:opacity-100',
            theme.halo,
          )}
        />
        <div
          aria-hidden
          className={cn('absolute inset-x-0 top-0 h-px bg-gradient-to-r to-transparent', theme.rule)}
        />

        <div className="relative flex flex-1 flex-col gap-4">
          {/* Top: what it is, and whether it is happening. */}
          <div className="flex items-start justify-between gap-3">
            <span
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]',
                theme.text,
              )}
            >
              {icon}
            </span>

            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]',
                status.chip,
              )}
            >
              <span className="relative flex h-1.5 w-1.5">
                {status.pulse && (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inline-flex h-full w-full animate-ping rounded-full opacity-70',
                      status.dot,
                    )}
                  />
                )}
                <span aria-hidden className={cn('relative h-1.5 w-1.5 rounded-full', status.dot)} />
              </span>
              {statusLabel ?? status.label}
            </span>
          </div>

          {/* Middle: the number, set large enough to be the thing you see. */}
          <div>
            <p className="flex items-baseline gap-2">
              <CountUp
                value={metric.value}
                className={cn('text-3xl font-semibold leading-none', theme.text)}
              />
              <span className="text-xs text-muted">{metric.label}</span>
            </p>
          </div>

          {/* The question this feature asks. */}
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
              {title}
            </p>
            <p className="text-lg font-semibold leading-tight text-balance">{question}</p>
          </div>

          {/* `min-w-0` so a meter or a name never widens the grid column. */}
          {preview && <div className="min-w-0 flex-1">{preview}</div>}

          <Link
            href={cta.href}
            className={cn(
              'mt-auto inline-flex min-h-6 items-center gap-1.5 text-sm font-semibold transition-colors',
              theme.text,
            )}
          >
            {cta.label}
            <ArrowRight
              className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
              aria-hidden
            />
          </Link>
        </div>
      </Card>
    </motion.div>
  );
}

/** A labelled row with a share bar — the shape most previews need. */
export function ShareRow({
  label,
  percent,
  tone,
  meta,
  avatar,
}: {
  label: string;
  percent: number;
  tone: CardTheme;
  meta?: string;
  avatar?: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5">
          {avatar}
          <span className="truncate text-foreground">{label}</span>
        </span>
        <span className="shrink-0 tabular-nums text-muted">{meta ?? `${percent}%`}</span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
        <motion.div
          className={cn(
            'h-full rounded-full',
            { pink: 'bg-neon-pink', cyan: 'bg-neon-cyan', purple: 'bg-neon-purple', gold: 'bg-neon-gold' }[
              tone
            ],
          )}
          initial={{ width: 0 }}
          whileInView={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}
