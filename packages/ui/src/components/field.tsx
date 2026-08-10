'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import { AlertCircle } from 'lucide-react';
import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from '../lib/cn';

export const Label = forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(function Label({ className, ...props }, ref) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn('text-sm font-medium text-foreground', className)}
      {...props}
    />
  );
});

const controlStyles = [
  'w-full rounded-md border border-border bg-input px-3.5 text-foreground',
  'placeholder:text-muted/70',
  'transition-colors focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/30',
];

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(controlStyles, 'h-11', className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(controlStyles, 'min-h-24 py-2.5', className)} {...props} />;
  },
);

/** The attributes `FormField` injects into whichever control it wraps. */
interface ControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean | 'true' | 'false';
}

export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Wraps a control with its label, hint and error text, and wires up the aria
 * relationships so a screen reader announces the error with the field rather
 * than leaving it as loose text on the page.
 */
export function FormField({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: FormFieldProps) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;

  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  /*
    The hint and error text carry ids, but nothing pointed at them: a screen
    reader read "Email, edit text" and left the reason the field was rejected
    sitting on the page as unattached prose. The same went for `required`, which
    drew a red asterisk and told assistive technology nothing.

    Injecting rather than asking each call site to repeat it means the wiring
    cannot be forgotten on the twentieth form. Anything the caller set
    explicitly still wins.
  */
  const control = isValidElement<ControlProps>(children)
    ? cloneElement(children, {
        id: children.props.id ?? id,
        'aria-describedby': children.props['aria-describedby'] ?? describedBy,
        'aria-invalid': children.props['aria-invalid'] ?? (error ? true : undefined),
        // `aria-required` rather than the native attribute: these forms set
        // `noValidate` and own their validation, and a native bubble on top of
        // an inline message says the same thing twice in two different places.
        'aria-required': children.props['aria-required'] ?? (required || undefined),
      })
    : children;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="ml-1 text-danger" aria-hidden>
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </Label>

      {control}

      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}

      {error && (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-xs text-danger" role="alert">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
