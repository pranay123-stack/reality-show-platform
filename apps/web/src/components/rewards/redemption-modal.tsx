'use client';

import type { RewardView } from '@reality/shared';
import { Alert, Button, Modal, ModalClose, ModalContent } from '@reality/ui';
import { Coins } from 'lucide-react';

import { useRedeemReward } from '@/hooks/use-rewards';

export interface RedemptionModalProps {
  reward: RewardView | null;
  /** The user's spendable balance, so the confirmation can show the after. */
  balance: number | null;
  onClose: () => void;
}

/**
 * The confirmation step before points leave an account.
 *
 * Deliberately explicit about three things a user would otherwise only discover
 * afterwards: what the balance will be, whether the reward arrives instantly or
 * waits for a person, and — for anything real-world — that nothing is promised
 * until production says so.
 */
export function RedemptionModal({ reward, balance, onClose }: RedemptionModalProps) {
  const redeem = useRedeemReward();

  if (!reward) return null;

  const remainingAfter = balance === null ? null : balance - reward.pointCost;
  const instant = reward.category === 'DIGITAL' && !reward.requiresApproval;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent
        title={`Redeem ${reward.name}?`}
        description={
          instant
            ? 'This is granted straight away.'
            : 'This goes to the production team, who will confirm it.'
        }
        footer={
          <>
            <ModalClose asChild>
              <Button variant="ghost" disabled={redeem.isPending}>
                Cancel
              </Button>
            </ModalClose>
            <Button
              loading={redeem.isPending}
              onClick={() => redeem.mutate(reward.id, { onSuccess: onClose })}
            >
              Spend {reward.pointCost.toLocaleString()} points
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm">
            <span className="flex items-center gap-2 text-muted">
              <Coins className="h-4 w-4 text-accent" aria-hidden />
              Cost
            </span>
            <span className="font-medium tabular-nums">
              {reward.pointCost.toLocaleString()} points
            </span>
          </div>

          {remainingAfter !== null && (
            <p className="text-sm text-muted">
              You will have{' '}
              <span className="font-medium tabular-nums text-foreground">
                {remainingAfter.toLocaleString()}
              </span>{' '}
              points left. This does not affect your level or your all-time total.
            </p>
          )}

          {reward.disclaimer && (
            <Alert tone="warning">{reward.disclaimer}</Alert>
          )}

          {!instant && (
            <p className="text-xs text-muted">
              Your points are held as soon as you confirm. If production cannot fulfil it, or you
              cancel before it is sent, they come straight back.
            </p>
          )}
        </div>
      </ModalContent>
    </Modal>
  );
}
