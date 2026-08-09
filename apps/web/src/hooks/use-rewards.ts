'use client';

import type { RedemptionView, RewardView, UserLevelView } from '@reality/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * Reward data.
 *
 * Nothing here is optimistic. A redemption moves points and takes a unit of
 * scarce stock, and both of those are decided by the server under contention —
 * showing a guessed outcome and correcting it a moment later would be worse
 * than a short spinner.
 */

export function useRewards() {
  return useQuery({
    queryKey: queryKeys.rewards.catalogue,
    queryFn: () => api.get<RewardView[]>('/rewards'),
    staleTime: 30_000,
  });
}

export function useReward(id: string) {
  return useQuery({
    queryKey: [...queryKeys.rewards.catalogue, id],
    queryFn: () => api.get<RewardView>(`/rewards/${id}`),
  });
}

export function useMyRedemptions() {
  return useQuery({
    queryKey: queryKeys.rewards.mine,
    queryFn: () => api.get<RedemptionView[]>('/rewards/me/redemptions'),
  });
}

export function useMyLevel() {
  return useQuery({
    queryKey: [...queryKeys.rewards.mine, 'level'],
    queryFn: () => api.get<UserLevelView>('/rewards/me/level'),
    staleTime: 30_000,
  });
}

/** Everything a redemption touches: the catalogue, your history, your balance. */
function useRewardInvalidation() {
  const queryClient = useQueryClient();

  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.rewards.catalogue }),
      queryClient.invalidateQueries({ queryKey: queryKeys.rewards.mine }),
      queryClient.invalidateQueries({ queryKey: queryKeys.points.balance }),
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.me }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
    ]);
}

export interface RedeemResult {
  redemption: RedemptionView;
  pointsSpent: number;
  balance: number;
}

export function useRedeemReward() {
  const invalidate = useRewardInvalidation();

  return useMutation({
    mutationFn: (rewardId: string) => api.post<RedeemResult>(`/rewards/${rewardId}/redeem`, {}),
    onSuccess: async (result) => {
      toast.success(
        result.redemption.status === 'FULFILLED'
          ? `${result.redemption.reward.name} is yours`
          : `Requested · production will confirm ${result.redemption.reward.name}`,
      );
      await invalidate();
    },
    onError: async (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not redeem that reward');
      // Whatever went wrong, the server knows the real stock and balance.
      await invalidate();
    },
  });
}

export function useCancelRedemption() {
  const invalidate = useRewardInvalidation();

  return useMutation({
    mutationFn: (redemptionId: string) =>
      api.post<RedemptionView>(`/rewards/me/redemptions/${redemptionId}/cancel`, {}),
    onSuccess: async (redemption) => {
      toast.success(
        redemption.refunded
          ? `Cancelled · ${redemption.pointsSpent.toLocaleString()} points returned`
          : 'Redemption cancelled',
      );
      await invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not cancel that redemption'),
  });
}
