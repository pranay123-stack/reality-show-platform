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

import { EntertainmentCard, ShareRow } from '@/components/marketing/entertainment-card';
import { CountUp, LiveTicker, Meter } from '@/components/system/premium';
import { featureMetrics } from '@/lib/mock-arena';
import {
  challengeDemo,
  heatDemo,
  kitchenMarketDemo,
  livePollDemo,
  nominationDemo,
  perspectiveDemo,
  predictionDemo,
  weekendDemo,
} from '@/lib/mock-features';
import { stagger, viewportOnce } from '@/lib/motion';

/**
 * The eight ways in.
 *
 * Each card leads with a number and a question rather than a name and a
 * description. The name is still there — small, above the question — because a
 * returning viewer navigates by it, but it is no longer the loudest thing on a
 * card whose job is to make somebody want to answer.
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
  const kitchenMarketCloses = useMemo(
    () => new Date(Date.now() + kitchenMarketDemo.closesInSeconds * 1000).toISOString(),
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
      <li>
        <EntertainmentCard
          icon={<Target className="h-5 w-5" aria-hidden />}
          title="Make Your Prediction"
          question="Who gets captaincy tonight?"
          theme="pink"
          status="open"
          metric={featureMetrics.prediction}
          cta={{ label: 'Make your move', href: '/predictions' }}
          preview={
            <div className="space-y-3">
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
              <div className="flex items-center justify-between gap-2 text-xs text-muted">
                <span>Locks in</span>
                <Countdown to={predictionCloses} finishedLabel="Locked" />
              </div>
            </div>
          }
        />
      </li>

      <li>
        <EntertainmentCard
          icon={<Sparkles className="h-5 w-5" aria-hidden />}
          title="Change The House"
          question="What should they be made to do?"
          theme="purple"
          status="open"
          statusLabel="Voting"
          metric={featureMetrics.challenge}
          cta={{ label: 'Write a challenge', href: '/challenges/new' }}
          preview={
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted">Leading tonight</p>
              <p className="mt-1 text-sm font-medium">“{challengeDemo.top}”</p>

              <div className="mt-2.5 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Avatar name={challengeDemo.creator} size="sm" className="h-5 w-5 text-[9px]" />
                  <span className="truncate text-xs text-muted">{challengeDemo.creator}</span>
                  <span className="shrink-0 rounded-full border border-neon-purple/30 bg-neon-purple/10 px-1.5 text-[10px] font-semibold text-neon-purple">
                    #{challengeDemo.creatorRank}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  <CountUp value={challengeDemo.votes} className="text-foreground" /> votes
                </span>
              </div>
            </div>
          }
        />
      </li>

      <li>
        <EntertainmentCard
          icon={<Flame className="h-5 w-5" aria-hidden />}
          title="House Heat"
          question="Who owns the spotlight?"
          theme="gold"
          status="live"
          metric={featureMetrics.heat}
          cta={{ label: 'See the heat', href: '/contestants' }}
          preview={
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

      <li>
        <EntertainmentCard
          icon={<MessageSquareQuote className="h-5 w-5" aria-hidden />}
          title="Pick A Side"
          question="Who was right?"
          theme="cyan"
          status="open"
          metric={featureMetrics.perspective}
          cta={{ label: 'Take a side', href: '/perspectives' }}
          preview={
            <div className="space-y-1.5">
              {/* One bar, two sides — the shape of the disagreement itself. */}
              <div className="flex h-9 w-full overflow-hidden rounded-lg border border-white/10">
                <motion.div
                  className="flex items-center justify-start bg-neon-cyan/25 pl-2 text-xs font-semibold text-neon-cyan"
                  initial={{ width: '50%' }}
                  whileInView={{ width: `${perspectiveDemo.left.percent}%` }}
                  viewport={{ once: true, amount: 0.5 }}
                  transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                >
                  {perspectiveDemo.left.percent}%
                </motion.div>
                <div className="flex flex-1 items-center justify-end bg-neon-purple/25 pr-2 text-xs font-semibold text-neon-purple">
                  {perspectiveDemo.right.percent}%
                </div>
              </div>
              <div className="flex justify-between gap-2 text-xs text-muted">
                <span className="min-w-0 truncate">{perspectiveDemo.left.name}</span>
                <span className="min-w-0 truncate">{perspectiveDemo.right.name}</span>
              </div>
            </div>
          }
        />
      </li>

      <li>
        <EntertainmentCard
          icon={<Radio className="h-5 w-5" aria-hidden />}
          title="Live Polls"
          question="Did they earn it?"
          theme="pink"
          status="live"
          metric={featureMetrics.poll}
          cta={{ label: 'Vote now', href: '/polls' }}
          preview={
            <div className="space-y-3">
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
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <span aria-hidden className="h-1.5 w-1.5 animate-pulse-live rounded-full bg-live" />
                <LiveTicker value={48_260} perTick={14} className="font-semibold text-foreground" />
                counted
              </p>
            </div>
          }
        />
      </li>

      <li>
        <EntertainmentCard
          icon={<Gavel className="h-5 w-5" aria-hidden />}
          title="Nomination Night"
          question="Who goes on the block?"
          theme="pink"
          status="closing"
          metric={featureMetrics.nomination}
          cta={{ label: 'Cast your votes', href: '/nominations' }}
          preview={
            <div className="space-y-3">
              <ul className="space-y-2.5">
                {nominationDemo.nominees.map((nominee) => (
                  <li key={nominee.name}>
                    <ShareRow
                      label={nominee.name}
                      percent={nominee.support}
                      tone="pink"
                      avatar={<Avatar name={nominee.name} size="sm" className="h-5 w-5 text-[9px]" />}
                    />
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-danger/25 bg-danger/[0.07] px-2.5 py-1.5 text-xs text-danger">
                <span className="font-medium">Closes</span>
                <Countdown to={nominationCloses} finishedLabel="Closed" />
              </div>
            </div>
          }
        />
      </li>

      <li>
        <EntertainmentCard
          icon={<ChefHat className="h-5 w-5" aria-hidden />}
          title="Kitchen Market"
          question="Who cooks tonight's dinner?"
          theme="cyan"
          status="live"
          metric={kitchenMarketDemo.metric}
          cta={{ label: 'Make prediction', href: '/kitchen/markets' }}
          preview={
            <div className="space-y-3">
              <div className="space-y-2.5">
                {kitchenMarketDemo.options.map((option) => (
                  <ShareRow
                    key={option.name}
                    label={option.name}
                    percent={option.percent}
                    tone="cyan"
                    avatar={<Avatar name={option.name} size="sm" className="h-5 w-5 text-[9px]" />}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted">
                <span>Closes in</span>
                <Countdown to={kitchenMarketCloses} finishedLabel="Closed" />
              </div>
            </div>
          }
        />
      </li>

      <li>
        <EntertainmentCard
          icon={<Trophy className="h-5 w-5" aria-hidden />}
          title="Weekend Spotlight"
          question="What would you ask them?"
          theme="gold"
          status="idle"
          metric={featureMetrics.weekend}
          cta={{ label: 'Take the spotlight', href: '/weekend' }}
          preview={
            /* The funnel, narrowing — which is the whole point of the feature. */
            <ol className="space-y-2.5">
              {[
                { label: 'Asked', value: weekendDemo.entries, percent: 100 },
                { label: 'Shortlisted', value: weekendDemo.shortlisted, percent: 34 },
                { label: 'On air', value: weekendDemo.selected, percent: 12 },
              ].map((step) => (
                <li key={step.label} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
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
        'flex shrink-0 items-center gap-0.5 text-xs font-semibold tabular-nums',
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
      <span className="sr-only">{rising ? 'up' : falling ? 'down' : 'unchanged'} today</span>
    </span>
  );
}
