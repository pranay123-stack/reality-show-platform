'use client';

import type { KitchenDecisionView, KitchenOptionView } from '@reality/shared';
import { Badge, Button, OptionResult, cn } from '@reality/ui';
import { Check, Lock } from 'lucide-react';

/**
 * The option list.
 *
 * While a decision is open this is a set of choices; once it is finalised the
 * same list becomes a result read-out. Keeping both in one component means the
 * two views cannot drift apart in layout or wording.
 */
export function VotingOptions({
  decision,
  pending,
  canParticipate,
  isBusy,
  onToggle,
  onWithdraw,
}: {
  decision: KitchenDecisionView;
  pending: Set<string>;
  canParticipate: boolean;
  isBusy: boolean;
  onToggle: (optionId: string) => void;
  onWithdraw: (optionId: string) => void;
}) {
  const finalized = decision.status === 'FINALIZED';

  if (finalized) {
    return (
      <div className="space-y-2">
        {decision.options.map((option) => (
          <OptionResult
            key={option.id}
            label={optionLabel(option, decision.budget.currencySymbol)}
            votes={option.voteCount}
            total={decision.totalVotes}
            selected={option.selectedByMe}
            winner={
              decision.audienceResult?.selected.some((line) => line.optionId === option.id) ?? false
            }
          />
        ))}
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {decision.options.map((option) => {
        const chosen = option.selectedByMe;
        const staged = pending.has(option.id);
        const noPicksLeft = decision.selectionsRemaining === 0 && !staged;
        const blocked = !option.affordable || !decision.isOpen || !canParticipate;

        return (
          <li key={option.id}>
            <div
              className={cn(
                'flex items-center justify-between gap-3 rounded-md border p-3 transition-colors',
                chosen
                  ? 'border-primary/50 bg-primary/10'
                  : staged
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border bg-surface-raised',
                !option.affordable && 'opacity-60',
              )}
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {option.label}
                  {option.quantity !== null && (
                    <Badge size="sm">
                      {option.quantity}
                      {option.unit ? ` ${option.unit}` : ''}
                    </Badge>
                  )}
                  {option.kind !== 'MENU' && <Badge size="sm">{option.kind.toLowerCase()}</Badge>}
                </p>
                <p className="mt-0.5 text-xs text-muted tabular-nums">
                  {decision.budget.currencySymbol}
                  {option.unitCost.toLocaleString()}
                  {!option.affordable && ' · more than the house has left'}
                </p>
              </div>

              {chosen ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!decision.isOpen || isBusy}
                  onClick={() => onWithdraw(option.id)}
                >
                  <Check className="h-4 w-4" aria-hidden />
                  Picked
                </Button>
              ) : blocked ? (
                <Button size="sm" variant="ghost" disabled aria-label="Cannot pick this option">
                  <Lock className="h-4 w-4" aria-hidden />
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant={staged ? 'primary' : 'outline'}
                  disabled={noPicksLeft || isBusy}
                  onClick={() => onToggle(option.id)}
                >
                  {staged ? 'Selected' : 'Pick'}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function optionLabel(option: KitchenOptionView, symbol: string): string {
  const quantity = option.quantity !== null ? ` (${option.quantity}${option.unit ? ` ${option.unit}` : ''})` : '';
  return `${option.label}${quantity} · ${symbol}${option.unitCost.toLocaleString()}`;
}
