import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';

const alertVariants = cva('flex items-start gap-3 rounded-md border p-4 text-sm', {
  variants: {
    tone: {
      info: 'border-border bg-surface-raised text-foreground',
      success: 'border-success/40 bg-success/10 text-foreground',
      warning: 'border-warning/40 bg-warning/10 text-foreground',
      danger: 'border-danger/40 bg-danger/10 text-foreground',
    },
  },
  defaultVariants: { tone: 'info' },
});

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  title?: string;
  children?: ReactNode;
  /**
   * Announce this the moment it appears.
   *
   * Off by default, because most alerts on this platform are standing
   * explanation — "confirm your email to take part", "this board is frozen" —
   * that a screen reader already reaches in document order. Marking those as
   * live regions made every page open with two or three competing
   * announcements, and drowned out the one that mattered: "Loading…".
   *
   * `danger` opts in on its own: an error is nearly always the consequence of
   * something the reader just did, and waiting for them to find it is worse
   * than interrupting.
   */
  live?: boolean;
}

export function Alert({ tone = 'info', title, children, className, live, ...props }: AlertProps) {
  const Icon = icons[tone ?? 'info'];
  const announce = live ?? tone === 'danger';

  return (
    <div
      className={cn(alertVariants({ tone }), className)}
      role={announce ? (tone === 'danger' ? 'alert' : 'status') : undefined}
      {...props}
    >
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-danger',
          tone === 'info' && 'text-muted',
        )}
        aria-hidden
      />
      <div className="space-y-1">
        {title && <p className="font-medium leading-none">{title}</p>}
        {children && <div className="text-muted [&_a]:text-primary [&_a]:underline">{children}</div>}
      </div>
    </div>
  );
}
