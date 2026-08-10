'use client';

import { Avatar, Button, Card, cn } from '@reality/ui';
import { motion } from 'framer-motion';
import { ArrowRight, Flame, Gift, Trophy } from 'lucide-react';
import Link from 'next/link';

import { CountUp, Meter } from '@/components/system/premium';
import { sampleProfile } from '@/lib/mock-arena';
import { fadeUp, stagger, viewportOnce } from '@/lib/motion';

/**
 * "Your Reality Profile" — as a worked example, not as a fake session.
 *
 * This is a landing page. Every visitor reading it is signed out, and dressing
 * a sample up as *their* level, *their* streak and *their* rank would be a lie
 * told for engagement. So the heading says whose profile this is, the card is
 * labelled, and the call to action is to go and start one.
 *
 * The retention idea the brief is reaching for still lands: showing what a
 * month of playing looks like is the argument for signing up. It just has to
 * be honest about being an example.
 */
export function ProfileWidget() {
  const { pointsIntoLevel, pointsForNextLevel } = sampleProfile;
  const levelProgress = (pointsIntoLevel / (pointsIntoLevel + pointsForNextLevel)) * 100;
  const rewardProgress = (sampleProfile.rewardsUnlocked / sampleProfile.rewardsTotal) * 100;

  return (
    <section id="profile" className="relative border-t border-white/5 py-14 sm:py-20 lg:py-24">
      <div className="container">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          className="grid items-center gap-10 lg:grid-cols-[0.95fr_1.05fr]"
        >
          <motion.div variants={fadeUp} className="space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neon-gold">
                Your reality profile
              </p>
              <h2 className="text-headline font-semibold text-balance">Play more. Climb higher.</h2>
              <p className="max-w-md text-lg leading-snug text-muted">
                Points for showing up.
                <br />
                A rank nobody can buy.
              </p>
            </div>

            <ul className="space-y-2 text-base text-muted">
              {['Every vote counts', 'Levels only go up', 'Daily, weekly, season'].map((line) => (
                <li key={line} className="flex items-center gap-2.5">
                  <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-neon-gold" />
                  {line}
                </li>
              ))}
            </ul>

            <Button asChild size="lg">
              <Link href="/signup">
                Take the spotlight
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </motion.div>

          <motion.div variants={fadeUp}>
            <Card className="relative overflow-hidden p-6">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-neon-gold/12 blur-3xl"
              />

              <div className="relative space-y-6">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-muted">
                    Example profile
                  </span>
                  <span className="rounded-full border border-neon-gold/30 bg-neon-gold/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-neon-gold">
                    Level {sampleProfile.level}
                  </span>
                </div>

                <div className="flex items-center gap-4">
                  <Avatar name={sampleProfile.displayName} size="xl" />
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-xl font-semibold">{sampleProfile.displayName}</p>
                    <p className="text-sm text-muted">{sampleProfile.levelTitle}</p>
                    <p className="flex items-center gap-1.5 text-sm text-neon-gold">
                      <Flame className="h-4 w-4" aria-hidden />
                      <CountUp value={sampleProfile.streakDays} className="font-semibold" /> day
                      streak
                    </p>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-3">
                  <Stat
                    icon={<Trophy className="h-4 w-4 text-neon-purple" aria-hidden />}
                    label="Points"
                    value={sampleProfile.points}
                  />
                  <Stat
                    icon={<Trophy className="h-4 w-4 text-neon-cyan" aria-hidden />}
                    label="Season rank"
                    value={sampleProfile.rank}
                    prefix="#"
                    meta={`of ${sampleProfile.rankOf.toLocaleString()}`}
                  />
                </dl>

                <div className="space-y-4">
                  <Progress
                    label={`Level ${sampleProfile.level} → ${sampleProfile.level + 1}`}
                    meta={`${pointsForNextLevel} points to go`}
                    percent={levelProgress}
                    tone="gold"
                  />
                  <Progress
                    label="Rewards unlocked"
                    meta={`${sampleProfile.rewardsUnlocked} of ${sampleProfile.rewardsTotal}`}
                    percent={rewardProgress}
                    tone="purple"
                    icon={<Gift className="h-3.5 w-3.5" aria-hidden />}
                  />
                </div>

                <p className="text-center text-xs text-muted">
                  A fictional example of a profile a month into a season.
                </p>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

function Stat({
  icon,
  label,
  value,
  prefix,
  meta,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  prefix?: string;
  meta?: string;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <dt className="flex items-center gap-1.5 text-xs uppercase tracking-[0.1em] text-muted">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">
        {prefix}
        <CountUp value={value} />
      </dd>
      {meta && <p className="text-xs text-muted">{meta}</p>}
    </div>
  );
}

function Progress({
  label,
  meta,
  percent,
  tone,
  icon,
}: {
  label: string;
  meta: string;
  percent: number;
  tone: 'gold' | 'purple';
  icon?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={cn('flex items-center gap-1.5 text-foreground')}>
          {icon}
          {label}
        </span>
        <span className="shrink-0 tabular-nums text-muted">{meta}</span>
      </div>
      <Meter percent={percent} tone={tone} />
    </div>
  );
}
