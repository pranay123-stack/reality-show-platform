'use client';

import {
  Alert,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@reality/ui';
import { useState } from 'react';

import { KitchenDecisionCard } from '@/components/kitchen/kitchen-decision-card';
import { useKitchenDecisions, useKitchenVote, type KitchenScope } from '@/hooks/use-kitchen';
import { useAuth } from '@/providers/auth-provider';

export function KitchenScreen() {
  const [scope, setScope] = useState<KitchenScope>('open');
  const { canParticipate } = useAuth();
  const { data, isLoading, isError, refetch } = useKitchenDecisions(scope);
  const { cast, withdraw } = useKitchenVote(scope);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kitchen Battle"
        description="Help decide what the house eats — within the budget production has set."
        action={
          <Tabs value={scope} onValueChange={(value) => setScope(value as KitchenScope)}>
            <TabsList>
              <TabsTrigger value="open">Open now</TabsTrigger>
              <TabsTrigger value="finalized">Decided</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      <Alert tone="info" title="You choose the food, not the budget">
        The house budget is set by production. You can influence what it is spent on; what the house
        actually receives is decided and recorded by the production team.
      </Alert>

      {!canParticipate && (
        <Alert tone="warning" title="Confirm your email to take part">
          You can follow every decision; picking needs a confirmed address.
        </Alert>
      )}

      {isLoading && <LoadingState rows={2} />}
      {isError && <ErrorState onRetry={() => void refetch()} />}

      {data?.length === 0 && (
        <EmptyState
          title={scope === 'open' ? 'No kitchen decision open' : 'Nothing decided yet'}
          description={
            scope === 'open'
              ? 'Decisions open when production needs the audience to weigh in on the menu.'
              : 'Once a decision closes, the result appears here.'
          }
        />
      )}

      <div className="grid gap-4">
        {data?.map((decision) => (
          <KitchenDecisionCard
            key={decision.id}
            decision={decision}
            canParticipate={canParticipate}
            isBusy={
              (cast.isPending && cast.variables?.decisionId === decision.id) ||
              (withdraw.isPending && withdraw.variables?.decisionId === decision.id)
            }
            onSubmit={(optionIds) => cast.mutate({ decisionId: decision.id, optionIds })}
            onWithdraw={(optionId) => withdraw.mutate({ decisionId: decision.id, optionId })}
          />
        ))}
      </div>
    </div>
  );
}
