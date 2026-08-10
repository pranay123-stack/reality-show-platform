import type { ElementType, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Card } from './card';

/**
 * The two shapes every screen was rebuilding by hand.
 *
 * Before these existed, nineteen screens each wrote their own page header and
 * the codebase had drifted into two different `h1` treatments — `text-display-md`
 * on the screens built early, `text-2xl tracking-tight` on the ones built later.
 * Nothing chose that; it happened one file at a time. Putting the heading in a
 * component is what stops it happening again.
 */

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Buttons or tabs aligned to the end of the header. */
  action?: ReactNode;
  /** Status chips or counters shown beneath the description. */
  meta?: ReactNode;
  /**
   * `display` is the audience-facing treatment: a fluid size that grows with
   * the viewport. `compact` is for the operator console, where a 36 px title
   * above a dense table is wasted vertical space rather than presence.
   */
  size?: 'display' | 'compact';
  /** Escape hatch for a header on a page that already owns the `h1`. */
  as?: Extract<ElementType, 'h1' | 'h2'>;
  className?: string;
}

export function PageHeader({
  title,
  description,
  action,
  meta,
  size = 'display',
  as: Heading = 'h1',
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      {/*
        `min-w-0` lets a long title truncate or wrap instead of forcing the
        header wider than the page; `basis-[18rem]` is the width below which the
        action drops to its own line rather than crushing the title.
      */}
      <div className="min-w-0 grow basis-[18rem] space-y-1">
        <Heading
          className={cn(
            'font-semibold text-balance',
            size === 'display' ? 'text-display-md' : 'text-2xl tracking-tight',
          )}
        >
          {title}
        </Heading>

        {description && <p className="max-w-2xl text-sm text-muted">{description}</p>}
        {meta}
      </div>

      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}

export interface SectionCardProps {
  title: ReactNode;
  description?: ReactNode;
  /** A link or button aligned to the end of the section heading. */
  action?: ReactNode;
  children: ReactNode;
  /**
   * Sections sit under the page `h1`, so `h2` is the honest default. Pass `h3`
   * when the section is genuinely nested inside another titled block.
   */
  as?: Extract<ElementType, 'h2' | 'h3'>;
  className?: string;
  bodyClassName?: string;
}

/** A titled panel: the `Card` + heading + description shape used ~30 times. */
export function SectionCard({
  title,
  description,
  action,
  children,
  as: Heading = 'h2',
  className,
  bodyClassName,
}: SectionCardProps) {
  return (
    <Card className={cn('flex flex-col gap-3 p-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 space-y-0.5">
          <Heading className="flex items-center gap-2 text-sm font-medium">{title}</Heading>
          {description && <p className="text-xs text-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      <div className={cn('min-w-0', bodyClassName)}>{children}</div>
    </Card>
  );
}
