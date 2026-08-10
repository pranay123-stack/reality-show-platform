'use client';

import type { RedemptionState, RedemptionView } from '@reality/shared';
import {
  Badge,
  Button,
  Card,
  cn,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  type BadgeProps,
} from '@reality/ui';
import { ArrowLeft, Gift } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useCancelRedemption, useMyRedemptions } from '@/hooks/use-rewards';

const STATE: Record<RedemptionState, { label: string; tone: BadgeProps['tone']; help: string }> = {
  REQUESTED: { label: 'Requested', tone: 'neutral', help: 'Just submitted.' },
  RESERVED: {
    label: 'Reserved',
    tone: 'primary',
    help: 'Your points are held and one is set aside for you. Production reviews it next.',
  },
  APPROVED: {
    label: 'Approved',
    tone: 'accent',
    help: 'Production has approved it and is arranging delivery.',
  },
  FULFILLED: { label: 'Yours', tone: 'success', help: 'Delivered.' },
  REJECTED: { label: 'Declined', tone: 'danger', help: 'Production could not fulfil it.' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', help: 'This redemption was cancelled.' },
  EXPIRED: { label: 'Expired', tone: 'neutral', help: 'The reservation ran out.' },
};

/** States a user can still walk away from. */
const CANCELLABLE: RedemptionState[] = ['REQUESTED', 'RESERVED', 'APPROVED'];

export function MyRewardsPage() {
  const { data, isLoading, isError, refetch } = useMyRedemptions();
  const cancel = useCancelRedemption();
  const [confirming, setConfirming] = useState<string | null>(null);

  const redemptions = data ?? [];
  const active = redemptions.filter((row) => CANCELLABLE.includes(row.status));
  const past = redemptions.filter((row) => !CANCELLABLE.includes(row.status));

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/rewards">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All rewards
        </Link>
      </Button>

      <PageHeader
        title="My rewards"
        description="Everything you have redeemed, and where each one has got to."
      />

      {isLoading ? (
        <LoadingState rows={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : redemptions.length === 0 ? (
        <EmptyState
          title="Nothing redeemed yet"
          description="Spend your points on a badge, an experience or something from the merch shelf."
          icon={<Gift className="h-6 w-6" aria-hidden />}
          action={
            <Button asChild>
              <Link href="/rewards">Browse rewards</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <Section title="In progress">
              {active.map((redemption) => (
                <RedemptionRow
                  key={redemption.id}
                  redemption={redemption}
                  onCancel={() => setConfirming(redemption.id)}
                  cancelling={cancel.isPending && confirming === redemption.id}
                  confirming={confirming === redemption.id}
                  onConfirm={() =>
                    cancel.mutate(redemption.id, { onSettled: () => setConfirming(null) })
                  }
                  onDismiss={() => setConfirming(null)}
                />
              ))}
            </Section>
          )}

          {past.length > 0 && (
            <Section title="History">
              {past.map((redemption) => (
                <RedemptionRow key={redemption.id} redemption={redemption} />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">{title}</h2>
      <ul className="space-y-3">{children}</ul>
    </section>
  );
}

interface RedemptionRowProps {
  redemption: RedemptionView;
  onCancel?: () => void;
  onConfirm?: () => void;
  onDismiss?: () => void;
  confirming?: boolean;
  cancelling?: boolean;
}

function RedemptionRow({
  redemption,
  onCancel,
  onConfirm,
  onDismiss,
  confirming,
  cancelling,
}: RedemptionRowProps) {
  const state = STATE[redemption.status];
  const delivered = redemption.status === 'FULFILLED';

  return (
    <li>
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <Badge tone={state.tone} size="sm">
              {state.label}
            </Badge>
            <h3 className="truncate text-base font-semibold">{redemption.reward.name}</h3>
            <p className="text-xs text-muted">{state.help}</p>
          </div>

          <div className="shrink-0 text-right">
            <p
              className={cn(
                'text-sm font-medium tabular-nums',
                redemption.refunded && 'text-muted line-through',
              )}
            >
              {redemption.pointsSpent.toLocaleString()} points
            </p>
            {redemption.refunded && <p className="text-xs text-success">Refunded</p>}
          </div>
        </div>

        {redemption.reward.disclaimer && !delivered && (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            {redemption.reward.disclaimer}
          </p>
        )}

        <Timeline history={redemption.history} />

        {onCancel && !confirming && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel and get my points back
          </Button>
        )}

        {confirming && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised p-3">
            <p className="flex-1 text-sm">
              Cancel this and return {redemption.pointsSpent.toLocaleString()} points?
            </p>
            <Button variant="ghost" size="sm" onClick={onDismiss} disabled={cancelling}>
              Keep it
            </Button>
            <Button variant="danger" size="sm" loading={cancelling} onClick={onConfirm}>
              Cancel it
            </Button>
          </div>
        )}
      </Card>
    </li>
  );
}

function Timeline({ history }: { history: RedemptionView['history'] }) {
  if (history.length === 0) return null;

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      {history.map((event, index) => (
        <li key={`${event.toStatus}-${event.at}`} className="flex items-center gap-2">
          {index > 0 && <span aria-hidden>→</span>}
          <span title={new Date(event.at).toLocaleString()}>
            {STATE[event.toStatus]?.label ?? event.toStatus}
          </span>
        </li>
      ))}
    </ol>
  );
}
