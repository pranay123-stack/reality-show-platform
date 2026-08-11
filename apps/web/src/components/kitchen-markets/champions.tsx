'use client';

import type { UserKitchenStats } from '@reality/shared';
import { Avatar, Card, cn } from '@reality/ui';
import { motion } from 'framer-motion';
import { Crown } from 'lucide-react';

import { CountUp } from '@/components/system/premium';
import { fadeUp, stagger, viewportOnce } from '@/lib/motion';

/**
 * Today's Kitchen Champions.
 *
 * The podium is the whole point: three places, sized and coloured differently,
 * so a glance tells you the shape of the day rather than making you read a
 * table. Everyone from fourth down is a list, because that is what they are.
 */

const PODIUM = [
  { medal: '🥇', ring: 'ring-neon-gold/50', text: 'text-neon-gold', glow: 'shadow-[0_0_50px_-16px_hsl(var(--neon-gold))]' },
  { medal: '🥈', ring: 'ring-white/25', text: 'text-foreground', glow: '' },
  { medal: '🥉', ring: 'ring-neon-pink/40', text: 'text-neon-pink', glow: '' },
] as const;

export function KitchenChampions({ stats }: { stats: UserKitchenStats[] }) {
  const podium = stats.slice(0, 3);
  const rest = stats.slice(3);

  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      whileInView="visible"
      viewport={viewportOnce}
      className="space-y-4"
    >
      <ol className="grid gap-3 sm:grid-cols-3">
        {podium.map((person, index) => {
          const place = PODIUM[index]!;
          return (
            <motion.li key={person.userId} variants={fadeUp}>
              <Card className={cn('relative overflow-hidden p-5 text-center', place.glow)}>
                {index === 0 && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -top-16 left-1/2 h-32 w-32 -translate-x-1/2 rounded-full bg-neon-gold/20 blur-3xl"
                  />
                )}

                <div className="relative space-y-2.5">
                  <p className="text-2xl" aria-hidden>
                    {place.medal}
                  </p>

                  <Avatar
                    name={person.displayName}
                    size="lg"
                    className={cn('mx-auto ring-2', place.ring)}
                  />

                  <div className="space-y-0.5">
                    <p className="truncate font-semibold">{person.displayName}</p>
                    <p className="text-xs text-muted">
                      <span className="sr-only">Position {person.rank}. </span>
                      {person.correctPredictions} correct
                    </p>
                  </div>

                  <p className={cn('text-2xl font-semibold', place.text)}>
                    +<CountUp value={person.pointsEarned} />
                  </p>
                </div>
              </Card>
            </motion.li>
          );
        })}
      </ol>

      {rest.length > 0 && (
        <motion.ul variants={fadeUp} className="space-y-1.5">
          {rest.map((person) => (
            <li
              key={person.userId}
              className="flex items-center gap-3 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-sm"
            >
              <span className="w-5 shrink-0 text-center font-mono text-xs text-muted tabular-nums">
                {person.rank}
              </span>
              <Avatar name={person.displayName} size="sm" className="h-6 w-6 text-[10px]" />
              <span className="min-w-0 flex-1 truncate">{person.displayName}</span>
              <span className="shrink-0 text-xs text-muted">{person.correctPredictions} correct</span>
              <span className="w-16 shrink-0 text-right font-semibold tabular-nums">
                +{person.pointsEarned}
              </span>
            </li>
          ))}
        </motion.ul>
      )}
    </motion.div>
  );
}

/** The reader's own line, shown above the board. */
export function MyStandingCard({
  points,
  predictions,
  created,
}: {
  points: number;
  predictions: number;
  created: number;
}) {
  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-neon-gold">
          <Crown className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="label-broadcast text-muted">Your session</p>
          <p className="text-sm text-muted">Markets you have created and called</p>
        </div>
      </div>

      <dl className="flex gap-6">
        <Stat label="Points" value={points} />
        <Stat label="Predictions" value={predictions} />
        <Stat label="Created" value={created} />
      </dl>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-right">
      <dt className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">
        <CountUp value={value} />
      </dd>
    </div>
  );
}
