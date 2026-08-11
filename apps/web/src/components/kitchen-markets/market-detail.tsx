'use client';

import { KITCHEN_CATEGORY_LABELS, KITCHEN_MARKET_POINTS, KITCHEN_SLOT_LABELS } from '@reality/shared';
import {
  Alert,
  Avatar,
  Button,
  Countdown,
  EmptyState,
  LoadingState,
  PageHeader,
  SectionCard,
  cn,
} from '@reality/ui';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, ChefHat, Clock, Trophy, Users } from 'lucide-react';
import Link from 'next/link';

import { CATEGORY_THEME, StatusChip } from '@/components/kitchen-markets/market-card';
import { CountUp } from '@/components/system/premium';
import { topPredictors } from '@/lib/kitchen-markets/seed';
import { scoreCreator, useKitchenMarkets } from '@/lib/kitchen-markets/store';
import { useAuth } from '@/providers/auth-provider';

/**
 * One market, in full.
 *
 * The options are buttons rather than a list, because on this page the reader
 * is here to commit. Once they have, the same buttons become the standings —
 * same layout, same order, so the answer they chose stays where they left it.
 */
export function MarketDetail({ marketId }: { marketId: string }) {
  const { canParticipate } = useAuth();
  const store = useKitchenMarkets();
  const market = store.getMarket(marketId);

  if (!store.ready) return <LoadingState rows={4} label="Loading the market…" />;

  if (!market) {
    return (
      <div className="space-y-6">
        <BackLink />
        <EmptyState
          title="That market is not here"
          description="It may have been settled and cleared, or the link may be wrong."
          icon={<ChefHat className="h-5 w-5" aria-hidden />}
          action={
            <Button asChild variant="secondary">
              <Link href="/kitchen/markets">All markets</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const theme = CATEGORY_THEME[market.category];
  const open = market.status === 'OPEN';
  const resolved = market.status === 'RESOLVED';
  const picked = Boolean(market.myOptionId);
  const leaders = topPredictors;

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title={market.question}
        meta={
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <StatusChip status={market.status} />
            <span className={cn('label-broadcast', theme.text)}>
              {KITCHEN_CATEGORY_LABELS[market.category]}
            </span>
            <span className="text-xs text-muted">· {KITCHEN_SLOT_LABELS[market.slot]}</span>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
        <span className="flex items-center gap-2">
          <Avatar name={market.creator.displayName} size="sm" className="h-6 w-6 text-[10px]" />
          Created by <span className="text-foreground">{market.creator.displayName}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Users className="h-4 w-4" aria-hidden />
          <CountUp value={market.totalPredictions} className="font-semibold text-foreground" />
          playing
        </span>
        {open && (
          <span className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" aria-hidden />
            Closes <Countdown to={market.endTime} finishedLabel="now" />
          </span>
        )}
      </div>

      {resolved && (
        <Alert tone="success" title="Settled">
          {market.options.find((option) => option.id === market.winningOptionId)?.label} was the
          outcome.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <SectionCard
          title={picked || !open ? 'Where the house stands' : 'Make your prediction'}
          description={
            open && !picked
              ? 'One prediction each, locked once the market closes.'
              : `${market.totalPredictions.toLocaleString()} predictions counted`
          }
          bodyClassName="space-y-2.5"
        >
          {market.options.map((option) => {
            const isMine = market.myOptionId === option.id;
            const won = resolved && market.winningOptionId === option.id;
            const interactive = open && !picked && canParticipate;

            const body = (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    {option.contestantId && (
                      <Avatar name={option.label} size="sm" className="h-7 w-7 text-[10px]" />
                    )}
                    <span
                      className={cn(
                        'truncate font-medium',
                        won && 'text-success',
                        isMine && !won && theme.text,
                      )}
                    >
                      {option.label}
                    </span>
                    {isMine && <Check className={cn('h-4 w-4 shrink-0', theme.text)} aria-hidden />}
                    {won && <Trophy className="h-4 w-4 shrink-0 text-success" aria-hidden />}
                  </span>

                  <span className="shrink-0 text-sm tabular-nums text-muted">
                    {option.share}%
                    <span className="ml-2 text-xs">{option.predictions.toLocaleString()}</span>
                  </span>
                </div>

                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/[0.07]">
                  <motion.div
                    className={cn('h-full rounded-full', won ? 'bg-success' : theme.bar)}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(2, option.share)}%` }}
                    transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
              </>
            );

            return interactive ? (
              <button
                key={option.id}
                type="button"
                onClick={() => store.predict(market.id, option.id)}
                className={cn(
                  'w-full rounded-lg border border-border p-3 text-left transition-colors',
                  'hover:border-border-strong hover:bg-white/[0.03]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                {body}
              </button>
            ) : (
              <div
                key={option.id}
                className={cn(
                  'rounded-lg border p-3',
                  won ? 'border-success/40 bg-success/[0.06]' : 'border-white/8 bg-white/[0.02]',
                )}
              >
                {body}
              </div>
            );
          })}

          {open && !picked && !canParticipate && (
            <p className="pt-1 text-xs text-muted">
              Confirm your email address to predict on this market.
            </p>
          )}
        </SectionCard>

        <div className="space-y-4">
          <SectionCard title="What it pays" bodyClassName="space-y-2">
            <Payout label="Correct prediction" points={KITCHEN_MARKET_POINTS.CORRECT_PREDICTION} highlight />
            <Payout label="Called it early" points={KITCHEN_MARKET_POINTS.EARLY_BONUS} />
            <Payout label="Taking part" points={KITCHEN_MARKET_POINTS.PARTICIPATE} />
            <Payout
              label={`Creator, past ${KITCHEN_MARKET_POINTS.CREATOR_BONUS_THRESHOLD} players`}
              points={scoreCreator(KITCHEN_MARKET_POINTS.CREATOR_BONUS_THRESHOLD)}
            />
            <p className="pt-1 text-[11px] text-muted">
              Market points, separate from platform points.
            </p>
          </SectionCard>

          <SectionCard title="Top predictors" description="On this market today.">
            <ol className="space-y-2">
              {leaders.map((person, index) => (
                <li key={person.displayName} className="flex items-center gap-3 text-sm">
                  <span className="w-4 shrink-0 text-center font-mono text-xs text-muted tabular-nums">
                    {index + 1}
                  </span>
                  <Avatar name={person.displayName} size="sm" className="h-6 w-6 text-[10px]" />
                  <span className="min-w-0 flex-1 truncate">{person.displayName}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-neon-gold">
                    +{person.points}
                  </span>
                </li>
              ))}
            </ol>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function Payout({ label, points, highlight }: { label: string; points: number; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="min-w-0 text-muted">{label}</span>
      <span
        className={cn(
          'shrink-0 font-semibold tabular-nums',
          highlight ? 'text-neon-gold' : 'text-foreground',
        )}
      >
        +{points}
      </span>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/kitchen/markets"
      className="inline-flex min-h-6 items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      All markets
    </Link>
  );
}
