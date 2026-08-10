'use client';

import { Avatar, Countdown, cn } from '@reality/ui';
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
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useMemo } from 'react';

import { InteractiveFeatureCard, ShareRow } from '@/components/marketing/feature-card';
import { CountUp, LiveTicker, Meter } from '@/components/system/premium';
import { featureMetrics } from '@/lib/mock-arena';
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
 * The eight features, each showing what it looks like in use.
 *
 * Every card carries its own preview because the features are not variations on
 * one thing. The card component supplies the frame, the live state and one
 * headline number; everything below that line is specific to the feature.
 *
 * The data is fictional and labelled as such at the foot of the section.
 */
export function FeatureGrid() {
  // Anchored to mount, so the demo clocks are always ahead of the reader rather
  // than stuck at a timestamp baked in at build time.
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
        <InteractiveFeatureCard
          icon={<Target className="h-5 w-5" aria-hidden />}
          title="Prediction Game"
          description="Predict what happens next. One prediction per question, locked the moment it closes."
          theme="pink"
          liveStatus="open"
          metric={featureMetrics.prediction}
          cta={{ label: 'Make prediction', href: '/predictions' }}
          previewData={
            <div className="space-y-3">
              <p className="text-xs font-medium text-foreground">{predictionDemo.question}</p>
              <div className="space-y-2.5">
                {predictionDemo.options.map((option) => (
                  <ShareRow
                    key={option.name}
                    label={option.name}
                    percent={option.percent}
                    tone="pink"
                    avatar={<Avatar name={option.name} size="sm" className="h-5 w-5 text-[9px]" />}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
                <span>Closes in</span>
                <Countdown to={predictionCloses} finishedLabel="Closed" />
              </div>
            </div>
          }
        />
      </li>

      {/* --- Audience Challenges ------------------------------------------- */}
      <li>
        <InteractiveFeatureCard
          icon={<Sparkles className="h-5 w-5" aria-hidden />}
          title="Audience Challenges"
          description="Create tasks for the house. The community votes, moderators check, producers choose."
          theme="purple"
          liveStatus="open"
          statusLabel="Voting"
          metric={featureMetrics.challenge}
          cta={{ label: 'Submit challenge', href: '/challenges/new' }}
          previewData={
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted">Top challenge</p>
              <p className="mt-1 text-sm font-medium">“{challengeDemo.top}”</p>

              <div className="mt-2.5 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Avatar name={challengeDemo.creator} size="sm" className="h-5 w-5 text-[9px]" />
                  <span className="truncate text-[11px] text-muted">{challengeDemo.creator}</span>
                  <span className="shrink-0 rounded-full border border-neon-purple/30 bg-neon-purple/10 px-1.5 text-[10px] font-semibold text-neon-purple">
                    #{challengeDemo.creatorRank}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted">
                  <CountUp value={challengeDemo.votes} className="text-foreground" /> votes
                </span>
              </div>
            </div>
          }
        />
      </li>

      {/* --- Contestant Heat Meter ------------------------------------------ */}
      <li>
        <InteractiveFeatureCard
          icon={<Flame className="h-5 w-5" aria-hidden />}
          title="Contestant Heat Meter"
          description="A live popularity score built from votes, reactions and momentum — recomputed on the server."
          theme="gold"
          liveStatus="live"
          metric={featureMetrics.heat}
          cta={{ label: 'See the meter', href: '/contestants' }}
          previewData={
            <ul className="space-y-2.5">
              {heatDemo.map((contestant) => (
                <li key={contestant.name} className="flex items-center gap-2">
                  <Avatar name={contestant.name} size="sm" className="h-6 w-6 text-[10px]" />
                  <span className="min-w-0 flex-1 truncate text-xs">{contestant.name}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums text-neon-gold">
                    <Flame className="h-3.5 w-3.5" aria-hidden />
                    <CountUp value={contestant.score} />
                  </span>
                  <HeatDelta delta={contestant.delta} trend={contestant.trend} />
                </li>
              ))}
            </ul>
          }
        />
      </li>

      {/* --- Audience Perspective ------------------------------------------- */}
      <li>
        <InteractiveFeatureCard
          icon={<MessageSquareQuote className="h-5 w-5" aria-hidden />}
          title="Audience Perspective"
          description="After an argument, say who was right. Opinion about what already happened, kept apart from live polls."
          theme="cyan"
          liveStatus="open"
          metric={featureMetrics.perspective}
          cta={{ label: 'Take a side', href: '/perspectives' }}
          previewData={
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
            </div>
          }
        />
      </li>

      {/* --- Live Polls ------------------------------------------------------ */}
      <li>
        <InteractiveFeatureCard
          icon={<Radio className="h-5 w-5" aria-hidden />}
          title="Real-time Live Polls"
          description="Vote during the broadcast and watch the bars move. Counts come from the server, never the browser."
          theme="pink"
          liveStatus="live"
          metric={featureMetrics.poll}
          cta={{ label: 'Vote live', href: '/polls' }}
          previewData={
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
              {/* The one number on the page that keeps moving while you read. */}
              <p className="flex items-center gap-1.5 text-[11px] text-muted">
                <span aria-hidden className="h-1.5 w-1.5 animate-pulse-live rounded-full bg-live" />
                <LiveTicker value={48_260} perTick={14} className="font-semibold text-foreground" />
                votes counted
              </p>
            </div>
          }
        />
      </li>

      {/* --- Nomination & Eviction ------------------------------------------- */}
      <li>
        <InteractiveFeatureCard
          icon={<Gavel className="h-5 w-5" aria-hidden />}
          title="Nomination & Eviction"
          description="Take part in every round with a clear vote limit — and a clear line between the audience result and the show’s official outcome."
          theme="pink"
          liveStatus="closing"
          metric={featureMetrics.nomination}
          cta={{ label: 'Cast your votes', href: '/nominations' }}
          previewData={
            <div className="space-y-3">
              <ul className="space-y-2.5">
                {nominationDemo.nominees.map((nominee) => (
                  <li key={nominee.name}>
                    <ShareRow
                      label={nominee.name}
                      percent={nominee.support}
                      tone="pink"
                      meta={`${nominee.support}%`}
                      avatar={<Avatar name={nominee.name} size="sm" className="h-5 w-5 text-[9px]" />}
                    />
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-danger/25 bg-danger/[0.07] px-2.5 py-1.5 text-[11px] text-danger">
                <span className="font-medium">Voting closes</span>
                <Countdown to={nominationCloses} finishedLabel="Closed" />
              </div>
            </div>
          }
        />
      </li>

      {/* --- Kitchen Control -------------------------------------------------- */}
      <li>
        <InteractiveFeatureCard
          icon={<ChefHat className="h-5 w-5" aria-hidden />}
          title="Kitchen Control"
          description="Decide what the house eats within a fixed budget. The final basket is calculated on the server."
          theme="cyan"
          liveStatus="open"
          metric={featureMetrics.kitchen}
          cta={{ label: 'Pick the menu', href: '/kitchen' }}
          previewData={
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
                    <CountUp value={kitchenDemo.budgetSpent} /> /{' '}
                    {kitchenDemo.budgetTotal.toLocaleString()}
                  </span>
                </div>
                <Meter
                  percent={(kitchenDemo.budgetSpent / kitchenDemo.budgetTotal) * 100}
                  tone="cyan"
                />
              </div>
            </div>
          }
        />
      </li>

      {/* --- Weekend Participation --------------------------------------------- */}
      <li>
        <InteractiveFeatureCard
          icon={<Trophy className="h-5 w-5" aria-hidden />}
          title="Weekend Participation"
          description="Send a question for the weekend episode. Moderated, shortlisted, then chosen by production."
          theme="gold"
          liveStatus="idle"
          metric={featureMetrics.weekend}
          cta={{ label: 'Send a question', href: '/weekend' }}
          previewData={
            /* The funnel, narrowing — which is the whole point of the feature. */
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
          }
        />
      </li>
    </motion.ul>
  );
}

/** How far a contestant has moved today, and which way. */
function HeatDelta({ delta, trend }: { delta: number; trend: 'UP' | 'DOWN' | 'FLAT' }) {
  const rising = trend === 'UP';
  const falling = trend === 'DOWN';

  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-0.5 text-[11px] font-semibold tabular-nums',
        rising ? 'text-success' : falling ? 'text-danger' : 'text-muted',
      )}
    >
      {rising ? (
        <TrendingUp className="h-3 w-3" aria-hidden />
      ) : falling ? (
        <TrendingDown className="h-3 w-3" aria-hidden />
      ) : null}
      {delta > 0 ? '+' : ''}
      {delta}
      <span className="sr-only">
        {rising ? 'up' : falling ? 'down' : 'unchanged'} today
      </span>
    </span>
  );
}
