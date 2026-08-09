'use client';

import type { KitchenDecisionView } from '@reality/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export type KitchenScope = 'open' | 'finalized';

export function useKitchenDecisions(scope: KitchenScope) {
  return useQuery({
    queryKey: [...queryKeys.kitchen.current, scope],
    queryFn: () => api.get<KitchenDecisionView[]>(`/kitchen?scope=${scope}`),
    staleTime: 15_000,
    refetchInterval: scope === 'open' ? 30_000 : false,
  });
}

/**
 * Casting and withdrawing a pick.
 *
 * No optimistic update: budget arithmetic and the remaining allowance are both
 * server-side, and guessing them locally would show a number the server might
 * disagree with a moment later.
 */
export function useKitchenVote(scope: KitchenScope) {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.kitchen.current }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.me }),
    ]);
  };

  const cast = useMutation({
    mutationFn: ({ decisionId, optionIds }: { decisionId: string; optionIds: string[] }) =>
      api.post<{ selectionsRemaining: number; pointsAwarded: number }>(
        `/kitchen/${decisionId}/votes`,
        { optionIds },
      ),
    onSuccess: async (result) => {
      toast.success(
        result.pointsAwarded > 0
          ? `Pick recorded · +${result.pointsAwarded} points`
          : 'Pick recorded',
      );
      await invalidate();
    },
    onError: async (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not record your pick');
      // The server is the authority on the budget and on what is still open.
      await invalidate();
    },
  });

  const withdraw = useMutation({
    mutationFn: ({ decisionId, optionId }: { decisionId: string; optionId: string }) =>
      api.delete(`/kitchen/${decisionId}/votes`, { body: { optionId } }),
    onSuccess: async () => {
      toast.success('Pick withdrawn');
      await invalidate();
    },
    onError: async (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not withdraw that pick');
      await invalidate();
    },
  });

  return { cast, withdraw, scope };
}
