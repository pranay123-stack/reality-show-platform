'use client';

import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

/**
 * A row of mutually exclusive filters.
 *
 * This shape had been rebuilt by hand eight times — the leaderboard's two axes,
 * the community picker, the console's mobile nav, the reward categories, the
 * notification inbox, the analytics range, the notification-health window — with
 * three different heights and three different sets of ARIA semantics.
 *
 * On semantics: these are *filters*, not tabs, so they are toggle buttons in a
 * labelled group rather than a `tablist`. A real `tablist` owes the user arrow
 * key navigation and a roving tabindex; several of the hand-rolled copies
 * claimed `role="tab"` while delivering neither. Where a genuine tab panel
 * relationship exists the app uses Radix `Tabs`, which does implement it.
 */

export interface FilterChipOption<T extends string> {
  value: T;
  label: string;
  /** A trailing count — unread items, members, entries in this state. */
  count?: number;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface FilterChipsProps<T extends string> {
  /** Accessible name for the group. Required: a bare row of buttons is a puzzle. */
  label: string;
  value: T;
  options: FilterChipOption<T>[];
  onChange: (value: T) => void;
  /** `solid` is the bordered pill; `quiet` is the borderless segmented look. */
  variant?: 'solid' | 'quiet';
  className?: string;
}

/**
 * `h-9` matches the small `Button`, so a chip row sitting beside one lines up.
 * It also clears WCAG 2.2 target-size guidance, which the 28 px hand-rolled
 * versions were only just scraping past.
 */
export function chipClassName(active: boolean, variant: 'solid' | 'quiet' = 'solid'): string {
  return cn(
    'inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap px-3.5 text-sm transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    variant === 'solid'
      ? cn(
          'rounded-full border',
          active
            ? 'border-primary/50 bg-primary/15 text-foreground'
            : 'border-border text-muted hover:border-border-strong hover:text-foreground',
        )
      : cn(
          'rounded-md',
          active
            ? 'bg-surface-raised font-medium text-foreground'
            : 'text-muted hover:text-foreground',
        ),
  );
}

export function FilterChips<T extends string>({
  label,
  value,
  options,
  onChange,
  variant = 'solid',
  className,
}: FilterChipsProps<T>) {
  return (
    // The negative margin lets a focus ring on the first chip show fully while
    // the row still scrolls edge to edge on a phone.
    <div
      role="group"
      aria-label={label}
      className={cn('-mx-1 flex gap-2 overflow-x-auto px-1 py-1', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={chipClassName(value === option.value, variant)}
        >
          {option.icon}
          <span className="max-w-[12rem] truncate">{option.label}</span>
          {option.count !== undefined && (
            <span className="text-xs tabular-nums opacity-70">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
