'use client';

import { EmptyState, LoadingState, Tabs, TabsContent, TabsList, TabsTrigger } from '@reality/ui';
import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useHeatHistory } from '@/hooks/use-contestants';

const WINDOWS = [
  { value: '24h' as const, label: '24 hours' },
  { value: '7d' as const, label: '7 days' },
  { value: 'season' as const, label: 'Season' },
];

export function HeatChart({ contestantId }: { contestantId: string }) {
  const [window, setWindow] = useState<'24h' | '7d' | 'season'>('24h');

  return (
    <Tabs value={window} onValueChange={(value) => setWindow(value as typeof window)}>
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted">Heat history</h3>
        <TabsList>
          {WINDOWS.map((option) => (
            <TabsTrigger key={option.value} value={option.value}>
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {WINDOWS.map((option) => (
        <TabsContent key={option.value} value={option.value}>
          <HeatChartBody contestantId={contestantId} window={option.value} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function HeatChartBody({
  contestantId,
  window,
}: {
  contestantId: string;
  window: '24h' | '7d' | 'season';
}) {
  const { data, isLoading } = useHeatHistory(contestantId, window);

  if (isLoading) return <LoadingState rows={1} className="h-64" />;

  if (!data || data.points.length === 0) {
    return (
      <EmptyState
        title="No heat history yet"
        description="Snapshots appear once the heat service has run for this window."
      />
    );
  }

  const series = data.points.map((point) => ({
    at: point.at,
    score: point.score,
    label: formatTick(point.at, window),
  }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-4 text-sm">
        <span className="text-muted">
          Range{' '}
          <span className="font-mono text-foreground tabular-nums">
            {data.min?.toFixed(1)}–{data.max?.toFixed(1)}
          </span>
        </span>
        <span className="text-muted">
          Change{' '}
          <span
            className={`font-mono tabular-nums ${
              data.change > 0 ? 'text-success' : data.change < 0 ? 'text-danger' : 'text-foreground'
            }`}
          >
            {data.change > 0 ? '+' : ''}
            {data.change.toFixed(1)}
          </span>
        </span>
      </div>

      {/* Height is fixed so the container has something to be responsive inside. */}
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="heatFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'hsl(var(--muted))', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: 'hsl(var(--muted))', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              cursor={{ stroke: 'hsl(var(--border-strong))' }}
              contentStyle={{
                background: 'hsl(var(--surface-overlay))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: 'hsl(var(--muted))' }}
              formatter={(value: number) => [value.toFixed(1), 'Heat']}
            />
            <Area
              type="monotone"
              dataKey="score"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill="url(#heatFill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-muted">
        Heat is recomputed on the server from audience votes, reactions, views, engagement,
        prediction and challenge activity, and momentum.
      </p>
    </div>
  );
}

function formatTick(iso: string, window: '24h' | '7d' | 'season'): string {
  const date = new Date(iso);
  if (window === '24h') {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}
