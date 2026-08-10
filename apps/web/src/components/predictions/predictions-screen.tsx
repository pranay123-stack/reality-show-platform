'use client';

import type { PredictionView } from '@reality/shared';
import {
  Alert,
  EmptyState,
  ErrorState,
  LoadingState,
  PredictionCard,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@reality/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useTrackView } from '@/hooks/use-analytics';
import { useAuth } from '@/providers/auth-provider';

type Scope = 'open' | 'mine' | 'resolved';

export function PredictionsScreen() {
  useTrackView('prediction_viewed');
  const [scope, setScope] = useState<Scope>('open');
  const { canParticipate } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.predictions.list({ scope }),
    queryFn: () => api.get<PredictionView[]>(`/predictions?scope=${scope}`),
    staleTime: 15_000,
  });

  const submit = useMutation({
    mutationFn: ({ predictionId, optionId }: { predictionId: string; optionId: string }) =>
      api.post<{ pointsAwarded: number; balance: number }>(
        `/predictions/${predictionId}/entries`,
        { optionId },
      ),
    onSuccess: async (result) => {
      toast.success(
        result.pointsAwarded > 0
          ? `Prediction locked in · +${result.pointsAwarded} points`
          : 'Prediction locked in',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.predictions.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.me }),
      ]);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not submit your prediction');
      // The server is the authority on whether the question is still open.
      void queryClient.invalidateQueries({ queryKey: queryKeys.predictions.all });
    },
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-display-md font-semibold">Prediction Game</h1>
          <p className="text-muted">
            Call what happens next. One prediction per question, locked once you submit.
          </p>
        </div>

        <Tabs value={scope} onValueChange={(value) => setScope(value as Scope)}>
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="mine">Mine</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {!canParticipate && (
        <Alert tone="warning" title="Confirm your email to predict">
          You can read every question, but submitting needs a confirmed address.
        </Alert>
      )}

      {isLoading && <LoadingState rows={3} />}
      {isError && <ErrorState onRetry={() => void refetch()} />}

      {data && data.length === 0 && (
        <EmptyState
          title={
            scope === 'open'
              ? 'No predictions open right now'
              : scope === 'mine'
                ? 'You have not predicted yet'
                : 'Nothing resolved yet'
          }
          description={
            scope === 'open'
              ? 'New questions appear as the episode goes on.'
              : 'Open questions appear on the Open tab.'
          }
        />
      )}

      <div className="grid gap-4">
        {data?.map((prediction) => (
          <PredictionCard
            key={prediction.id}
            question={prediction.question}
            description={prediction.description}
            status={prediction.status}
            options={prediction.options.map((option) => ({
              id: option.id,
              label: option.contestantName ?? option.label,
              voteCount: option.entryCount,
            }))}
            closesAt={prediction.closesAt}
            rewardPoints={prediction.rewardPoints}
            participationPoints={prediction.participationPoints}
            entryCount={prediction.entryCount}
            selectedOptionId={prediction.myOptionId}
            correctOptionId={prediction.correctOptionId}
            isSubmitting={submit.isPending && submit.variables?.predictionId === prediction.id}
            disabledReason={
              !canParticipate
                ? 'Confirm your email to take part'
                : prediction.isClosed
                  ? 'Closed'
                  : undefined
            }
            onSelect={
              canParticipate && !prediction.isClosed
                ? (optionId) => submit.mutate({ predictionId: prediction.id, optionId })
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
