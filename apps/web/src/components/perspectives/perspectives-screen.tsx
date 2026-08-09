'use client';

import type { PerspectiveAnalytics, PerspectiveView } from '@reality/shared';
import {
  Alert,
  Badge,
  Card,
  CardContent,
  Countdown,
  EmptyState,
  ErrorState,
  LoadingState,
  OptionResult,
  StatCard,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@reality/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, MessagesSquare, Scale, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

type Scope = 'open' | 'closed' | 'mine';

export function PerspectivesScreen() {
  const [scope, setScope] = useState<Scope>('open');
  const { canParticipate } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.perspectives.list({ scope }),
    queryFn: () => api.get<PerspectiveView[]>(`/perspectives?scope=${scope}`),
    staleTime: 15_000,
  });

  const vote = useMutation({
    mutationFn: ({ perspectiveId, optionId }: { perspectiveId: string; optionId: string }) =>
      api.post<{ pointsAwarded: number }>(`/perspectives/${perspectiveId}/vote`, { optionId }),
    onSuccess: async (result) => {
      toast.success(
        result.pointsAwarded > 0 ? `Thanks — +${result.pointsAwarded} points` : 'Thanks',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.perspectives.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not record your answer');
      void queryClient.invalidateQueries({ queryKey: queryKeys.perspectives.all });
    },
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-display-md font-semibold">Audience Perspective</h1>
          <p className="text-muted">
            Say what you think about something that already happened in the house.
          </p>
        </div>

        <Tabs value={scope} onValueChange={(value) => setScope(value as Scope)}>
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="closed">Past</TabsTrigger>
            <TabsTrigger value="mine">Mine</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      <Alert tone="info">
        This is not a live poll. Live polls decide something happening <em>now</em>; a perspective
        asks what you made of an event that is already over — so the running split stays visible
        while voting is open.
      </Alert>

      {!canParticipate && (
        <Alert tone="warning" title="Confirm your email to answer">
          You can read every result; answering needs a confirmed address.
        </Alert>
      )}

      {isLoading && <LoadingState rows={3} />}
      {isError && <ErrorState onRetry={() => void refetch()} />}

      {data?.length === 0 && (
        <EmptyState
          title={
            scope === 'open'
              ? 'Nothing open for comment'
              : scope === 'mine'
                ? 'You have not answered any yet'
                : 'Nothing has closed yet'
          }
          description="Perspectives appear after a notable event in the house."
        />
      )}

      <div className="grid gap-4">
        {data?.map((perspective) => (
          <PerspectiveCard
            key={perspective.id}
            perspective={perspective}
            canParticipate={canParticipate}
            isSubmitting={vote.isPending && vote.variables?.perspectiveId === perspective.id}
            onVote={(optionId) => vote.mutate({ perspectiveId: perspective.id, optionId })}
          />
        ))}
      </div>

      <AnalyticsPanel />
    </div>
  );
}

function PerspectiveCard({
  perspective,
  canParticipate,
  isSubmitting,
  onVote,
}: {
  perspective: PerspectiveView;
  canParticipate: boolean;
  isSubmitting: boolean;
  onVote: (optionId: string) => void;
}) {
  const canAnswer = canParticipate && !perspective.isClosed && !perspective.myOptionId;

  return (
    <Card className="space-y-4 p-5">
      {/* The event is the anchor — without it this would just be a poll. */}
      <div className="rounded-md border border-border bg-surface-raised p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge size="sm">{perspective.event.type.toLowerCase()}</Badge>
          <span className="text-sm font-medium">{perspective.event.title}</span>
          <span className="text-xs text-muted">
            {new Date(perspective.event.occurredAt).toLocaleString()}
          </span>
        </div>
        {perspective.event.description && (
          <p className="mt-1 text-sm text-muted">{perspective.event.description}</p>
        )}
        {perspective.event.contestants.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {perspective.event.contestants.map((contestant) => (
              <Link
                key={contestant.id}
                href={`/contestants/${contestant.id}`}
                className="text-xs text-primary underline-offset-4 hover:underline"
              >
                {contestant.displayName}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold leading-tight">{perspective.question}</h2>
          {perspective.description && (
            <p className="text-sm text-muted">{perspective.description}</p>
          )}
        </div>

        {!perspective.isClosed && (
          <span className="flex items-center gap-1.5 text-sm">
            <Clock className="h-4 w-4 text-muted" aria-hidden />
            <Countdown to={perspective.closesAt} finishedLabel="Closing…" />
          </span>
        )}
      </div>

      <div className="space-y-2">
        {perspective.options.map((option) =>
          canAnswer ? (
            <button
              key={option.id}
              type="button"
              onClick={() => onVote(option.id)}
              disabled={isSubmitting}
              className="w-full rounded-md border border-border bg-surface-raised px-4 py-3 text-left text-sm font-medium transition-colors hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {option.label}
              {option.contestantName && (
                <span className="ml-2 text-xs text-muted">{option.contestantName}</span>
              )}
            </button>
          ) : (
            <OptionResult
              key={option.id}
              label={option.label}
              votes={option.voteCount}
              total={perspective.totalVotes}
              selected={option.id === perspective.myOptionId}
              winner={perspective.isClosed && option.id === perspective.leadingOptionId}
            />
          ),
        )}
      </div>

      <p className="text-xs text-muted tabular-nums">
        {perspective.totalVotes.toLocaleString()}{' '}
        {perspective.totalVotes === 1 ? 'answer' : 'answers'}
        {perspective.isClosed && ' · closed'}
      </p>
    </Card>
  );
}

function AnalyticsPanel() {
  const { data } = useQuery({
    queryKey: queryKeys.perspectives.list({ view: 'analytics' }),
    queryFn: () => api.get<PerspectiveAnalytics>('/perspectives/analytics'),
    staleTime: 60_000,
  });

  if (!data || data.totalPerspectives === 0) return null;

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
        How the audience has judged things
      </h2>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Questions asked"
          value={data.totalPerspectives}
          icon={<MessagesSquare className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label="Answers given"
          value={data.totalVotes}
          hint={`${data.averageVotesPerPerspective} per question`}
          icon={<Users className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label="Clear-cut verdicts"
          value={`${data.consensus.decisive}/${data.totalPerspectives}`}
          hint={`${data.consensus.contested} were near-even`}
          icon={<Scale className="h-4 w-4" aria-hidden />}
        />
      </div>

      {data.byContestant.length > 0 && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm font-medium">Who the audience has sided with</p>
            {data.byContestant.slice(0, 6).map((entry) => (
              <div key={entry.contestantId} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <Link
                    href={`/contestants/${entry.contestantId}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {entry.displayName}
                  </Link>
                  <span className="tabular-nums text-muted">
                    {entry.supportRate}% · {entry.votesFor.toLocaleString()} answers
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.min(100, entry.supportRate)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
