'use client';

import type { RewardView } from '@reality/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  ErrorState,
  LoadingState,
  PageHeader,
} from '@reality/ui';
import { ArrowLeft, Check, Coins, Lock, Package, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { RedemptionModal } from '@/components/rewards/redemption-modal';
import { rewardBlocker } from '@/components/rewards/reward-card';
import { useReward } from '@/hooks/use-rewards';
import { useAuth } from '@/providers/auth-provider';

const CATEGORY_LABEL = {
  DIGITAL: 'Digital reward',
  EXPERIENCE: 'Experience',
  PHYSICAL: 'Merchandise',
} as const;

export function RewardDetail({ rewardId }: { rewardId: string }) {
  const { user, isAuthenticated } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const { data, isLoading, isError, refetch } = useReward(rewardId);

  if (isLoading) return <LoadingState rows={4} />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Reward not found"
        description="It may have been withdrawn, or it is not available to you."
        onRetry={() => void refetch()}
      />
    );
  }

  const blocker = rewardBlocker(data);
  const canRedeem = isAuthenticated && blocker === null;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/rewards">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All rewards
        </Link>
      </Button>

      <PageHeader
        title={data.name}
        description={data.description ?? undefined}
        meta={
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge tone="neutral" size="sm">
              {CATEGORY_LABEL[data.category]}
            </Badge>
            {data.requiresProductionApproval && (
              <Badge tone="warning" size="sm">
                Production confirms
              </Badge>
            )}
          </div>
        }
      />

      {data.disclaimer && <Alert tone="warning">{data.disclaimer}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {data.eligibility && <Requirements eligibility={data.eligibility} />}
        </div>

        <Card className="h-fit space-y-4 p-5">
          <div className="space-y-1">
            <span className="text-sm text-muted">Cost</span>
            <p className="flex items-center gap-2 text-2xl font-semibold tabular-nums">
              <Coins className="h-5 w-5 text-accent" aria-hidden />
              {data.pointCost.toLocaleString()}
              <span className="text-sm font-normal text-muted">points</span>
            </p>
          </div>

          <StockLine reward={data} />

          {isAuthenticated ? (
            <Button className="w-full" disabled={!canRedeem} onClick={() => setConfirming(true)}>
              {blocker ?? 'Redeem'}
            </Button>
          ) : (
            <Button asChild className="w-full">
              <Link href="/login">Sign in to redeem</Link>
            </Button>
          )}

          {data.oncePerUser && (
            <p className="text-xs text-muted">One per person for the whole season.</p>
          )}
        </Card>
      </div>

      {confirming && (
        <RedemptionModal
          reward={data}
          balance={user?.pointsBalance ?? null}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

function StockLine({ reward }: { reward: RewardView }) {
  if (reward.inventory.unlimited) {
    return <p className="text-sm text-muted">Unlimited — everyone who qualifies can have one.</p>;
  }

  const remaining = reward.inventory.remaining ?? 0;

  return (
    <p
      className={cn(
        'flex items-center gap-2 text-sm',
        remaining === 0 ? 'text-danger' : remaining <= 5 ? 'text-warning' : 'text-muted',
      )}
    >
      <Package className="h-4 w-4 shrink-0" aria-hidden />
      {remaining === 0
        ? 'All gone'
        : `${remaining.toLocaleString()} of ${(reward.inventory.totalUnits ?? remaining).toLocaleString()} left`}
    </p>
  );
}

/**
 * Why this reward is or is not within reach.
 *
 * The same principle as the weekend eligibility panel: never say "no" without
 * saying what would make it a "yes".
 */
function Requirements({ eligibility }: { eligibility: NonNullable<RewardView['eligibility']> }) {
  const unlocked = eligibility.eligible;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {unlocked ? (
            <Check className="h-4 w-4 text-success" aria-hidden />
          ) : (
            <Lock className="h-4 w-4 text-muted" aria-hidden />
          )}
          {unlocked ? 'Unlocked' : 'Not unlocked yet'}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {eligibility.requirements.map((requirement) => (
            <li key={requirement.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                {requirement.met ? (
                  <Check className="h-4 w-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <X className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                )}
                <span className={cn('truncate', requirement.met ? 'text-muted' : 'text-foreground')}>
                  {requirement.label}
                </span>
              </span>
              <span
                className={cn(
                  'shrink-0 font-mono text-xs tabular-nums',
                  requirement.met ? 'text-success' : 'text-muted',
                )}
              >
                {requirement.current}
                {typeof requirement.required === 'number' && ` / ${requirement.required}`}
              </span>
            </li>
          ))}
        </ul>

        {eligibility.blockers.length > 0 && (
          <div className="space-y-1 border-t border-border pt-3">
            {eligibility.blockers.map((blocker) => (
              <p key={blocker} className="text-xs text-muted">
                {blocker}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
