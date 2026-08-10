import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '../lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Lifts and brightens on hover.
   *
   * Opt-in rather than the default: a card the reader cannot act on should not
   * suggest that they can, and most cards on this platform are read-only
   * panels sitting inside a page that is already a link target.
   */
  interactive?: boolean;
}

/**
 * The glass surface everything sits on.
 *
 * Translucent over the cinematic background rather than opaque, with a blur
 * behind it and a hairline border catching the light. The background colour is
 * deliberately still dark and mostly opaque — `bg-surface/70`, not the 5% white
 * a glassmorphism tutorial would suggest. Contrast is what makes a dark
 * interface readable over a moving backdrop, and the glow blobs drift directly
 * behind these cards.
 *
 * `supports-[backdrop-filter]` keeps the fallback honest: where the browser
 * cannot blur, the surface stays solid rather than becoming a translucent
 * window onto whatever is behind it.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, interactive = false, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border border-white/10 bg-surface/85 shadow-card',
        'supports-[backdrop-filter]:bg-surface/65 supports-[backdrop-filter]:backdrop-blur-xl',
        interactive && [
          'transition-[transform,border-color,box-shadow] duration-300',
          'hover:-translate-y-1.5 hover:border-white/20 hover:shadow-glow',
        ],
        className,
      )}
      {...props}
    />
  );
});

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...props }, ref) {
    return <div ref={ref} className={cn('space-y-1.5 p-6 pb-4', className)} {...props} />;
  },
);

export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  /**
   * The heading level. `h3` suits a card sitting inside a titled section, but a
   * card that *is* the page — the sign-in form, for one — needs to own the `h1`
   * or the document outline starts at level three with nothing above it.
   */
  as?: 'h1' | 'h2' | 'h3' | 'h4';
}

export const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(function CardTitle(
  { className, as: Heading = 'h3', ...props },
  ref,
) {
  return (
    <Heading
      ref={ref}
      className={cn('text-lg font-semibold leading-tight tracking-tight', className)}
      {...props}
    />
  );
});

export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function CardDescription({ className, ...props }, ref) {
    return <p ref={ref} className={cn('text-sm text-muted', className)} {...props} />;
  },
);

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />;
  },
);

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return <div ref={ref} className={cn('flex items-center gap-3 p-6 pt-0', className)} {...props} />;
  },
);
