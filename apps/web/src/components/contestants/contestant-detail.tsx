'use client';

import {
  Alert,
  Avatar,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  HeatBadge,
  LoadingState,
  ProgressBar,
  StatCard,
} from '@reality/ui';
import { ArrowLeft, Flame, ThumbsUp, Trophy } from 'lucide-react';
import Link from 'next/link';

import { HeatChart } from '@/components/contestants/heat-chart';
import { useContestant } from '@/hooks/use-contestants';

export function ContestantDetail({ id }: { id: string }) {
  const { data, isLoading, isError, refetch } = useContestant(id);

  if (isLoading) return <LoadingState rows={5} />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <div className="space-y-6">
      <Link
        href="/contestants"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All contestants
      </Link>

      <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <Avatar name={data.displayName} src={data.avatarUrl} size="xl" />

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-display-md font-semibold">{data.displayName}</h1>
            {data.status !== 'ACTIVE' && (
              <Badge tone={data.status === 'EVICTED' ? 'danger' : 'warning'}>
                {data.status.toLowerCase()}
              </Badge>
            )}
          </div>

          <p className="text-muted">
            {[data.occupation, data.hometown, data.age ? `${data.age}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>

          {data.tagline && <p className="text-lg">{data.tagline}</p>}

          <HeatBadge score={data.heatScore} trend={data.heatTrend} />
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Heat score"
          value={data.heatScore.toFixed(1)}
          hint="out of 100"
          icon={<Flame className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label="Heat rank"
          value={`#${data.rank}`}
          hint="in the house"
          icon={<Trophy className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label="Audience support"
          value={`${data.audienceSupport.shareOfAllVotes}%`}
          hint={`${data.audienceSupport.votesLast7Days.toLocaleString()} votes in 7 days`}
          icon={<ThumbsUp className="h-4 w-4" aria-hidden />}
        />
      </div>

      <Card>
        <CardContent className="pt-6">
          <HeatChart contestantId={data.id} />
        </CardContent>
      </Card>

      {data.bio && (
        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted">{data.bio}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recentEvents.length === 0 && (
              <p className="text-sm text-muted">No recorded events yet.</p>
            )}
            {data.recentEvents.map((event) => (
              <div key={event.id} className="border-l-2 border-border pl-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Badge size="sm">{event.type.toLowerCase()}</Badge>
                  {event.title}
                </p>
                {event.description && (
                  <p className="mt-0.5 text-sm text-muted">{event.description}</p>
                )}
                <p className="mt-0.5 text-xs text-muted">
                  {new Date(event.occurredAt).toLocaleString()}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Polls mentioning {data.displayName}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.relatedPolls.length === 0 && (
                <p className="text-sm text-muted">Not featured in any poll yet.</p>
              )}
              {data.relatedPolls.map((poll) => (
                <div key={poll.id} className="space-y-1.5">
                  <Link
                    href={`/polls/${poll.id}`}
                    className="text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {poll.question}
                  </Link>
                  <ProgressBar
                    value={poll.votesForContestant}
                    max={Math.max(1, poll.totalVotes)}
                    size="sm"
                    label={`${poll.votesForContestant} of ${poll.totalVotes} votes`}
                    showValue
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audience perspectives</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.relatedPerspectives.length === 0 && (
                <p className="text-sm text-muted">No perspectives recorded yet.</p>
              )}
              {data.relatedPerspectives.map((perspective) => (
                <div key={perspective.id} className="space-y-1.5">
                  <Link
                    href={`/perspectives/${perspective.id}`}
                    className="text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {perspective.question}
                  </Link>
                  <p className="text-xs text-muted">
                    “{perspective.optionLabel}” — {perspective.votesForOption} of{' '}
                    {perspective.totalVotes} votes
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Alert tone="info">
        This is a fictional placeholder contestant created for development. Heat is a measure of
        audience attention on this platform, not a judgement by the production team.
      </Alert>
    </div>
  );
}
