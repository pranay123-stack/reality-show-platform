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
}

export function Alert({ tone = 'info', title, children, className, ...props }: AlertProps) {
  const Icon = icons[tone ?? 'info'];

  return (
    <div
      className={cn(alertVariants({ tone }), className)}
      // Errors interrupt; everything else waits for a pause in the output.
      role={tone === 'danger' ? 'alert' : 'status'}
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
