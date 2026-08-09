'use client';

import type {
  CommunityView,
  ConnectionView,
  LeaderboardScope,
  LeaderboardView,
  LeaderboardWindow,
} from '@reality/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * Leaderboard data.
 *
 * The board is a projection that trails the ledger by a moment, so a short
 * `staleTime` with background refetching fits it better than aggressive
 * invalidation: the number is *meant* to be a snapshot of a second ago, and
 * flickering it on every points event would be worse than being slightly behind.
 */

export interface LeaderboardParams {
  scope: LeaderboardScope;
  window: LeaderboardWindow;
  communityId?: string;
}

function pathFor({ scope, window, communityId }: LeaderboardParams): string {
  if (scope === 'FRIENDS') return `/leaderboards/friends?window=${window}`;
  if (scope === 'COMMUNITY') {
    return `/leaderboards/community?window=${window}&communityId=${communityId ?? ''}`;
  }
  return `/leaderboards?window=${window}`;
}

export function useLeaderboard(params: LeaderboardParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.leaderboards.board(params.scope, params),
    queryFn: () => api.get<LeaderboardView>(pathFor(params)),
    enabled: enabled && (params.scope !== 'COMMUNITY' || Boolean(params.communityId)),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
}

export function useCommunities() {
  return useQuery({
    queryKey: [...queryKeys.leaderboards.all, 'communities'],
    queryFn: () => api.get<CommunityView[]>('/leaderboards/communities'),
    staleTime: 120_000,
  });
}

export function useConnections() {
  return useQuery({
    queryKey: [...queryKeys.leaderboards.all, 'connections'],
    queryFn: () => api.get<ConnectionView[]>('/leaderboards/connections'),
  });
}

function useLeaderboardInvalidation() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.leaderboards.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
    ]);
}

export function useJoinCommunity() {
  const invalidate = useLeaderboardInvalidation();

  return useMutation({
    mutationFn: ({ id, join }: { id: string; join: boolean }) =>
      api.post(`/leaderboards/communities/${id}/${join ? 'join' : 'leave'}`, {}),
    onSuccess: async (_result, variables) => {
      toast.success(variables.join ? 'Joined' : 'Left');
      await invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not update that community'),
  });
}

export function useUpdatePrivacy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { leaderboardVisible?: boolean }) =>
      api.patch('/leaderboards/me/privacy', input),
    onSuccess: async (_result, input) => {
      toast.success(
        input.leaderboardVisible === false
          ? 'You are hidden from public rankings'
          : 'You appear in public rankings',
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.leaderboards.all });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not change that setting'),
  });
}

export function useRespondToConnection() {
  const invalidate = useLeaderboardInvalidation();

  return useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      api.post(`/leaderboards/connections/${id}/respond`, { accept }),
    onSuccess: async (_result, variables) => {
      toast.success(variables.accept ? 'Friend added' : 'Request declined');
      await invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not answer that request'),
  });
}
