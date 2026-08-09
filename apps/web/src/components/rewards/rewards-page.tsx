'use client';

import type { RewardView } from '@reality/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  ProgressBar,
  cn,
} from '@reality/ui';
import { Coins, Gift, History } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { RedemptionModal } from '@/components/rewards/redemption-modal';
import { RewardCard } from '@/components/rewards/reward-card';
import { useMyLevel, useRewards } from '@/hooks/use-rewards';
import { useAuth } from '@/providers/auth-provider';

const FILTERS = [
  { key: 'ALL', label: 'Everything' },
  { key: 'DIGITAL', label: 'Digital' },
  { key: 'EXPERIENCE', label: 'Experiences' },
  { key: 'PHYSICAL', label: 'Merchandise' },
] as const;

type Filter = (typeof FILTERS)[number]['key'];

export function RewardsPage() {
  const { user, isAuthenticated } = useAuth();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [pending, setPending] = useState<RewardView | null>(null);

  const { data, isLoading, isError, refetch } = useRewards();
  const level = useMyLevel();

  const balance = user?.pointsBalance ?? null;

  const rewards = (data ?? []).filter(
    (reward) => filter === 'ALL' || reward.category === filter,
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Points &amp; Rewards</h1>
        <p className="text-sm text-muted">
          Points are earned by taking part in the show. Spend them here — spending never costs you
          a level.
        </p>
      </header>

      {isAuthenticated && <BalanceCard balance={balance} level={level.data ?? null} />}

      <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Reward categories">
        {FILTERS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setFilter(option.key)}
            aria-pressed={filter === option.key}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors',
              filter === option.key
                ? 'border-primary/50 bg-primary/15 text-foreground'
                : 'border-border text-muted hover:border-border-strong hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </nav>

      {isLoading ? (
        <LoadingState rows={4} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : rewards.length === 0 ? (
        <EmptyState
          title={filter === 'ALL' ? 'No rewards available yet' : 'Nothing in this category'}
          description="Production adds rewards as the season goes on. Keep earning in the meantime."
          icon={<Gift className="h-6 w-6" aria-hidden />}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rewards.map((reward) => (
            <li key={reward.id}>
              <RewardCard
                reward={reward}
                href={`/rewards/${reward.id}`}
                onRedeem={isAuthenticated ? setPending : undefined}
              />
            </li>
          ))}
        </ul>
      )}

      <RedemptionModal reward={pending} balance={balance} onClose={() => setPending(null)} />
    </div>
  );
}

function BalanceCard({
  balance,
  level,
}: {
  balance: number | null;
  level: { level: number; pointsIntoLevel: number; pointsForNextLevel: number | null } | null;
}) {
  const span =
    level && level.pointsForNextLevel !== null
      ? level.pointsIntoLevel + level.pointsForNextLevel
      : null;

  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <span className="flex items-center gap-2 text-sm text-muted">
          <Coins className="h-4 w-4 text-accent" aria-hidden />
          Your balance
        </span>
        <p className="text-2xl font-semibold tabular-nums">
          {(balance ?? 0).toLocaleString()}
          <span className="ml-1.5 text-sm font-normal text-muted">points</span>
        </p>
      </div>

      {level && (
        <div className="min-w-0 flex-1 space-y-2 sm:max-w-xs">
          <div className="flex items-center justify-between gap-2 text-sm">
            <Badge tone="primary" size="sm">
              Level {level.level}
            </Badge>
            <span className="text-xs text-muted">
              {level.pointsForNextLevel === null
                ? 'Top level reached'
                : `${level.pointsForNextLevel.toLocaleString()} to level ${level.level + 1}`}
            </span>
          </div>
          <ProgressBar
            value={level.pointsIntoLevel}
            max={span ?? 1}
            tone="accent"
            size="sm"
            label="Level progress"
          />
        </div>
      )}

      <Button asChild variant="secondary" className="shrink-0">
        <Link href="/my-rewards">
          <History className="h-4 w-4" aria-hidden />
          My rewards
        </Link>
      </Button>
    </Card>
  );
}
