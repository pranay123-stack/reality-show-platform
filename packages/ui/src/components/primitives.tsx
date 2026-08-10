'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '../lib/cn';

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-surface-raised text-muted',
        primary: 'border-primary/40 bg-primary/15 text-foreground',
        accent: 'border-accent/40 bg-accent/15 text-foreground',
        success: 'border-success/40 bg-success/15 text-success',
        warning: 'border-warning/40 bg-warning/15 text-warning',
        danger: 'border-danger/40 bg-danger/15 text-danger',
        live: 'border-live/50 bg-live/15 text-live',
      },
      size: { sm: 'text-[11px] px-2', md: '' },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}

/**
 * A domain status rendered as a chip.
 *
 * Every feature has its own status enum, but they share a small vocabulary —
 * something is live, something is waiting on a human, something ended badly.
 * Mapping that vocabulary once means a `PENDING` challenge and a `PENDING`
 * redemption look the same to a reader, which is the whole point of a status
 * colour. An unrecognised status stays neutral rather than guessing.
 */
/*
  Matched on underscore-separated segments rather than as a substring, so
  `IN_MODERATION` and `PENDING_VERIFICATION` land on the same colour as the bare
  words while a status that merely *contains* one of these letter runs does not
  get coloured by accident. Danger is tested first: a status that is both
  finished and failed is failed.
*/
const STATUS_TONES: [BadgeProps['tone'], Set<string>][] = [
  [
    'danger',
    new Set([
      'REJECTED', 'CANCELLED', 'CANCELED', 'FAILED', 'EVICTED', 'RETIRED',
      'EXPIRED', 'BLOCKED', 'SUSPENDED', 'BANNED', 'DECLINED',
    ]),
  ],
  [
    'warning',
    new Set([
      'PENDING', 'MODERATION', 'SUBMITTED', 'RESERVED', 'DRAFT', 'SCHEDULED',
      'PAUSED', 'SHORTLIST', 'SHORTLISTED', 'QUEUED', 'NOMINATED', 'REVIEW',
      'REQUESTED', 'UPCOMING', 'ESCALATED', 'SELECTION', 'VOTING',
    ]),
  ],
  [
    'success',
    new Set([
      'ACTIVE', 'OPEN', 'APPROVED', 'SELECTED', 'LIVE', 'AVAILABLE', 'FULFILLED',
      'PROCESSED', 'SENT', 'WINNER', 'RESOLVED', 'COMPLETED', 'PUBLISHED',
      'ACCEPTED', 'EXECUTED', 'FINALIZED', 'IMMUNE', 'SAFE',
    ]),
  ],
];

/** Lifecycle ends — `CLOSED`, `ENDED`, `ARCHIVED` — stay neutral by default. */
export function statusTone(status: string): BadgeProps['tone'] {
  const segments = status.toUpperCase().split('_');
  return STATUS_TONES.find(([, words]) => segments.some((word) => words.has(word)))?.[0] ?? 'neutral';
}

export interface StatusBadgeProps {
  status: string;
  /** Overrides the humanised status text without changing the colour. */
  label?: string;
  size?: BadgeProps['size'];
  className?: string;
}

export function StatusBadge({ status, label, size = 'sm', className }: StatusBadgeProps) {
  const tone = statusTone(status);

  return (
    <Badge tone={tone} size={size} className={className}>
      {label ?? status.replace(/_/g, ' ').toLowerCase()}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

const avatarSizes = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-base', xl: 'h-20 w-20 text-lg' };

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: keyof typeof avatarSizes;
  className?: string;
}

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        'relative flex shrink-0 overflow-hidden rounded-full border border-border bg-surface-raised',
        avatarSizes[size],
        className,
      )}
    >
      {src && (
        <AvatarPrimitive.Image src={src} alt="" className="h-full w-full object-cover" />
      )}
      <AvatarPrimitive.Fallback
        className="flex h-full w-full items-center justify-center font-semibold text-muted"
        // The name is decorative here; the surrounding component always states it.
        aria-hidden
      >
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  tone?: 'primary' | 'accent' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md';
  showValue?: boolean;
  className?: string;
}

const progressTones = {
  primary: 'bg-primary',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export function ProgressBar({
  value,
  max = 100,
  label,
  tone = 'primary',
  size = 'md',
  showValue = false,
  className,
}: ProgressBarProps) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;

  return (
    <div className={cn('space-y-1.5', className)}>
      {(label || showValue) && (
        <div className="flex items-center justify-between text-xs">
          {label && <span className="text-muted">{label}</span>}
          {showValue && <span className="font-medium tabular-nums">{Math.round(percent)}%</span>}
        </div>
      )}
      <ProgressPrimitive.Root
        value={percent}
        max={100}
        aria-label={label}
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-surface-raised',
          size === 'sm' ? 'h-1.5' : 'h-2.5',
        )}
      >
        <ProgressPrimitive.Indicator
          className={cn('h-full rounded-full transition-[width] duration-500 ease-out', progressTones[tone])}
          style={{ width: `${percent}%` }}
        />
      </ProgressPrimitive.Root>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border bg-surface p-1',
        className,
      )}
      {...props}
    />
  );
});

export const TabsTrigger = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'rounded px-3 py-1.5 text-sm font-medium text-muted transition-colors',
        'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'data-[state=active]:bg-surface-overlay data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn('mt-4 focus-visible:outline-none', className)}
      {...props}
    />
  );
});

// ---------------------------------------------------------------------------
// Live indicator
// ---------------------------------------------------------------------------

export function LiveIndicator({
  live = true,
  label,
  className,
}: {
  live?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wider',
        live ? 'border-live/50 bg-live/10 text-live' : 'border-border bg-surface-raised text-muted',
        className,
      )}
    >
      <span className="relative flex h-2 w-2">
        {live && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-live animate-pulse-live" />
        )}
        <span
          className={cn('relative inline-flex h-2 w-2 rounded-full', live ? 'bg-live' : 'bg-muted')}
        />
      </span>
      {label ?? (live ? 'Live' : 'Off air')}
    </span>
  );
}
