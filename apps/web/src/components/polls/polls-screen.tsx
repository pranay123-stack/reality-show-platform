'use client';

import {
  Alert,
  Badge,
  Card,
  Countdown,
  EmptyState,
  ErrorState,
  LoadingState,
  OptionResult,
  PageHeader,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@reality/ui';
import { useQuery } from '@tanstack/react-query';
import { Clock, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';

import { useLivePoll } from '@/hooks/use-live-poll';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { PollSnapshot } from '@/lib/socket';
import { useTrackView } from '@/hooks/use-analytics';
import { useAuth } from '@/providers/auth-provider';

type Scope = 'active' | 'past';

interface PollListItem extends PollSnapshot {
  myOptionId: string | null;
}

export function PollsScreen() {
  useTrackView('poll_viewed');
  const [scope, setScope] = useState<Scope>('active');
  const { canParticipate } = useAuth();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...queryKeys.polls.all, scope],
    queryFn: () => api.get<PollListItem[]>(`/polls?scope=${scope}`),
    // The socket carries live deltas; this only needs to notice a *new* poll.
    refetchInterval: scope === 'active' ? 20_000 : false,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Polls"
        description="Vote while the episode is on air. Counts come from the server, never from your browser."
        action={
          <Tabs value={scope} onValueChange={(value) => setScope(value as Scope)}>
            <TabsList>
              <TabsTrigger value="active">Live now</TabsTrigger>
              <TabsTrigger value="past">Results</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {!canParticipate && (
        <Alert tone="warning" title="Confirm your email to vote">
          You can watch any poll as it runs; voting needs a confirmed address.
        </Alert>
      )}

      {isLoading && <LoadingState rows={2} />}
      {isError && <ErrorState onRetry={() => void refetch()} />}

      {data?.length === 0 && (
        <EmptyState
          title={scope === 'active' ? 'No poll running right now' : 'No results yet'}
          description={
            scope === 'active'
              ? 'Polls open during the live episode and usually last under a minute.'
              : 'Closed polls appear here once production publishes the result.'
          }
        />
      )}

      <div className="grid gap-4">
        {data?.map((poll) =>
          scope === 'active' ? (
            <LivePollCard key={poll.id} initial={poll} canParticipate={canParticipate} />
          ) : (
            <ClosedPollCard key={poll.id} poll={poll} />
          ),
        )}
      </div>
    </div>
  );
}

function LivePollCard({
  initial,
  canParticipate,
}: {
  initial: PollListItem;
  canParticipate: boolean;
}) {
  const { poll, myOptionId, connected, resyncing, isVoting, vote } = useLivePoll(initial.id);

  // The list response seeds the card so it renders immediately; the socket
  // snapshot replaces it as soon as the join ack lands.
  const current = poll ?? initial;
  const selected = myOptionId ?? initial.myOptionId;
  const isOpen = current.status === 'ACTIVE';
  const hasVoted = Boolean(selected);
  const counts = current.counts;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <Badge tone={isOpen ? 'live' : 'neutral'} size="sm">
              {isOpen ? 'Live' : current.status.toLowerCase()}
            </Badge>
            <ConnectionPill connected={connected} resyncing={resyncing} />
          </div>
          <h2 className="text-lg font-semibold leading-tight">{current.question}</h2>
          {current.description && <p className="text-sm text-muted">{current.description}</p>}
        </div>

        {current.closesAt && isOpen && (
          <span className="flex items-center gap-1.5 text-sm">
            <Clock className="h-4 w-4 text-muted" aria-hidden />
            <Countdown to={current.closesAt} finishedLabel="Closing…" />
          </span>
        )}
      </div>

      <div className="space-y-2">
        {current.options.map((option) => {
          const canVote = isOpen && !hasVoted && canParticipate;

          if (canVote) {
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => vote(option.id)}
                disabled={isVoting}
                className="w-full rounded-md border border-border bg-surface-raised px-4 py-3 text-left text-sm font-medium transition-colors hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                {option.contestantName ?? option.label}
              </button>
            );
          }

          const voteCount = counts?.find((count) => count.optionId === option.id)?.voteCount ?? 0;

          return (
            <OptionResult
              key={option.id}
              label={option.contestantName ?? option.label}
              votes={voteCount}
              total={current.totalVotes}
              selected={option.id === selected}
              // Counts stay hidden until this viewer has voted — seeing the
              // crowd first would change the vote.
              hideCounts={counts === null}
            />
          );
        })}
      </div>

      <p className="text-xs text-muted tabular-nums">
        {counts === null
          ? 'Results appear once you vote'
          : `${current.totalVotes.toLocaleString()} votes`}
      </p>
    </Card>
  );
}

function ClosedPollCard({ poll }: { poll: PollListItem }) {
  const leader = poll.counts
    ? [...poll.counts].sort((a, b) => b.voteCount - a.voteCount)[0]
    : undefined;
  const runnerUp = poll.counts
    ? [...poll.counts].sort((a, b) => b.voteCount - a.voteCount)[1]
    : undefined;
  const winnerId =
    leader && leader.voteCount > 0 && leader.voteCount !== runnerUp?.voteCount
      ? leader.optionId
      : null;

  return (
    <Card className="space-y-4 p-5">
      <div className="space-y-1.5">
        <Badge size="sm">{poll.status.toLowerCase()}</Badge>
        <h2 className="text-lg font-semibold leading-tight">{poll.question}</h2>
      </div>

      <div className="space-y-2">
        {poll.options.map((option) => (
          <OptionResult
            key={option.id}
            label={option.contestantName ?? option.label}
            votes={poll.counts?.find((count) => count.optionId === option.id)?.voteCount ?? 0}
            total={poll.totalVotes}
            selected={option.id === poll.myOptionId}
            winner={option.id === winnerId}
          />
        ))}
      </div>

      <p className="text-xs text-muted tabular-nums">
        {poll.totalVotes.toLocaleString()} votes
        {winnerId === null && poll.totalVotes > 0 && ' · no clear winner'}
      </p>
    </Card>
  );
}

function ConnectionPill({ connected, resyncing }: { connected: boolean; resyncing: boolean }) {
  if (resyncing) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-warning" role="status">
        <WifiOff className="h-3 w-3" aria-hidden />
        Reconnecting…
      </span>
    );
  }

  return connected ? (
    <span className="inline-flex items-center gap-1 text-xs text-success" role="status">
      <Wifi className="h-3 w-3" aria-hidden />
      Live
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-muted" role="status">
      <WifiOff className="h-3 w-3" aria-hidden />
      Offline
    </span>
  );
}
