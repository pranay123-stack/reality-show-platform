'use client';

import {
  Badge,
  Button,
  Card,
  ContestantCard,
  Countdown,
  LeaderboardRow,
  LiveIndicator,
  OptionResult,
  StatCard,
} from '@reality/ui';
import { Flame, Gift, Trophy, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';

import { env } from '@/lib/env';
import {
  featurePillars,
  howItWorks,
  landingContestants,
  landingLeaderboard,
  landingPoll,
  rewardTiers,
} from '@/lib/mock-landing';

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-24 h-[720px] bg-grid-fade"
      />

      <div className="container relative grid gap-12 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-28">
        <div className="space-y-7">
          <LiveIndicator label="Episode 12 · on air now" />

          <h1 className="text-display-xl font-semibold">
            Stop watching the show.
            <br />
            <span className="bg-gradient-to-r from-primary via-primary to-accent bg-clip-text text-transparent">
              Start playing it.
            </span>
          </h1>

          <p className="max-w-xl text-lg text-muted">
            {env.appName} is the second screen for a live reality show. Predict what happens next,
            vote in polls while they run, write the challenges the house attempts, and watch the
            contestant heat meter move in real time.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/signup">Create a free account</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="#how-it-works">See how it works</Link>
            </Button>
          </div>

          <p className="text-sm text-muted">
            Free to play. No payments, no betting, no cash prizes — points are for entertainment
            only.
          </p>
        </div>

        <LivePreviewPanel />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Live show preview
// ---------------------------------------------------------------------------

function LivePreviewPanel() {
  // A fixed offset from mount keeps the demo countdown ticking without pinning a
  // date that would be in the past by the time anyone reads this.
  const closesAt = useMemo(() => new Date(Date.now() + 7 * 60_000).toISOString(), []);

  return (
    <Card className="relative overflow-hidden p-5 shadow-glow">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-stage opacity-60" />

      <div className="relative space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-widest text-muted">Right now</p>
            <p className="font-semibold">Nomination Night</p>
          </div>
          <Countdown to={closesAt} variant="blocks" />
        </div>

        <div className="space-y-3 rounded-md border border-border bg-surface/70 p-4">
          <p className="text-sm font-medium">{landingPoll.question}</p>
          <div className="space-y-2">
            {landingPoll.options.map((option, index) => (
              <OptionResult
                key={option.id}
                label={option.label}
                votes={option.voteCount}
                total={landingPoll.totalVotes}
                selected={index === 0}
              />
            ))}
          </div>
          <p className="text-xs text-muted">
            {landingPoll.totalVotes.toLocaleString()} votes · counted on the server
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Playing" value="12,480" icon={<Users className="h-4 w-4" aria-hidden />} />
          <StatCard label="Votes/min" value="3,910" icon={<Flame className="h-4 w-4" aria-hidden />} />
          <StatCard label="Your rank" value="#42" icon={<Trophy className="h-4 w-4" aria-hidden />} />
        </div>

        <p className="text-center text-[11px] text-muted">
          Illustrative preview using fictional placeholder data.
        </p>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-border/60 py-20">
      <div className="container space-y-10">
        <SectionHeading
          eyebrow="How it works"
          title="Four steps, then you are playing"
          copy="No download, no payment, no draft. Sign up, confirm your email and take part while the episode airs."
        />

        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {howItWorks.map((item) => (
            <li key={item.step}>
              <Card className="h-full p-5">
                <span className="font-mono text-sm text-primary">{item.step}</span>
                <h3 className="mt-3 font-semibold">{item.title}</h3>
                <p className="mt-1.5 text-sm text-muted">{item.copy}</p>
              </Card>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Interactive features
// ---------------------------------------------------------------------------

export function InteractiveFeatures() {
  return (
    <section id="features" className="border-t border-border/60 py-20">
      <div className="container space-y-10">
        <SectionHeading
          eyebrow="Interactive features"
          title="Eight ways to take part"
          copy="Every one of them is server-authoritative: your browser sends an intent, the server decides the result."
        />

        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {featurePillars.map((pillar) => (
            <li key={pillar.title}>
              <Card className="group h-full p-5 transition-colors hover:border-border-strong">
                <span
                  aria-hidden
                  className={`block h-1 w-10 rounded-full ${
                    pillar.accent === 'primary' ? 'bg-primary' : 'bg-accent'
                  }`}
                />
                <h3 className="mt-4 font-semibold">{pillar.title}</h3>
                <p className="mt-1.5 text-sm text-muted">{pillar.copy}</p>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Contestant preview
// ---------------------------------------------------------------------------

export function ContestantPreview() {
  return (
    <section id="contestants" className="border-t border-border/60 py-20">
      <div className="container space-y-10">
        <SectionHeading
          eyebrow="Contestant heat meter"
          title="Momentum you can actually see"
          copy="Heat measures contestants on the show — votes, reactions, engagement and trend — and it is recomputed on the server, never in your browser."
        />

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {landingContestants.map((contestant, index) => (
            <li key={contestant.id}>
              <ContestantCard
                name={contestant.name}
                occupation={contestant.occupation}
                tagline={contestant.tagline}
                heatScore={contestant.heatScore}
                heatTrend={contestant.heatTrend}
                rank={index + 1}
              />
            </li>
          ))}
        </ul>

        <p className="text-center text-xs text-muted">
          Contestants shown are fictional placeholders created for development.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

export function Rewards() {
  return (
    <section id="rewards" className="border-t border-border/60 py-20">
      <div className="container space-y-10">
        <SectionHeading
          eyebrow="Points & rewards"
          title="Earned by taking part, never bought"
          copy="Every point is written to an auditable ledger. Nothing here is purchasable, withdrawable or a wager."
        />

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="divide-y divide-border/60">
            {rewardTiers.map((reward) => (
              <div key={reward.name} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    <Gift className="h-4 w-4 text-primary" aria-hidden />
                    {reward.name}
                    <Badge size="sm">{reward.type}</Badge>
                  </p>
                  <p className="mt-0.5 text-sm text-muted">{reward.description}</p>
                </div>
                <span className="shrink-0 font-mono text-sm tabular-nums">{reward.cost}</span>
              </div>
            ))}
          </Card>

          <Card className="space-y-4 p-6">
            <h3 className="font-semibold">How points are earned</h3>
            <ul className="space-y-2.5 text-sm text-muted">
              {[
                ['Voting in a live poll', '+3'],
                ['Submitting a prediction', '+5'],
                ['Getting a prediction right', '+50'],
                ['Submitting a challenge', '+10'],
                ['Reaching the top challenges', '+75'],
                ['Having your challenge selected', '+200'],
              ].map(([label, value]) => (
                <li key={label} className="flex items-center justify-between gap-3">
                  <span>{label}</span>
                  <span className="font-mono text-foreground">{value}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">
              Values are configurable by production and are shown here as defaults.
            </p>
          </Card>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard preview
// ---------------------------------------------------------------------------

export function LeaderboardPreview() {
  return (
    <section id="leaderboard" className="border-t border-border/60 py-20">
      <div className="container space-y-10">
        <SectionHeading
          eyebrow="Leaderboards"
          title="Daily, weekly, season"
          copy="Ranked purely on participation points. This ranks viewers — contestants have their own heat meter and the two are never mixed."
        />

        <Card className="mx-auto max-w-2xl p-3">
          {landingLeaderboard.map((entry) => (
            <LeaderboardRow
              key={entry.rank}
              rank={entry.rank}
              name={entry.name}
              points={entry.points}
              previousRank={entry.previousRank}
              isCurrentUser={entry.rank === 4}
            />
          ))}
        </Card>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Closing CTA
// ---------------------------------------------------------------------------

export function ClosingCta() {
  return (
    <section className="border-t border-border/60 py-20">
      <div className="container">
        <Card className="relative overflow-hidden p-10 text-center">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-stage opacity-70" />
          <div className="relative mx-auto max-w-2xl space-y-6">
            <h2 className="text-display-lg font-semibold">The next episode starts without you.</h2>
            <p className="text-muted">
              Create an account in under a minute and take part in tonight&rsquo;s polls,
              predictions and nominations.
            </p>
            <div className="flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/signup">Join free</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/login">I already have an account</Link>
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="container grid gap-8 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-3">
          <p className="flex items-center gap-2 font-semibold">
            <span
              aria-hidden
              className="h-5 w-5 rounded bg-gradient-to-br from-primary to-accent"
            />
            {env.appName}
          </p>
          <p className="max-w-sm text-sm text-muted">
            An original, unbranded interactive audience platform. Not affiliated with, endorsed by
            or derived from any existing television programme.
          </p>
        </div>

        <nav aria-label="Product" className="space-y-2 text-sm">
          <p className="font-medium">Product</p>
          {[
            ['How it works', '#how-it-works'],
            ['Features', '#features'],
            ['Rewards', '#rewards'],
            ['Leaderboard', '#leaderboard'],
          ].map(([label, href]) => (
            <a key={href} href={href} className="block text-muted transition-colors hover:text-foreground">
              {label}
            </a>
          ))}
        </nav>

        <nav aria-label="Account" className="space-y-2 text-sm">
          <p className="font-medium">Account</p>
          <Link href="/signup" className="block text-muted transition-colors hover:text-foreground">
            Create account
          </Link>
          <Link href="/login" className="block text-muted transition-colors hover:text-foreground">
            Sign in
          </Link>
          <Link
            href="/forgot-password"
            className="block text-muted transition-colors hover:text-foreground"
          >
            Reset password
          </Link>
        </nav>
      </div>

      <div className="border-t border-border/60 py-6">
        <p className="container text-center text-xs text-muted">
          Contestants, episodes and events shown here are fictional placeholders. Points have no
          monetary value and cannot be purchased, exchanged or withdrawn.
        </p>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------

function SectionHeading({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <div className="max-w-2xl space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">{eyebrow}</p>
      <h2 className="text-display-md font-semibold">{title}</h2>
      <p className="text-muted">{copy}</p>
    </div>
  );
}
