'use client';

import type { KitchenDecisionView } from '@reality/shared';
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, cn } from '@reality/ui';
import { ChefHat, Info, Users } from 'lucide-react';

/**
 * Two results, never merged.
 *
 * `audienceResult` is what people voted for. `implementedResult` is what the
 * house actually received. They are rendered as two separate cards, and where
 * the second is missing the UI says so in plain words rather than letting the
 * first stand in for it.
 */
export function ResultDisplay({ decision }: { decision: KitchenDecisionView }) {
  const { audienceResult, implementedResult, budget } = decision;
  if (!audienceResult) return null;

  const symbol = budget.currencySymbol;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-accent" aria-hidden />
              What the audience chose
            </CardTitle>
            <p className="text-xs text-muted">
              {audienceResult.totalVotes.toLocaleString()} votes · {symbol}
              {audienceResult.totalCost.toLocaleString()} of budget
            </p>
          </CardHeader>

          <CardContent className="space-y-3">
            {audienceResult.selected.length === 0 ? (
              <p className="text-sm text-muted">Nobody voted, so nothing was chosen.</p>
            ) : (
              audienceResult.selected.map((line) => (
                <div key={line.optionId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">
                    {line.label}
                    {line.quantity !== null && (
                      <span className="ml-1.5 text-muted">
                        {line.quantity}
                        {line.unit ? ` ${line.unit}` : ''}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                    {line.percentage}% · {symbol}
                    {line.unitCost.toLocaleString()}
                  </span>
                </div>
              ))
            )}

            {audienceResult.skipped.length > 0 && (
              <div className="space-y-1.5 border-t border-border pt-3">
                <p className="text-xs font-medium text-muted">Wanted, but not possible</p>
                {audienceResult.skipped.map((line) => (
                  <div
                    key={line.optionId}
                    className="flex items-center justify-between gap-3 text-xs text-muted"
                  >
                    <span>{line.label}</span>
                    <Badge tone={line.reason === 'BUDGET' ? 'warning' : 'neutral'} size="sm">
                      {SKIP_REASON[line.reason]}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={cn(implementedResult ? 'border-success/40' : 'border-dashed')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ChefHat
                className={cn('h-4 w-4', implementedResult ? 'text-success' : 'text-muted')}
                aria-hidden
              />
              What the house actually got
            </CardTitle>
            <p className="text-xs text-muted">Recorded by the production team.</p>
          </CardHeader>

          <CardContent className="space-y-3">
            {implementedResult ? (
              <>
                {implementedResult.selected.map((line) => (
                  <div key={line.optionId} className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">
                      {line.label}
                      {line.quantity !== null && (
                        <span className="ml-1.5 text-muted">
                          {line.quantity}
                          {line.unit ? ` ${line.unit}` : ''}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                      {symbol}
                      {line.unitCost.toLocaleString()}
                    </span>
                  </div>
                ))}

                <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-xs">
                  <Badge tone={implementedResult.matchesAudience ? 'success' : 'warning'} size="sm">
                    {implementedResult.matchesAudience
                      ? 'Matched the audience'
                      : 'Differed from the audience'}
                  </Badge>
                  <span className="font-mono tabular-nums text-muted">
                    {symbol}
                    {implementedResult.totalCost.toLocaleString()} spent
                  </span>
                </div>

                {implementedResult.note && (
                  <p className="text-sm text-muted">{implementedResult.note}</p>
                )}
              </>
            ) : (
              <p className="flex items-start gap-2 text-sm text-muted">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Not recorded yet. What the audience chose does not decide this on its own.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Alert tone="info">{decision.disclaimer}</Alert>
    </div>
  );
}

const SKIP_REASON: Record<'BUDGET' | 'QUANTITY' | 'WINNER_LIMIT', string> = {
  BUDGET: 'over budget',
  QUANTITY: 'over the quantity limit',
  WINNER_LIMIT: 'not enough places',
};
