'use client';

import { Avatar, Card, cn } from '@reality/ui';
import { motion, useReducedMotion } from 'framer-motion';
import { Flame, TrendingDown, TrendingUp } from 'lucide-react';

import { CountUp } from '@/components/system/premium';
import { SectionHeading } from '@/components/marketing/section-heading';
import { houseSpotlight, type SpotlightContestant } from '@/lib/mock-arena';
import { cardHover, fadeUp, stagger, viewportOnce } from '@/lib/motion';

/**
 * House Trending Now.
 *
 * The old contestant section listed four people with a heat number each, which
 * told a visitor what the metric was and nothing about why anyone would care.
 * A reality audience follows *storylines*, so each card now leads with what the
 * person is currently in the middle of, and the heat number is the evidence
 * rather than the headline.
 *
 * Sentiment is shown as a split bar rather than a single figure: "62%
 * favourable" invites the reading that 38% is missing, when it is in fact the
 * other half of a disagreement — which is the interesting part.
 */
export function HouseSpotlight() {
  return (
    <section id="contestants" className="relative border-t border-white/5 py-14 sm:py-20 lg:py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,hsl(var(--neon-gold)/0.09),transparent_70%)]"
      />

      <div className="container relative space-y-10">
        <SectionHeading
          eyebrow="House heat"
          title="The house is moving"
          kicker={
            <>
              Heat moves because the audience moved.
              <br />
              Measured, never edited.
            </>
          }
          tone="gold"
        />

        <motion.ul
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          {houseSpotlight.map((contestant, index) => (
            <li key={contestant.id}>
              <SpotlightCard contestant={contestant} rank={index + 1} />
            </li>
          ))}
        </motion.ul>

        <p className="text-center text-xs text-muted">
          Contestants shown are fictional placeholders created for development.
        </p>
      </div>
    </section>
  );
}

function SpotlightCard({ contestant, rank }: { contestant: SpotlightContestant; rank: number }) {
  const reduced = useReducedMotion();
  const rising = contestant.trend === 'UP';
  const falling = contestant.trend === 'DOWN';

  return (
    <motion.div variants={fadeUp} whileHover={reduced ? undefined : cardHover} className="h-full">
      <Card className="relative flex h-full flex-col overflow-hidden p-5 hover:border-neon-gold/30">
        {/* The heat itself, bleeding through the top of the card. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full blur-3xl"
          style={{ background: `hsl(var(--neon-gold) / ${0.05 + (contestant.heatScore / 100) * 0.16})` }}
        />

        <div className="relative flex items-start gap-3">
          <Avatar name={contestant.name} size="lg" />

          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate font-semibold leading-tight">{contestant.name}</p>
            <p className="truncate text-xs text-muted">{contestant.occupation}</p>
          </div>

          <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted">
            #{rank}
          </span>
        </div>

        {contestant.badge && (
          <p className="relative mt-3 inline-flex w-fit rounded-full border border-neon-gold/30 bg-neon-gold/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-neon-gold">
            {contestant.badge}
          </p>
        )}

        <p className="relative mt-3 flex-1 text-sm leading-relaxed text-muted">
          {contestant.storyline}
        </p>

        <div className="relative mt-4 space-y-3">
          <div className="flex items-end justify-between gap-2">
            <span className="flex items-baseline gap-1.5 text-2xl font-semibold text-neon-gold">
              <Flame className="h-5 w-5 self-center" aria-hidden />
              <CountUp value={contestant.heatScore} />
            </span>

            <span
              className={cn(
                'flex items-center gap-1 text-xs font-semibold tabular-nums',
                rising ? 'text-success' : falling ? 'text-danger' : 'text-muted',
              )}
            >
              {rising ? (
                <TrendingUp className="h-3.5 w-3.5" aria-hidden />
              ) : falling ? (
                <TrendingDown className="h-3.5 w-3.5" aria-hidden />
              ) : null}
              {contestant.heatDelta > 0 ? '+' : ''}
              {contestant.heatDelta} today
            </span>
          </div>

          {/* Two sides of one opinion, not a score out of a hundred. */}
          <div className="space-y-1.5">
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
              <motion.div
                className="h-full bg-neon-cyan"
                initial={{ width: 0 }}
                whileInView={{ width: `${contestant.sentiment}%` }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              />
              <div className="h-full flex-1 bg-neon-pink/50" />
            </div>
            <p className="flex justify-between text-xs text-muted">
              <span>{contestant.sentiment}% on side</span>
              <span>{100 - contestant.sentiment}% against</span>
            </p>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
