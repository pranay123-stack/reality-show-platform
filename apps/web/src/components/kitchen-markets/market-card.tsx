'use client';

import type { KitchenMarket } from '@reality/shared';
import { KITCHEN_CATEGORY_LABELS, KITCHEN_SLOT_LABELS } from '@reality/shared';
import { Avatar, Button, Card, Countdown, cn } from '@reality/ui';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, Trophy, Users } from 'lucide-react';
import Link from 'next/link';

import { CountUp } from '@/components/system/premium';
import { GlowBorder, LightSweep, SignalBars } from '@/components/system/showcase';
import { cardHover, fadeUp } from '@/lib/motion';

/**
 * One market, as a card.
 *
 * A prediction market is a shape, not a list: the question, who is in it, where
 * the crowd currently sits, how long is left, and one way in. The share bars
 * are the part that makes it read as a market rather than a poll — they move,
 * they disagree with each other, and they tell you whether you would be with
 * the crowd or against it before you commit.
 */

const CATEGORY_THEME = {
  COOKING: { text: 'text-neon-cyan', bar: 'bg-neon-cyan', tint: 'hsl(var(--neon-cyan) / 0.55)', rule: 'from-neon-cyan/70' },
  CONTESTANT_BATTLE: { text: 'text-neon-pink', bar: 'bg-neon-pink', tint: 'hsl(var(--neon-pink) / 0.55)', rule: 'from-neon-pink/70' },
  FOOD_CHOICE: { text: 'text-neon-gold', bar: 'bg-neon-gold', tint: 'hsl(var(--neon-gold) / 0.55)', rule: 'from-neon-gold/70' },
  HOUSE_DECISION: { text: 'text-neon-purple', bar: 'bg-neon-purple', tint: 'hsl(var(--neon-purple) / 0.55)', rule: 'from-neon-purple/70' },
  DRAMA: { text: 'text-danger', bar: 'bg-danger', tint: 'hsl(var(--danger) / 0.55)', rule: 'from-danger/70' },
} as const;

export function MarketCard({ market }: { market: KitchenMarket }) {
  const theme = CATEGORY_THEME[market.category];
  const reduced = useReducedMotion();
  const live = market.status === 'OPEN';
  const resolved = market.status === 'RESOLVED';

  // The crowd's current favourite, so the card can say what is being predicted
  // rather than only offering the choice.
  const leader = [...market.options].sort((a, b) => b.predictions - a.predictions)[0];

  return (
    <motion.div
      variants={fadeUp}
      whileHover={reduced ? undefined : cardHover}
      className="group h-full"
    >
      <Card className="relative flex h-full flex-col overflow-hidden p-5">
        <div
          aria-hidden
          className={cn('absolute inset-x-0 top-0 h-px bg-gradient-to-r to-transparent', theme.rule)}
        />
        <GlowBorder tint={theme.tint} />
        <LightSweep />

        <div className="relative flex flex-1 flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <span className={cn('label-broadcast', theme.text)}>
              {KITCHEN_CATEGORY_LABELS[market.category]}
            </span>
            <StatusChip status={market.status} />
          </div>

          <Link href={`/kitchen/markets/${market.id}`} className="group/q">
            <h3 className="text-lg font-semibold leading-tight text-balance group-hover/q:underline">
              {market.question}
            </h3>
          </Link>

          {/* Where the crowd sits. Top three, so a six-option menu stays a card. */}
          <ul className="space-y-2.5">
            {market.options.slice(0, 3).map((option) => {
              const isMine = market.myOptionId === option.id;
              const won = resolved && market.winningOptionId === option.id;

              return (
                <li key={option.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {option.contestantId && (
                        <Avatar name={option.label} size="sm" className="h-5 w-5 text-[9px]" />
                      )}
                      <span className={cn('truncate', won ? 'font-semibold text-success' : 'text-foreground')}>
                        {option.label}
                      </span>
                      {isMine && (
                        <span className={cn('shrink-0 text-[10px] font-semibold', theme.text)}>
                          · your pick
                        </span>
                      )}
                      {won && <Trophy className="h-3 w-3 shrink-0 text-success" aria-hidden />}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted">{option.share}%</span>
                  </div>

                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                    <motion.div
                      className={cn('h-full rounded-full', won ? 'bg-success' : theme.bar)}
                      initial={{ width: 0 }}
                      whileInView={{ width: `${Math.max(2, option.share)}%` }}
                      viewport={{ once: true, amount: 0.5 }}
                      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                </li>
              );
            })}
            {market.options.length > 3 && (
              <li className="text-[11px] text-muted">
                +{market.options.length - 3} more · {leader?.label} leading
              </li>
            )}
          </ul>

          <div className="mt-auto space-y-3 pt-1">
            <div className="flex items-center justify-between gap-2 text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" aria-hidden />
                <CountUp value={market.totalPredictions} className="font-semibold text-foreground" />
                playing
              </span>

              {live ? (
                <Countdown to={market.endTime} finishedLabel="Closed" />
              ) : (
                <span>{KITCHEN_SLOT_LABELS[market.slot]}</span>
              )}
            </div>

            <Button asChild size="sm" variant={market.myOptionId ? 'secondary' : 'primary'} fullWidth>
              <Link href={`/kitchen/markets/${market.id}`}>
                {market.myOptionId ? (
                  <>
                    <Check className="h-4 w-4" aria-hidden />
                    Prediction in
                  </>
                ) : resolved ? (
                  <>
                    See the result
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </>
                ) : (
                  <>
                    Make prediction
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </>
                )}
              </Link>
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

export function StatusChip({ status }: { status: KitchenMarket['status'] }) {
  if (status === 'OPEN') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-live/50 bg-live/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-live">
        <SignalBars />
        Live
      </span>
    );
  }

  const map = {
    LOCKED: { label: 'Locked', className: 'border-warning/45 bg-warning/12 text-warning' },
    RESOLVED: { label: 'Settled', className: 'border-success/45 bg-success/12 text-success' },
    VOID: { label: 'Void', className: 'border-border bg-white/[0.04] text-muted' },
  } as const;
  const chip = map[status];

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]',
        chip.className,
      )}
    >
      {chip.label}
    </span>
  );
}

export { CATEGORY_THEME };
