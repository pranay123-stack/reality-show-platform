'use client';

import type { AdminOverviewView } from '@reality/shared';
import { Badge, Card, ErrorState, LiveIndicator, LoadingState, cn } from '@reality/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Flame } from 'lucide-react';
import Link from 'next/link';

import { BarChart, DashboardCards } from '@/components/admin/primitives';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export function AdminOverview() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.admin.section('overview'),
    queryFn: () => api.get<AdminOverviewView>('/admin/overview'),
    // Live enough to be useful during a show without hammering the database.
    refetchInterval: 30_000,
  });

  if (isLoading) return <LoadingState rows={5} />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Console</h1>
          {data.show ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <LiveIndicator live={data.show.isLive} />
              {data.show.name}
              {data.show.episode && <span>· {data.show.episode}</span>}
            </p>
          ) : (
            <p className="text-sm text-muted">No show is currently configured.</p>
          )}
        </div>

        <p className="text-xs text-muted">
          Updated {new Date(data.generatedAt).toLocaleTimeString()}
        </p>
      </header>

      <DashboardCards cards={data.cards} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-5">
          <div className="space-y-0.5">
            <h2 className="text-sm font-medium">Participation</h2>
            <p className="text-xs text-muted">
              Distinct people earning points each day, over the last week.
            </p>
          </div>

          <BarChart
            label="Participants per day over the last seven days"
            data={data.participation.days.map((day) => ({
              label: day.date,
              value: day.users,
              caption: new Date(`${day.date}T00:00:00Z`).toLocaleDateString(undefined, {
                weekday: 'narrow',
                timeZone: 'UTC',
              }),
            }))}
          />

          {/* The chart is decorative for screen readers; the numbers are here. */}
          <table className="sr-only">
            <caption>Participants per day</caption>
            <tbody>
              {data.participation.days.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{day.date}</th>
                  <td>{day.users} people</td>
                  <td>{day.actions} actions</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="space-y-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <Flame className="h-4 w-4 text-heat-3" aria-hidden />
              Trending contestants
            </h2>
            <Link
              href="/admin/contestants"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Manage
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          </div>

          {data.trendingContestants.length === 0 ? (
            <p className="text-sm text-muted">No contestants are in play.</p>
          ) : (
            <ol className="space-y-2">
              {data.trendingContestants.map((contestant, index) => (
                <li
                  key={contestant.id}
                  className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2"
                >
                  <span className="w-5 text-center font-mono text-sm text-muted tabular-nums">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {contestant.displayName}
                  </span>
                  <TrendChip trend={contestant.heatTrend} />
                  <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums">
                    {contestant.heatScore}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <QueuePanel
          title="Waiting on a human"
          href="/admin/challenges"
          rows={[
            { label: 'Challenges in moderation', value: data.moderation.challenges },
            { label: 'Weekend entries to review', value: data.moderation.weekendSubmissions },
            { label: 'Abuse reports open', value: data.moderation.reports },
          ]}
        />

        <QueuePanel
          title="Reward activity"
          href="/admin/rewards"
          rows={[
            { label: 'Redeemed today', value: data.rewards.redemptionsToday },
            { label: 'Awaiting fulfilment', value: data.rewards.awaitingFulfilment },
            { label: 'Points spent today', value: data.rewards.pointsSpentToday },
          ]}
        />

        <QueuePanel
          title="Notification health"
          href="/admin/notifications"
          rows={[
            { label: 'Events queued', value: data.notifications.pending },
            { label: 'Events failed', value: data.notifications.failed, alarming: true },
            { label: 'Deliveries failed', value: data.notifications.deliveriesFailed, alarming: true },
          ]}
        />
      </div>
    </div>
  );
}

function TrendChip({ trend }: { trend: string }) {
  const tone = trend === 'UP' ? 'success' : trend === 'DOWN' ? 'danger' : 'neutral';
  return (
    <Badge tone={tone} size="sm">
      {trend.toLowerCase()}
    </Badge>
  );
}

function QueuePanel({
  title,
  href,
  rows,
}: {
  title: string;
  href: string;
  rows: { label: string; value: number; alarming?: boolean }[];
}) {
  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <Link href={href} className="text-xs text-primary hover:underline">
          Open
        </Link>
      </div>

      <dl className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
            <dt className="min-w-0 truncate text-muted">{row.label}</dt>
            <dd
              className={cn(
                'shrink-0 font-semibold tabular-nums',
                row.alarming && row.value > 0 && 'text-danger',
              )}
            >
              {row.value.toLocaleString()}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
