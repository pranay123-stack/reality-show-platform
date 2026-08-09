'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export interface ContestantSummary {
  id: string;
  slug: string;
  displayName: string;
  tagline: string | null;
  avatarUrl: string | null;
  occupation: string | null;
  hometown: string | null;
  age: number | null;
  status: string;
  heatScore: number;
  heatTrend: 'UP' | 'DOWN' | 'FLAT';
  heatUpdatedAt: string | null;
}

export interface ContestantDetail extends ContestantSummary {
  bio: string | null;
  enteredAt: string | null;
  exitedAt: string | null;
  rank: number;
  audienceSupport: { votesLast7Days: number; shareOfAllVotes: number };
  recentEvents: {
    id: string;
    type: string;
    title: string;
    description: string | null;
    occurredAt: string;
  }[];
  relatedPolls: {
    id: string;
    question: string;
    status: string;
    votesForContestant: number;
    totalVotes: number;
  }[];
  relatedPerspectives: {
    id: string;
    question: string;
    status: string;
    optionLabel: string;
    votesForOption: number;
    totalVotes: number;
  }[];
}

export interface HeatHistory {
  window: string;
  points: { at: string; score: number }[];
  min: number | null;
  max: number | null;
  change: number;
}

export function useContestants(sort: 'heat' | 'name' = 'heat') {
  return useQuery({
    queryKey: queryKeys.contestants.list({ sort }),
    queryFn: () => api.get<ContestantSummary[]>(`/contestants?sort=${sort}`),
    staleTime: 30_000,
  });
}

export function useContestant(id: string) {
  return useQuery({
    queryKey: queryKeys.contestants.detail(id),
    queryFn: () => api.get<ContestantDetail>(`/contestants/${id}`),
    enabled: Boolean(id),
  });
}

export function useHeatHistory(id: string, window: '24h' | '7d' | 'season') {
  return useQuery({
    queryKey: queryKeys.contestants.heat(id, window),
    queryFn: () => api.get<HeatHistory>(`/contestants/${id}/heat?window=${window}`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}
