'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Button } from './button';

/**
 * Modal and Drawer share Radix Dialog: same focus trap, same escape handling,
 * same `aria-modal` semantics. Only the entry animation and anchoring differ.
 */

export const Modal = DialogPrimitive.Root;
export const ModalTrigger = DialogPrimitive.Trigger;
export const ModalClose = DialogPrimitive.Close;

const Overlay = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function Overlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        'fixed inset-0 z-50 bg-black/70 backdrop-blur-sm',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
        className,
      )}
      {...props}
    />
  );
});

export interface ModalContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  title: string;
  description?: string;
  /** Hides the visible title but keeps it for screen readers. */
  hideTitle?: boolean;
  footer?: ReactNode;
}

export const ModalContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ModalContentProps
>(function ModalContent({ className, title, description, hideTitle, footer, children, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
          'rounded-lg border border-border bg-surface-overlay shadow-card',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className,
        )}
        // Radix points `aria-describedby` at a description element by default.
        // A dialog whose title says everything is a legitimate shape, but the
        // reference then dangles and Radix warns; clearing it is the fix.
        {...(description ? null : { 'aria-describedby': undefined })}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 p-6 pb-3">
          <div className="space-y-1">
            <DialogPrimitive.Title className={cn('text-lg font-semibold', hideTitle && 'sr-only')}>
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="text-sm text-muted">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close">
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </DialogPrimitive.Close>
        </div>

        <div className="px-6 pb-6">{children}</div>

        {footer && (
          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">{footer}</div>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Irreversible actions get the danger treatment. */
  destructive?: boolean;
  pending?: boolean;
  /** Blocks confirmation without hiding why — the body should say what is missing. */
  disabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}

/**
 * Confirmation before something a live show cannot take back — closing a poll,
 * resolving a prediction, evicting a contestant. The friction is the point.
 *
 * Cancel is deliberately the first control in the tab order and stays enabled
 * while the action is in flight, so an accidental confirm is always escapable.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive,
  pending,
  disabled,
  onConfirm,
  onClose,
  children,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <Modal open onOpenChange={(next) => !next && onClose()}>
      <ModalContent
        title={title}
        description={description}
        // Closing mid-flight would leave the operator with no idea whether the
        // action landed, so the dialog holds until the request settles.
        onInteractOutside={(event) => pending && event.preventDefault()}
        onEscapeKeyDown={(event) => pending && event.preventDefault()}
        footer={
          <>
            <ModalClose asChild>
              <Button variant="ghost" disabled={pending}>
                {cancelLabel}
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

// --- Drawer (mobile-first sheet) -------------------------------------------

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export interface DrawerContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  title: string;
  description?: string;
  side?: 'left' | 'right' | 'bottom';
  hideTitle?: boolean;
}

export const DrawerContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(function DrawerContent(
  { className, title, description, side = 'left', hideTitle, children, ...props },
  ref,
) {
  const sideStyles = {
    left: 'inset-y-0 left-0 h-full w-[19rem] border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
    right:
      'inset-y-0 right-0 h-full w-[19rem] border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
    bottom:
      'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-lg border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
  };

  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed z-50 flex flex-col border-border bg-surface shadow-card',
          'data-[state=open]:animate-in data-[state=closed]:animate-out duration-300',
          sideStyles[side],
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-4">
          <div className="space-y-1">
            <DialogPrimitive.Title className={cn('font-semibold', hideTitle && 'sr-only')}>
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="text-sm text-muted">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close">
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </DialogPrimitive.Close>
        </div>

        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
