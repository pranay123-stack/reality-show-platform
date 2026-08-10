'use client';

import { Countdown, cn } from '@reality/ui';
import { motion } from 'framer-motion';
import {
  ChefHat,
  Flame,
  Gavel,
  MessageSquareQuote,
  Radio,
  Sparkles,
  Target,
  Trophy,
} from 'lucide-react';
import { useMemo } from 'react';

import { FeatureCard, ShareRow } from '@/components/marketing/feature-card';
import { CountUp, Meter } from '@/components/system/premium';
import {
  challengeDemo,
  heatDemo,
  kitchenDemo,
  livePollDemo,
  nominationDemo,
  perspectiveDemo,
  predictionDemo,
  weekendDemo,
} from '@/lib/mock-features';
import { stagger, viewportOnce } from '@/lib/motion';

/**
 * The eight features, each showing what it actually looks like in use.
 *
 * Every card carries its own small visual because the features are not
 * variations on one thing: a prediction is a competition with a clock, a heat
 * meter is a ranking that moves, a poll is a bar that fills while you watch.
 * Eight identical boxes described all of that in prose and showed none of it.
 *
 * The data is fictional and labelled as such at the foot of the section.
 */
export function FeatureGrid() {
  // A fixed offset from mount, so the demo clocks tick without pinning a date
  // that would be in the past by the time anyone reads this.
  const predictionCloses = useMemo(
    () => new Date(Date.now() + predictionDemo.closesInSeconds * 1000).toISOString(),
    [],
  );
  const nominationCloses = useMemo(
    () => new Date(Date.now() + nominationDemo.closesInSeconds * 1000).toISOString(),
    [],
  );

  return (
    <motion.ul
      variants={stagger}
      initial="hidden"
      whileInView="visible"
      viewport={viewportOnce}
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {/* --- Prediction Game ------------------------------------------------ */}
      <li>
        <FeatureCard
          icon={<Target className="h-5 w-5" aria-hidden />}
          title="Prediction Game"
          description="Predict what happens next. One prediction per question, locked the moment it closes."
          colorTheme="pink"
          status="Open"
          cta={{ label: 'Play now', href: '/predictions' }}
        >
          <div className="space-y-3">
            <p className="text-xs font-medium text-foreground">{predictionDemo.question}</p>
            <div className="space-y-2.5">
              {predictionDemo.options.map((option) => (
                <ShareRow
                  key={option.name}
                  label={option.name}
                  percent={option.percent}
                  tone="pink"
                />
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
              <span className="flex items-center gap-1.5">
                <CountUp value={predictionDemo.playing} className="font-semibold text-foreground" />
                playing
              </span>
              <Countdown to={predictionCloses} finishedLabel="Closed" />
            </div>
          </div>
        </FeatureCard>
      </li>

      {/* --- Audience Challenges ------------------------------------------- */}
      <li>
        <FeatureCard
          icon={<Sparkles className="h-5 w-5" aria-hidden />}
          title="Audience Challenges"
          description="Create tasks for the house. The community votes, moderators check, producers choose."
          colorTheme="purple"
          status="Voting"
          cta={{ label: 'Submit challenge', href: '/challenges/new' }}
        >
          <div className="space-y-3">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted">Top challenge</p>
              <p className="mt-1 text-sm font-medium">“{challengeDemo.top}”</p>
              <p className="mt-1 text-[11px] text-muted">
                <CountUp value={challengeDemo.votes} className="text-foreground" /> community votes
              </p>
            </div>
            <p className="text-[11px] text-muted">
              <CountUp value={challengeDemo.submissions} className="font-semibold text-foreground" />{' '}
              submissions this season
            </p>
          </div>
        </FeatureCard>
      </li>

      {/* --- Contestant Heat Meter ------------------------------------------ */}
      <li>
        <FeatureCard
          icon={<Flame className="h-5 w-5" aria-hidden />}
          title="Contestant Heat Meter"
          description="A live popularity score built from votes, reactions and momentum — recomputed on the server."
          colorTheme="gold"
          status="Live"
          cta={{ label: 'See the meter', href: '/contestants' }}
        >
          <ul className="space-y-2.5">
            {heatDemo.map((contestant) => (
              <li key={contestant.name} className="flex items-center gap-2.5">
                <span className="min-w-0 flex-1 truncate text-xs">{contestant.name}</span>
                <span className="flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums text-neon-gold">
                  <Flame className="h-3.5 w-3.5" aria-hidden />
                  <CountUp value={contestant.score} />
                </span>
                <TrendArrow trend={contestant.trend} />
              </li>
            ))}
          </ul>
        </FeatureCard>
      </li>

      {/* --- Audience Perspective ------------------------------------------- */}
      <li>
        <FeatureCard
          icon={<MessageSquareQuote className="h-5 w-5" aria-hidden />}
          title="Audience Perspective"
          description="After an argument, say who was right. Opinion about what already happened, kept apart from live polls."
          colorTheme="cyan"
          status="Open"
          cta={{ label: 'Take a side', href: '/perspectives' }}
        >
          <div className="space-y-3">
            <p className="text-xs font-medium text-foreground">{perspectiveDemo.question}</p>

            {/* One bar, two sides — the shape of the disagreement itself. */}
            <div className="space-y-1.5">
              <div className="flex h-8 w-full overflow-hidden rounded-lg border border-white/10">
                <motion.div
                  className="flex items-center justify-start bg-neon-cyan/25 pl-2 text-[11px] font-semibold text-neon-cyan"
                  initial={{ width: '50%' }}
                  whileInView={{ width: `${perspectiveDemo.left.percent}%` }}
                  viewport={{ once: true, amount: 0.5 }}
                  transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                >
                  {perspectiveDemo.left.percent}%
                </motion.div>
                <div className="flex flex-1 items-center justify-end bg-neon-purple/25 pr-2 text-[11px] font-semibold text-neon-purple">
                  {perspectiveDemo.right.percent}%
                </div>
              </div>
              <div className="flex justify-between gap-2 text-[11px] text-muted">
                <span className="min-w-0 truncate">{perspectiveDemo.left.name}</span>
                <span className="min-w-0 truncate">{perspectiveDemo.right.name}</span>
              </div>
            </div>

            <p className="text-[11px] text-muted">
              <CountUp value={perspectiveDemo.voices} className="font-semibold text-foreground" />{' '}
              voices counted
            </p>
          </div>
        </FeatureCard>
      </li>

      {/* --- Live Polls ------------------------------------------------------ */}
      <li>
        <FeatureCard
          icon={<Radio className="h-5 w-5" aria-hidden />}
          title="Real-time Live Polls"
          description="Vote during the broadcast and watch the bars move. Counts come from the server, never the browser."
          colorTheme="pink"
          status={
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-1.5 w-1.5 animate-pulse-live rounded-full bg-live" />
              Live now
            </span>
          }
          cta={{ label: 'Vote live', href: '/polls' }}
        >
          <div className="space-y-3">
            <p className="text-xs font-medium text-foreground">{livePollDemo.question}</p>
            <div className="space-y-2.5">
              {livePollDemo.options.map((option) => (
                <ShareRow
                  key={option.label}
                  label={option.label}
                  percent={option.percent}
                  tone="pink"
                />
              ))}
            </div>
            <p className="text-[11px] text-muted">
              <CountUp
                value={livePollDemo.votesPerMinute}
                className="font-semibold text-foreground"
              />{' '}
              votes a minute
            </p>
          </div>
        </FeatureCard>
      </li>

      {/* --- Nomination & Eviction ------------------------------------------- */}
      <li>
        <FeatureCard
          icon={<Gavel className="h-5 w-5" aria-hidden />}
          title="Nomination & Eviction"
          description="Take part in every round with a clear vote limit — and a clear line between the audience result and the show’s official outcome."
          colorTheme="pink"
          status="Closing"
          cta={{ label: 'Cast your votes', href: '/nominations' }}
        >
          <div className="space-y-3">
            <ul className="space-y-2.5">
              {nominationDemo.nominees.map((nominee) => (
                <li key={nominee.name}>
                  <ShareRow
                    label={nominee.name}
                    percent={nominee.support}
                    tone="pink"
                    meta={`${nominee.support}% support`}
                  />
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2 rounded-lg border border-danger/25 bg-danger/[0.07] px-2.5 py-1.5 text-[11px] text-danger">
              <span className="font-medium">Voting closes</span>
              <Countdown to={nominationCloses} finishedLabel="Closed" />
            </div>
          </div>
        </FeatureCard>
      </li>

      {/* --- Kitchen Control -------------------------------------------------- */}
      <li>
        <FeatureCard
          icon={<ChefHat className="h-5 w-5" aria-hidden />}
          title="Kitchen Control"
          description="Decide what the house eats within a fixed budget. The final basket is calculated on the server."
          colorTheme="cyan"
          status="Open"
          cta={{ label: 'Pick the menu', href: '/kitchen' }}
        >
          <div className="space-y-3">
            <ul className="flex flex-wrap gap-1.5">
              {kitchenDemo.basket.map((item) => (
                <li
                  key={item.label}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px]',
                    item.chosen
                      ? 'border-neon-cyan/35 bg-neon-cyan/10 text-neon-cyan'
                      : 'border-white/10 bg-white/[0.03] text-muted line-through',
                  )}
                >
                  {item.label}
                </li>
              ))}
            </ul>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="text-muted">Budget used</span>
                <span className="tabular-nums text-foreground">
                  <CountUp value={kitchenDemo.budgetSpent} /> / {kitchenDemo.budgetTotal.toLocaleString()}
                </span>
              </div>
              <Meter
                percent={(kitchenDemo.budgetSpent / kitchenDemo.budgetTotal) * 100}
                tone="cyan"
              />
            </div>
          </div>
        </FeatureCard>
      </li>

      {/* --- Weekend Participation --------------------------------------------- */}
      <li>
        <FeatureCard
          icon={<Trophy className="h-5 w-5" aria-hidden />}
          title="Weekend Participation"
          description="Send a question for the weekend episode. Moderated, shortlisted, then chosen by production."
          colorTheme="gold"
          status="Weekends"
          cta={{ label: 'Send a question', href: '/weekend' }}
        >
          {/* The funnel, narrowing — which is the whole point of the feature. */}
          <ol className="space-y-2.5">
            {[
              { label: 'Entries', value: weekendDemo.entries, percent: 100 },
              { label: 'Shortlisted', value: weekendDemo.shortlisted, percent: 34 },
              { label: 'On the show', value: weekendDemo.selected, percent: 12 },
            ].map((step) => (
              <li key={step.label} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="text-muted">{step.label}</span>
                  <CountUp value={step.value} className="font-semibold text-foreground" />
                </div>
                <Meter percent={step.percent} tone="gold" />
              </li>
            ))}
          </ol>
        </FeatureCard>
      </li>
    </motion.ul>
  );
}

function TrendArrow({ trend }: { trend: 'UP' | 'DOWN' | 'FLAT' }) {
  const glyph = trend === 'UP' ? '↑' : trend === 'DOWN' ? '↓' : '→';
  const tone =
    trend === 'UP' ? 'text-success' : trend === 'DOWN' ? 'text-danger' : 'text-muted';

  return (
    <span className={cn('shrink-0 text-xs font-semibold', tone)}>
      <span aria-hidden>{glyph}</span>
      <span className="sr-only">
        {trend === 'UP' ? 'trending up' : trend === 'DOWN' ? 'trending down' : 'steady'}
      </span>
    </span>
  );
}
