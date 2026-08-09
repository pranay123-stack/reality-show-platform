'use client';

import type { ChallengeModerationView, ChallengeView } from '@reality/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export type ChallengeScope = 'voting' | 'top' | 'selected' | 'mine';

interface ChallengePage {
  items: ChallengeView[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function useChallengeFeed(scope: ChallengeScope) {
  return useQuery({
    queryKey: queryKeys.challenges.feed({ scope }),
    queryFn: () => api.get<ChallengePage>(`/challenges?scope=${scope}`),
    staleTime: 15_000,
  });
}

export function useChallenge(id: string) {
  return useQuery({
    queryKey: queryKeys.challenges.detail(id),
    queryFn: () => api.get<ChallengeView>(`/challenges/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * Voting is optimistic on the caller's own chip only — the count comes back
 * from the server, which is the only place it is authoritative.
 */
export function useChallengeVote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, voted }: { id: string; voted: boolean }) =>
      voted
        ? api.delete<{ voteCount: number }>(`/challenges/${id}/vote`)
        : api.post<{ voteCount: number }>(`/challenges/${id}/vote`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.challenges.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not record your vote');
      void queryClient.invalidateQueries({ queryKey: queryKeys.challenges.all });
    },
  });
}

export function useReportChallenge() {
  return useMutation({
    mutationFn: ({ id, reason, details }: { id: string; reason: string; details?: string }) =>
      api.post(`/challenges/${id}/report`, { reason, details }),
    onSuccess: () => toast.success('Reported. A moderator will take a look.'),
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not send that report'),
  });
}

export function useModerationQueue(reportedOnly = false) {
  return useQuery({
    queryKey: queryKeys.admin.section('challenge-queue', { reportedOnly }),
    queryFn: () =>
      api.get<ChallengeModerationView[]>(`/challenges/admin/queue?reportedOnly=${reportedOnly}`),
    refetchInterval: 30_000,
  });
}

export function useModerateChallenge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      decision,
      reason,
    }: {
      id: string;
      decision: 'APPROVE' | 'REJECT' | 'ESCALATE';
      reason?: string;
    }) => api.post(`/challenges/admin/${id}/moderate`, { decision, reason }),
    onSuccess: async (_data, variables) => {
      toast.success(
        variables.decision === 'APPROVE'
          ? 'Approved'
          : variables.decision === 'REJECT'
            ? 'Rejected'
            : 'Escalated',
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.section('challenge-queue') });
      await queryClient.invalidateQueries({ queryKey: queryKeys.challenges.all });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not record that decision'),
  });
}
