'use client';

import type { FeatureUsage, FunnelStep, MetricSummary, TrendPoint } from '@reality/shared';
import { Card, cn, SectionCard } from '@reality/ui';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

/**
 * Charts for the analytics dashboard.
 *
 * Built in CSS rather than with a charting library. The shapes here are a
 * sparkline, a bar and a funnel over at most ninety points — none of that
 * justifies the bundle cost, and every chart keeps a screen-reader-accessible
 * table beside it, which most charting libraries make harder rather than easier.
 */

function formatValue(value: number, format: MetricSummary['format']): string {
  if (format === 'percent') return `${value}%`;
  if (format === 'duration') {
    if (value < 60) return `${Math.round(value)}s`;
    const minutes = Math.floor(value / 60);
    return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }
  return value.toLocaleString();
}

export function MetricCard({ metric }: { metric: MetricSummary }) {
  const change = metric.changePercent;

  return (
    <Card className="space-y-2 p-4">
      <p className="text-xs text-muted">{metric.label}</p>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-2xl font-semibold tabular-nums">
          {formatValue(metric.value, metric.format)}
        </p>
        <ChangeChip change={change} />
      </div>

      {metric.series.length > 1 && <Sparkline series={metric.series} />}
    </Card>
  );
}

function ChangeChip({ change }: { change: number | null }) {
  // Null means there was no baseline to compare against — "up infinity%" would
  // say nothing, so nothing is shown.
  if (change === null) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted">
        <Minus className="h-3 w-3" aria-hidden />
        <span className="sr-only">No comparison available</span>
      </span>
    );
  }

  const rising = change > 0;
  const flat = change === 0;
  const Icon = flat ? Minus : rising ? ArrowUp : ArrowDown;

  return (
    <span
      className={cn(
        'flex items-center gap-0.5 text-xs font-medium tabular-nums',
        flat ? 'text-muted' : rising ? 'text-success' : 'text-danger',
      )}
      title={`${change}% against the previous period`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {Math.abs(change)}%
    </span>
  );
}

/** A compact shape-of-the-trend line. Deliberately unlabelled. */
function Sparkline({ series }: { series: TrendPoint[] }) {
  const max = Math.max(1, ...series.map((point) => point.value));

  return (
    <div className="flex h-8 items-end gap-px" aria-hidden>
      {series.map((point) => (
        <div
          key={point.date}
          className="flex-1 rounded-sm bg-primary/40"
          style={{ height: `${Math.max(4, (point.value / max) * 100)}%` }}
          title={`${point.date}: ${point.value}`}
        />
      ))}
    </div>
  );
}

export function TrendChart({
  title,
  description,
  series,
  format = 'count',
}: {
  title: string;
  description?: string;
  series: { label: string; points: TrendPoint[]; tone?: 'primary' | 'accent' | 'success' }[];
  format?: MetricSummary['format'];
}) {
  const max = Math.max(1, ...series.flatMap((line) => line.points.map((point) => point.value)));
  const length = series[0]?.points.length ?? 0;

  const TONE = {
    primary: 'bg-primary',
    accent: 'bg-accent',
    success: 'bg-success',
  } as const;

  return (
    <SectionCard
      title={title}
      description={description}
      bodyClassName="space-y-3"
      action={
        <ul className="flex flex-wrap gap-3">
          {series.map((line) => (
            <li key={line.label} className="flex items-center gap-1.5 text-xs text-muted">
              <span className={cn('h-2 w-2 rounded-full', TONE[line.tone ?? 'primary'])} aria-hidden />
              {line.label}
            </li>
          ))}
        </ul>
      }
    >

      {/* The bars scroll inside the card rather than widening the page. */}
      <div className="overflow-x-auto">
        <div
          className="flex h-40 min-w-full items-end gap-1"
          style={{ minWidth: `${Math.max(0, length * 12)}px` }}
          role="img"
          aria-label={title}
        >
          {Array.from({ length }, (_, index) => (
            <div key={index} className="flex min-w-0 flex-1 flex-col justify-end gap-px">
              {series.map((line) => {
                const point = line.points[index];
                if (!point) return null;
                return (
                  <div
                    key={line.label}
                    className={cn('w-full rounded-sm', TONE[line.tone ?? 'primary'])}
                    style={{ height: `${(point.value / max) * 100}%` }}
                    title={`${point.date} · ${line.label}: ${formatValue(point.value, format)}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-between text-[11px] text-muted">
        <span>{series[0]?.points[0]?.date ?? ''}</span>
        <span>{series[0]?.points.at(-1)?.date ?? ''}</span>
      </div>

      {/*
        The same numbers for a screen reader. Wrapped in a `sr-only` *div*
        rather than putting the class on the table: a `<caption>` is laid out
        outside the table box and is not reliably clipped by the table's own
        `overflow: hidden`, which pushed the whole page 204 px wide on a phone.
      */}
      <div className="sr-only">
        <table>
          <caption>{title}</caption>
          <tbody>
            {series[0]?.points.map((point, index) => (
              <tr key={point.date}>
                <th scope="row">{point.date}</th>
                {series.map((line) => (
                  <td key={line.label}>
                    {line.label}: {line.points[index]?.value ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

/**
 * The engagement funnel.
 *
 * Each bar is drawn as a share of the *first* step, so the narrowing is visible
 * at a glance; the drop-off against the immediately preceding step is the
 * number an operator actually acts on, so it is spelled out in words.
 */
export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  return (
    <SectionCard
      title="Engagement funnel"
      description="Distinct people at each depth of involvement, over the selected window."
    >

      {steps.every((step) => step.users === 0) ? (
        <p className="text-sm text-muted">No activity in this window yet.</p>
      ) : (
        <ol className="space-y-2">
          {steps.map((step, index) => (
            <li key={step.key} className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{step.label}</span>
                <span className="tabular-nums text-muted">
                  {step.users.toLocaleString()}
                  <span className="ml-2 text-xs">{step.ofStart}% of active</span>
                </span>
              </div>

              <div className="h-6 w-full overflow-hidden rounded-md bg-surface-raised">
                <div
                  className="h-full rounded-md bg-primary/70 transition-[width]"
                  style={{ width: `${Math.max(1, step.ofStart)}%` }}
                />
              </div>

              {index > 0 && (
                <p className="text-[11px] text-muted">
                  {step.ofPrevious >= 100
                    ? 'Everyone from the previous step'
                    : `${step.ofPrevious}% continued from “${steps[index - 1]!.label}”`}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

export function FeatureUsageChart({ features }: { features: FeatureUsage[] }) {
  const max = Math.max(1, ...features.map((feature) => feature.users));

  return (
    <SectionCard
      title="Feature adoption"
      description="Share of monthly actives who used each feature in the window."
    >

      {features.every((feature) => feature.users === 0) ? (
        <p className="text-sm text-muted">Nothing has been used in this window yet.</p>
      ) : (
        <ul className="space-y-2">
          {features.map((feature) => (
            <li key={feature.feature} className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span>{feature.label}</span>
                <span className="tabular-nums text-muted">
                  {feature.users.toLocaleString()} people
                  <span className="ml-2 text-xs">{feature.adoption}%</span>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-raised">
                <div
                  className="h-full rounded-full bg-accent transition-[width]"
                  style={{ width: `${Math.max(1, (feature.users / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
