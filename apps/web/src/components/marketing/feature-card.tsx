'use client';

import { Card, cn } from '@reality/ui';
import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { CountUp } from '@/components/system/premium';
import { cardHover, fadeUp } from '@/lib/motion';

/**
 * A feature rendered as a game module.
 *
 * The eight features were eight identical boxes with a coloured tick above the
 * title. They describe genuinely different activities — a prediction is a
 * competition with a clock, a heat meter is a ranking that moves, a poll is a
 * bar filling while you watch — and reading as one undifferentiated grid was
 * the main thing making the page feel flat.
 *
 * So the shape is shared and the content is not. The card supplies the frame,
 * the live state and one headline number; each feature supplies its own preview
 * through `previewData`, and the theme decides only the light it casts.
 */

export type ColorTheme = 'pink' | 'cyan' | 'purple' | 'gold';

/** What the feature is doing right now, which is a different axis from theme. */
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
    border: 'group-hover:border-neon-pink/40',
    glow: 'group-hover:shadow-[0_18px_50px_-20px_hsl(var(--neon-pink)/0.55)]',
    halo: 'bg-neon-pink/20',
    rule: 'from-neon-pink/70',
  },
  cyan: {
    text: 'text-neon-cyan',
    border: 'group-hover:border-neon-cyan/40',
    glow: 'group-hover:shadow-[0_18px_50px_-20px_hsl(var(--neon-cyan)/0.55)]',
    halo: 'bg-neon-cyan/20',
    rule: 'from-neon-cyan/70',
  },
  purple: {
    text: 'text-neon-purple',
    border: 'group-hover:border-neon-purple/40',
    glow: 'group-hover:shadow-[0_18px_50px_-20px_hsl(var(--neon-purple)/0.55)]',
    halo: 'bg-neon-purple/20',
    rule: 'from-neon-purple/70',
  },
  gold: {
    text: 'text-neon-gold',
    border: 'group-hover:border-neon-gold/40',
    glow: 'group-hover:shadow-[0_18px_50px_-20px_hsl(var(--neon-gold)/0.55)]',
    halo: 'bg-neon-gold/20',
    rule: 'from-neon-gold/70',
  },
} as const;

const STATUS = {
  live: { label: 'Live now', chip: 'border-live/50 bg-live/12 text-live', dot: 'bg-live', pulse: true },
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

export interface InteractiveFeatureCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  /** The colour this card casts. Independent of what it is doing. */
  theme: ColorTheme;
  liveStatus: LiveStatus;
  /** Overrides the status label where the feature has a better word for it. */
  statusLabel?: string;
  /** The one number this feature leads with. */
  metric?: { value: number; label: string };
  /** The feature's own preview: a vote split, a heat list, a budget meter. */
  previewData?: ReactNode;
  cta?: { label: string; href: string };
  className?: string;
}

export function InteractiveFeatureCard({
  icon,
  title,
  description,
  theme: themeKey,
  liveStatus,
  statusLabel,
  metric,
  previewData,
  cta,
  className,
}: InteractiveFeatureCardProps) {
  const theme = THEME[themeKey];
  const status = STATUS[liveStatus];
  const reduced = useReducedMotion();

  return (
    <motion.div
      variants={fadeUp}
      whileHover={reduced ? undefined : cardHover}
      className={cn('group h-full', className)}
    >
      <Card className={cn('relative flex h-full flex-col overflow-hidden p-5', theme.border, theme.glow)}>
        {/* The light this card casts, brightening as the reader approaches it. */}
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
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]',
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

          <div className="space-y-1.5">
            <h3 className="text-base font-semibold leading-tight">{title}</h3>
            <p className="text-sm leading-relaxed text-muted">{description}</p>
          </div>

          {metric && (
            <p className="flex items-baseline gap-1.5">
              <CountUp value={metric.value} className={cn('text-2xl font-semibold', theme.text)} />
              <span className="text-xs text-muted">{metric.label}</span>
            </p>
          )}

          {/* `min-w-0` so a meter or a name never widens the grid column. */}
          {previewData && <div className="min-w-0 flex-1">{previewData}</div>}

          {cta && (
            <Link
              href={cta.href}
              className={cn(
                'mt-auto inline-flex min-h-6 items-center gap-1.5 text-sm font-medium transition-colors',
                theme.text,
              )}
            >
              {cta.label}
              <ArrowRight
                className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

/** A labelled row with a share bar — the shape most of the previews need. */
export function ShareRow({
  label,
  percent,
  tone,
  meta,
  avatar,
}: {
  label: string;
  percent: number;
  tone: ColorTheme;
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
      <MeterInline percent={percent} tone={tone} />
    </div>
  );
}

function MeterInline({ percent, tone }: { percent: number; tone: ColorTheme }) {
  const fill = {
    pink: 'bg-neon-pink',
    cyan: 'bg-neon-cyan',
    purple: 'bg-neon-purple',
    gold: 'bg-neon-gold',
  }[tone];

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
      <motion.div
        className={cn('h-full rounded-full', fill)}
        initial={{ width: 0 }}
        whileInView={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}
