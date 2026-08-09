'use client';

import type { EligibilityView } from '@reality/shared';
import { Card, CardContent, CardHeader, CardTitle, cn } from '@reality/ui';
import { Check, Lock, X } from 'lucide-react';

/**
 * Why someone can or cannot take part.
 *
 * A bare "you are not eligible" is useless — it tells a person nothing about
 * what to do next. Every requirement is shown with its current value against
 * the target, so the gap is always visible and always actionable.
 */
export function EligibilityPanel({ eligibility }: { eligibility: EligibilityView }) {
  return (
    <Card className={cn(eligibility.eligible ? 'border-success/40' : 'border-border')}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {eligibility.eligible ? (
            <Check className="h-4 w-4 text-success" aria-hidden />
          ) : (
            <Lock className="h-4 w-4 text-muted" aria-hidden />
          )}
          {eligibility.eligible ? 'You can take part' : 'Not eligible yet'}
        </CardTitle>
        {!eligibility.eligible && eligibility.blockers.length > 0 && (
          <p className="text-xs text-muted">
            Eligibility is earned by joining in across the show — it cannot be bought.
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {eligibility.requirements.length === 0 ? (
          <p className="text-sm text-muted">{eligibility.blockers[0]}</p>
        ) : (
          <ul className="space-y-2">
            {eligibility.requirements.map((requirement) => (
              <li key={requirement.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  {requirement.met ? (
                    <Check className="h-4 w-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <X className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                  )}
                  <span className={requirement.met ? 'text-muted' : 'text-foreground'}>
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
        )}

        {eligibility.blockers.length > 0 && eligibility.requirements.length > 0 && (
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
