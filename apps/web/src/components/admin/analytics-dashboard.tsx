'use client';

import type { AnalyticsOverviewView } from '@reality/shared';
import { Alert, Badge, Button, Card, ErrorState, LoadingState, cn } from '@reality/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flame, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  FeatureUsageChart,
  FunnelChart,
  MetricCard,
  TrendChart,
} from '@/components/admin/analytics-charts';
import { DataTable, type Column } from '@/components/admin/data-table';
import { SectionHeader } from '@/components/admin/section-header';
import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

interface EventRow {
  name: string;
  label: string;
  category: string;
  events: number;
  users: number;
}

const RANGES = [7, 30, 90];

export function AnalyticsDashboard() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [days, setDays] = useState(30);

  const overview = useQuery({
    queryKey: queryKeys.admin.section('analytics', days),
    queryFn: () => api.get<AnalyticsOverviewView>(`/analytics/admin/overview?days=${days}`),
    staleTime: 60_000,
  });

  const events = useQuery({
    queryKey: queryKeys.admin.section('analytics-events', days),
    queryFn: () => api.get<EventRow[]>(`/analytics/admin/events?days=${days}`),
    staleTime: 60_000,
  });

  const rebuild = useMutation({
    mutationFn: () => api.post<{ processed: number }>('/analytics/admin/rebuild', { days }),
    onSuccess: async (result) => {
      toast.success(`Recomputed ${result.processed} days`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.all });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not recompute the aggregates'),
  });

  if (!can('analytics.view')) {
    return (
      <Alert tone="danger" title="Not available">
        Analytics is visible to producers and administrators.
      </Alert>
    );
  }

  if (overview.isError) return <ErrorState onRetry={() => void overview.refetch()} />;
  if (overview.isLoading || !overview.data) return <LoadingState rows={6} />;

  const data = overview.data;

  const columns: Column<EventRow>[] = [
    { key: 'label', header: 'Event', render: (row) => row.label },
    {
      key: 'category',
      header: 'Area',
      secondary: true,
      render: (row) => (
        <Badge tone="neutral" size="sm">
          {row.category}
        </Badge>
      ),
    },
    { key: 'events', header: 'Events', numeric: true, render: (row) => row.events.toLocaleString() },
    { key: 'users', header: 'People', numeric: true, render: (row) => row.users.toLocaleString() },
  ];

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Analytics"
        description="Read-only observation, built from pre-aggregated daily numbers."
        action={
          can('analytics.rebuild') && (
            <Button
              variant="secondary"
              loading={rebuild.isPending}
              onClick={() => rebuild.mutate()}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Recompute
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              aria-pressed={days === range}
              onClick={() => setDays(range)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors',
                days === range
                  ? 'border-primary/50 bg-primary/15 text-foreground'
                  : 'border-border text-muted hover:border-border-strong hover:text-foreground',
              )}
            >
              {range} days
            </button>
          ))}
        </div>

        <p className="text-xs text-muted">
          {data.asOf ? `Aggregated to ${data.asOf}` : 'No aggregation has run yet'}
        </p>
      </div>

      {data.stale && (
        <Alert tone="warning" title="These numbers are behind">
          The aggregation pass has not run recently, so the figures below may be out of date.
          Recomputing brings them up to the last completed day.
        </Alert>
      )}

      <PrivacyNotice privacy={data.privacy} />

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.summary.map((metric) => (
          <li key={metric.metric}>
            <MetricCard metric={metric} />
          </li>
        ))}
      </ul>

      <div className="grid gap-4 lg:grid-cols-2">
        <FunnelChart steps={data.engagementFunnel} />
        <FeatureUsageChart features={data.featureUsage} />
      </div>

      <TrendChart
        title="Participation"
        description="Distinct people taking part each day."
        series={[{ label: 'Active', points: data.participation, tone: 'primary' }]}
      />

      <TrendChart
        title="Reward economy"
        description="Points earned against points spent, and redemptions."
        series={[
          { label: 'Earned', points: data.economy.pointsEarned, tone: 'success' },
          { label: 'Spent', points: data.economy.pointsSpent, tone: 'accent' },
          { label: 'Redemptions', points: data.economy.redemptions, tone: 'primary' },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Flame className="h-4 w-4 text-heat-3" aria-hidden />
            Contestant attention
          </h2>

          {data.contestantTrends.length === 0 ? (
            <p className="text-sm text-muted">No contestant views recorded in this window.</p>
          ) : (
            <ol className="space-y-2">
              {data.contestantTrends.map((contestant, index) => (
                <li
                  key={contestant.contestantId}
                  className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2"
                >
                  <span className="w-5 text-center font-mono text-sm text-muted tabular-nums">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {contestant.displayName}
                  </span>
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    {contestant.views.toLocaleString()} views
                  </span>
                  <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums">
                    {contestant.heatScore}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-muted">
            Views are attention; heat is the measured score. They are not the same thing and can
            disagree.
          </p>
        </Card>

        {/*
          `min-w-0` is load-bearing: a grid item defaults to `min-width: auto`,
          so it refuses to shrink below its content's intrinsic width. The table
          inside declares `min-w-[36rem]`, which made the column 576 px wide and
          pushed the page sideways on a phone — the inner `overflow-x-auto`
          never got the chance to scroll.
        */}
        <div className="min-w-0 space-y-2">
          <h2 className="text-sm font-medium">Events</h2>
          <DataTable
            rows={events.data ?? []}
            columns={columns}
            rowKey={(row) => row.name}
            loading={events.isLoading}
            emptyTitle="No events recorded"
            emptyDescription="Nothing has been observed in this window."
            caption="Recorded events with counts and distinct people"
          />
        </div>
      </div>
    </div>
  );
}

function PrivacyNotice({ privacy }: { privacy: AnalyticsOverviewView['privacy'] }) {
  if (privacy.optedOut === 0) return null;

  return (
    <Alert tone="info">
      <span className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
        {privacy.optedOut} of {privacy.totalUsers} accounts have opted out of analytics and produce
        no events at all, so these figures describe {privacy.coveragePercent}% of the platform.
      </span>
    </Alert>
  );
}
