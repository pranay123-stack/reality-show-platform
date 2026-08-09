'use client';

import type { KitchenBudgetView } from '@reality/shared';
import { cn } from '@reality/ui';
import { Wallet } from 'lucide-react';

/**
 * The house food budget.
 *
 * Deliberately read-only. The audience influences *what* is bought, never how
 * much money there is — there is no control here that could change a number,
 * and the API would refuse one anyway.
 */
export function BudgetMeter({
  budget,
  /** Cost of the picks currently being considered, previewed against remaining. */
  pendingCost = 0,
  className,
}: {
  budget: KitchenBudgetView;
  pendingCost?: number;
  className?: string;
}) {
  const symbol = budget.currencySymbol;
  const spentPercent = budget.totalUnits > 0 ? (budget.spentUnits / budget.totalUnits) * 100 : 0;
  const pendingPercent =
    budget.totalUnits > 0 ? Math.min(100 - spentPercent, (pendingCost / budget.totalUnits) * 100) : 0;

  const afterPending = budget.remainingUnits - pendingCost;
  const tone =
    afterPending < 0 ? 'text-danger' : spentPercent > 80 ? 'text-warning' : 'text-foreground';

  return (
    <div className={cn('rounded-md border border-border bg-surface-raised p-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-muted">
          <Wallet className="h-4 w-4" aria-hidden />
          {budget.label}
        </span>
        <span className={cn('font-mono text-sm font-semibold tabular-nums', tone)}>
          {symbol}
          {Math.max(0, afterPending).toLocaleString()} left
        </span>
      </div>

      <div
        className="mt-2.5 flex h-2.5 w-full overflow-hidden rounded-full bg-surface-overlay"
        role="img"
        aria-label={`Budget: ${symbol}${budget.spentUnits.toLocaleString()} of ${symbol}${budget.totalUnits.toLocaleString()} spent${
          pendingCost > 0 ? `, ${symbol}${pendingCost.toLocaleString()} pending` : ''
        }`}
      >
        <div
          className="h-full bg-accent transition-[width] duration-500"
          style={{ width: `${Math.min(100, spentPercent)}%` }}
        />
        {pendingPercent > 0 && (
          <div
            className="h-full bg-primary/60 transition-[width] duration-300"
            style={{ width: `${pendingPercent}%` }}
          />
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-between text-xs text-muted tabular-nums">
        <span>
          {symbol}
          {budget.spentUnits.toLocaleString()} spent of {symbol}
          {budget.totalUnits.toLocaleString()}
        </span>
        {pendingCost > 0 && (
          <span className="text-primary">
            {symbol}
            {pendingCost.toLocaleString()} selected
          </span>
        )}
      </div>

      {afterPending < 0 && (
        <p className="mt-2 text-xs text-danger" role="alert">
          That is more than the house has left.
        </p>
      )}
    </div>
  );
}
