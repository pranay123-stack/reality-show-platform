'use client';

import type { RewardView } from '@reality/shared';
import { Badge, Button, Card, cn } from '@reality/ui';
import { Coins, Gift, Lock, Package, Sparkles, Ticket } from 'lucide-react';
import Link from 'next/link';

const CATEGORY_ICON = {
  DIGITAL: Sparkles,
  EXPERIENCE: Ticket,
  PHYSICAL: Package,
} as const;

const CATEGORY_LABEL = {
  DIGITAL: 'Digital',
  EXPERIENCE: 'Experience',
  PHYSICAL: 'Merchandise',
} as const;

/** The one thing standing between this user and this reward, in a few words. */
export function rewardBlocker(reward: RewardView): string | null {
  const eligibility = reward.eligibility;
  if (!eligibility) return null;
  if (eligibility.alreadyHeld) return 'Already redeemed';
  if (!reward.inventory.unlimited && reward.inventory.remaining === 0) return 'Out of stock';
  if (!eligibility.eligible) return 'Not unlocked yet';
  if (!eligibility.affordable) return 'Not enough points';
  return null;
}

export interface RewardCardProps {
  reward: RewardView;
  /** Rendered inline on the detail page, where the link would be circular. */
  href?: string | null;
  onRedeem?: (reward: RewardView) => void;
}

export function RewardCard({ reward, href, onRedeem }: RewardCardProps) {
  const Icon = CATEGORY_ICON[reward.category] ?? Gift;
  const blocker = rewardBlocker(reward);
  const canRedeem = reward.eligibility !== null && blocker === null;
  const lowStock =
    !reward.inventory.unlimited &&
    reward.inventory.remaining !== null &&
    reward.inventory.remaining > 0 &&
    reward.inventory.remaining <= 5;

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
          <Badge tone="neutral" size="sm">
            {CATEGORY_LABEL[reward.category]}
          </Badge>
        </span>

        {lowStock && (
          <Badge tone="warning" size="sm">
            {reward.inventory.remaining} left
          </Badge>
        )}
        {!reward.inventory.unlimited && reward.inventory.remaining === 0 && (
          <Badge tone="danger" size="sm">
            Out of stock
          </Badge>
        )}
      </div>

      <div className="min-w-0 space-y-1">
        <h3 className="truncate text-base font-semibold">{reward.name}</h3>
        {reward.description && (
          <p className="line-clamp-2 text-sm text-muted">{reward.description}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
          <Coins className="h-4 w-4 text-accent" aria-hidden />
          {reward.pointCost.toLocaleString()}
          <span className="text-xs font-normal text-muted">points</span>
        </span>

        {blocker ? (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {blocker}
          </span>
        ) : (
          reward.eligibility && (
            <Badge tone="success" size="sm">
              Ready to redeem
            </Badge>
          )
        )}
      </div>
    </>
  );

  return (
    <Card
      className={cn(
        'flex h-full flex-col gap-3 p-4 transition-colors',
        canRedeem ? 'border-success/30' : 'border-border',
        href && 'hover:border-primary/40',
      )}
    >
      {href ? (
        <Link href={href} className="flex flex-1 flex-col gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {body}
        </Link>
      ) : (
        <div className="flex flex-1 flex-col gap-3">{body}</div>
      )}

      {onRedeem && (
        <Button
          className="w-full"
          disabled={!canRedeem}
          variant={canRedeem ? 'primary' : 'ghost'}
          onClick={() => onRedeem(reward)}
        >
          {blocker ?? 'Redeem'}
        </Button>
      )}
    </Card>
  );
}
