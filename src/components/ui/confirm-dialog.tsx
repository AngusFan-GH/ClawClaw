/**
 * ConfirmDialog - In-DOM confirmation dialog (replaces window.confirm)
 * Keeps focus within the renderer to avoid Windows focus loss after native dialogs.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmPendingLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  size?: 'sm' | 'md';
  confirmPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'OK',
  confirmPendingLabel,
  cancelLabel = 'Cancel',
  variant = 'default',
  size = 'md',
  confirmPending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && cancelRef.current) {
      cancelRef.current.focus();
    }
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (confirmPending) return;
      onCancel();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/42 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onKeyDown={handleKeyDown}
      onClick={() => {
        if (confirmPending) return;
        onCancel();
      }}
    >
      <div
        className={cn(
          'mx-4 w-full rounded-2xl border border-border/70 bg-card/95 p-5 shadow-[0_18px_44px_rgba(0,0,0,0.18)] backdrop-blur-xl',
          size === 'sm' ? 'max-w-sm' : 'max-w-md',
          'focus:outline-none'
        )}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-base font-semibold tracking-tight md:text-lg">
          {title}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="outline"
            className="rounded-xl"
            disabled={confirmPending}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            className="rounded-xl"
            disabled={confirmPending}
            onClick={onConfirm}
          >
            {confirmPending ? (confirmPendingLabel || confirmLabel) : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
