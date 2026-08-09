'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export interface LiveState {
  show: { id: string; name: string; tagline: string | null; status: string; currencySymbol: string };
  episode: {
    id: string;
    number: number;
    title: string;
    airsAt: string;
    status: string;
    isLive: boolean;
  } | null;
  currentEvent: {
    id: string;
    type: string;
    title: string;
    description: string | null;
    occurredAt: string;
  } | null;
  isLive: boolean;
  serverTime: string;
}

export interface DashboardSummary {
  live: LiveState;
  points: { balance: number; lifetime: number; earnedToday: number };
  activity: { actionsToday: number; streak: number };
  leaderboard: { rank: number | null; totalPlayers: number };
  hottestContestants: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    heatScore: number;
    heatTrend: 'UP' | 'DOWN' | 'FLAT';
    status: string;
  }[];
  modules: {
    predictions: { open: number; nextCloseAt: string | null; awaitingYou: number };
    polls: { active: number; nextCloseAt: string | null; awaitingYou: number };
    challenges: { votingOpen: number; yoursInFlight: number };
    perspectives: { open: number; awaitingYou: number };
    nominations: { open: boolean; closesAt: string | null; votesUsed: number; voteLimit: number };
    evictions: { open: boolean; closesAt: string | null; votesUsed: number; voteLimit: number };
    kitchen: { open: number; closesAt: string | null; budgetRemaining: number | null };
    weekend: { open: boolean; deadline: string | null; submitted: boolean };
  };
}

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => api.get<DashboardSummary>('/dashboard'),
    // The dashboard is a live surface; a 30-second poll keeps counters honest
    // without a socket subscription on a page that is mostly summary data.
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useLiveState() {
  return useQuery({
    queryKey: queryKeys.show.live,
    queryFn: () => api.get<LiveState>('/show/live'),
    refetchInterval: 60_000,
  });
}
