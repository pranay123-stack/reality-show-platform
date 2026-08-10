'use client';

import type { OverviewCard } from '@reality/shared';
import { Badge, Button, Card, Modal, ModalClose, ModalContent, cn, type BadgeProps } from '@reality/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Small shared pieces for the console: summary cards, a filter bar, a
 * confirmation dialog, and two chart shapes that need no charting library.
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
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors',
            value === option.value
              ? 'border-primary/50 bg-primary/15 text-foreground'
              : 'border-border text-muted hover:border-border-strong hover:text-foreground',
          )}
        >
          {option.label}
          {option.count !== undefined && (
            <span className="ml-1.5 text-xs tabular-nums opacity-70">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action dialog
// ---------------------------------------------------------------------------

export interface ActionDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  /** Irreversible actions get the danger treatment. */
  destructive?: boolean;
  pending?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}

/**
 * Confirmation for an operator action.
 *
 * Used for anything a live show cannot take back — closing a poll, resolving a
 * prediction, evicting a contestant. The friction is the point.
 */
export function ActionDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  pending,
  disabled,
  onConfirm,
  onClose,
  children,
}: ActionDialogProps) {
  if (!open) return null;

  return (
    <Modal open onOpenChange={(next) => !next && onClose()}>
      <ModalContent
        title={title}
        description={description}
        footer={
          <>
            <ModalClose asChild>
              <Button variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </ModalClose>
            <Button
              variant={destructive ? 'danger' : 'primary'}
              loading={pending}
              disabled={disabled}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        {children}
      </ModalContent>
    </Modal>
  );
}

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

/** Status chip with the tone mapping the console uses everywhere. */
export function StatusBadge({ status }: { status: string }) {
  const tone: BadgeProps['tone'] =
    /ACTIVE|OPEN|APPROVED|SELECTED|LIVE|AVAILABLE|FULFILLED|PROCESSED|SENT|WINNER/.test(status)
      ? 'success'
      : /PENDING|MODERATION|SUBMITTED|RESERVED|DRAFT|SCHEDULED|PAUSED|SHORTLIST/.test(status)
        ? 'warning'
        : /REJECTED|CANCELLED|FAILED|EVICTED|RETIRED|EXPIRED/.test(status)
          ? 'danger'
          : 'neutral';

  return (
    <Badge tone={tone} size="sm">
      {status.replace(/_/g, ' ').toLowerCase()}
    </Badge>
  );
}
