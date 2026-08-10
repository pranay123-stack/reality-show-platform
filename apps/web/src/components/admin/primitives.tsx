'use client';

import type { OverviewCard } from '@reality/shared';
import { Card, cn, FilterChips, type BadgeProps } from '@reality/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Small shared pieces for the console: summary cards, a filter bar, and two
 * chart shapes that need no charting library.
 *
 * The confirmation dialog and the status chip used to live here too. They are
 * not console-specific — the audience side wants both — so they moved to
 * `@reality/ui` as `ConfirmDialog` and `StatusBadge`.
 */

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

const TONE_ACCENT: Record<NonNullable<OverviewCard['tone']>, string> = {
  neutral: 'border-border',
  good: 'border-success/40',
  warn: 'border-warning/50',
  bad: 'border-danger/50',
};

const TONE_TEXT: Record<NonNullable<OverviewCard['tone']>, string> = {
  neutral: '',
  good: 'text-success',
  warn: 'text-warning',
  bad: 'text-danger',
};

export function DashboardCards({ cards }: { cards: OverviewCard[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const tone = card.tone ?? 'neutral';
        // A zero on a "needs attention" card is good news, so it should not
        // shout in amber.
        const highlight = card.value > 0 ? TONE_TEXT[tone] : '';

        const body = (
          <Card className={cn('h-full space-y-1 p-4 transition-colors', TONE_ACCENT[tone])}>
            <p className="text-xs text-muted">{card.label}</p>
            <p className={cn('text-2xl font-semibold tabular-nums', highlight)}>
              {card.value.toLocaleString()}
            </p>
            {card.detail && <p className="text-xs text-muted">{card.detail}</p>}
          </Card>
        );

        return (
          <li key={card.key}>
            {card.href ? (
              <Link
                href={card.href}
                className="block h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface FilterOption {
  value: string;
  label: string;
}

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-raised/60 p-3">
      {children}
    </div>
  );
}

export function SelectFilter({
  label,
  value,
  options,
  onChange,
  placeholder = 'Any',
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = `filter-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-xs text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full min-w-[8rem] max-w-[14rem] rounded-md border border-border bg-surface px-2 text-sm"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Kept as a named console export; the behaviour now lives in `FilterChips`. */
export function StatusPills<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return <FilterChips label={label} value={value} options={options} onChange={onChange} />;
}

// ---------------------------------------------------------------------------
// Action dialog
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

/**
 * A bar chart in CSS.
 *
 * Seven bars do not justify a charting dependency, a canvas, or the bundle cost
 * of either — and a table of the same numbers stays available to screen readers.
 */
export function BarChart({
  data,
  label,
}: {
  data: { label: string; value: number; caption?: string }[];
  label: string;
}) {
  const max = Math.max(1, ...data.map((point) => point.value));

  return (
    <figure className="space-y-2">
      <figcaption className="sr-only">{label}</figcaption>
      <div className="flex h-32 items-end gap-1.5" role="img" aria-label={label}>
        {data.map((point) => (
          <div key={point.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="text-[10px] tabular-nums text-muted">{point.value || ''}</span>
            <div
              className="w-full rounded-t bg-primary/70 transition-[height]"
              style={{ height: `${Math.max(2, (point.value / max) * 100)}%` }}
              title={`${point.label}: ${point.value}`}
            />
            <span className="w-full truncate text-center text-[10px] text-muted">
              {point.caption ?? point.label}
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}

/** A horizontal share bar — vote distributions, redemption splits. */
export function DistributionBar({
  segments,
  total,
}: {
  segments: { key: string; label: string; value: number; tone?: BadgeProps['tone'] }[];
  total: number;
}) {
  const safeTotal = Math.max(1, total);

  return (
    <div className="space-y-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-raised">
        {segments.map((segment, index) => (
          <div
            key={segment.key}
            className={cn(
              'h-full transition-[width]',
              index % 4 === 0 && 'bg-primary',
              index % 4 === 1 && 'bg-accent',
              index % 4 === 2 && 'bg-success',
              index % 4 === 3 && 'bg-warning',
            )}
            style={{ width: `${(segment.value / safeTotal) * 100}%` }}
            title={`${segment.label}: ${segment.value}`}
          />
        ))}
      </div>

      <ul className="space-y-1">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{segment.label}</span>
            <span className="shrink-0 tabular-nums text-muted">
              {segment.value.toLocaleString()}
              <span className="ml-1.5 text-xs">
                {Math.round((segment.value / safeTotal) * 100)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
