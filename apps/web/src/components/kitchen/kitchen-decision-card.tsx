'use client';

import type { KitchenDecisionView } from '@reality/shared';
import { Badge, Button, Card, Countdown, ProgressBar } from '@reality/ui';
import { Clock } from 'lucide-react';
import { useMemo, useState } from 'react';

import { BudgetMeter } from './budget-meter';
import { ResultDisplay } from './result-display';
import { VotingOptions } from './voting-options';

/**
 * One kitchen decision.
 *
 * Picks are staged locally and submitted together, so the budget preview can
 * show the running cost of a multi-option choice before anything is committed.
 * Nothing about that preview is authoritative — the server recomputes the cost
 * and re-checks the budget when the picks actually arrive.
 */
export function KitchenDecisionCard({
  decision,
  canParticipate,
  isBusy,
  onSubmit,
  onWithdraw,
}: {
  decision: KitchenDecisionView;
  canParticipate: boolean;
  isBusy: boolean;
  onSubmit: (optionIds: string[]) => void;
  onWithdraw: (optionId: string) => void;
}) {
  const [pending, setPending] = useState<Set<string>>(new Set());

  const pendingCost = useMemo(
    () =>
      decision.options
        .filter((option) => pending.has(option.id))
        .reduce((sum, option) => sum + option.unitCost, 0),
    [decision.options, pending],
  );

  const toggle = (optionId: string) => {
    setPending((current) => {
      const next = new Set(current);
      if (next.has(optionId)) {
        next.delete(optionId);
      } else if (next.size < decision.selectionsRemaining) {
        next.add(optionId);
      }
      return next;
    });
  };

  const submit = () => {
    if (pending.size === 0) return;
    onSubmit([...pending]);
    setPending(new Set());
  };

  const finalized = decision.status === 'FINALIZED';

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={decision.isOpen ? 'live' : finalized ? 'success' : 'neutral'} size="sm">
              {decision.isOpen ? 'Open' : decision.status.toLowerCase()}
            </Badge>
            {decision.maxSelections > 1 && (
              <Badge size="sm">Pick up to {decision.maxSelections}</Badge>
            )}
            {decision.winnerCount > 1 && (
              <Badge size="sm">Top {decision.winnerCount} are bought</Badge>
            )}
            {decision.maxQuantity !== null && (
              <Badge size="sm">Max {decision.maxQuantity} total</Badge>
            )}
          </div>

          <h2 className="text-lg font-semibold leading-tight">{decision.title}</h2>
          <p className="text-sm text-muted">{decision.question}</p>
        </div>

        {decision.isOpen && (
          <div className="shrink-0 space-y-1 sm:text-right">
            <span className="flex items-center gap-1.5 text-sm">
              <Clock className="h-4 w-4 text-muted" aria-hidden />
              <Countdown to={decision.closesAt} finishedLabel="Closing…" />
            </span>
            <p className="text-xs text-muted tabular-nums">
              {decision.totalVotes.toLocaleString()} picks so far
            </p>
          </div>
        )}
      </div>

      <BudgetMeter budget={decision.budget} pendingCost={pendingCost} />

      {decision.isOpen && decision.maxSelections > 1 && (
        <ProgressBar
          value={decision.selectionsUsed}
          max={decision.maxSelections}
          size="sm"
          tone={decision.selectionsRemaining === 0 ? 'warning' : 'primary'}
          label={`Your picks: ${decision.selectionsUsed} of ${decision.maxSelections} used`}
        />
      )}

      <VotingOptions
        decision={decision}
        pending={pending}
        canParticipate={canParticipate}
        isBusy={isBusy}
        onToggle={toggle}
        onWithdraw={onWithdraw}
      />

      {decision.isOpen && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {decision.selectionsRemaining > 0
              ? `${decision.selectionsRemaining} pick${
                  decision.selectionsRemaining === 1 ? '' : 's'
                } remaining · +${decision.participationPoints} points for taking part`
              : 'You have used all your picks. Withdraw one to change your mind.'}
          </p>

          {pending.size > 0 && (
            <Button size="sm" loading={isBusy} onClick={submit}>
              Confirm {pending.size} pick{pending.size === 1 ? '' : 's'}
            </Button>
          )}
        </div>
      )}

      {finalized && <ResultDisplay decision={decision} />}
    </Card>
  );
}
