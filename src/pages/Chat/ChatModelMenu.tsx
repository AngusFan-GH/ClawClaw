import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type ChatModelMenuPosition = {
  top: number;
  left: number;
  width: number;
  compact: boolean;
  maxHeight: number;
};

export function ChatModelMenu({
  menuRef,
  open,
  position,
  options,
  currentValue,
  onSelect,
  minWidth = 220,
  maxWidth = 320,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  position: ChatModelMenuPosition | null;
  options: Array<{ value: string; label: string; badge?: string }>;
  currentValue?: string;
  onSelect: (value: string) => void;
  minWidth?: number;
  maxWidth?: number;
}) {
  if (!open || !position) {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[120] overflow-hidden rounded-[18px] border border-black/10 bg-card/95 p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.18)] ring-1 ring-white/60 backdrop-blur-xl dark:border-white/10 dark:bg-card/95 dark:ring-white/10"
      style={{
        top: position.compact ? position.top : undefined,
        bottom: position.compact ? undefined : window.innerHeight - position.top,
        left: position.left,
        width: position.compact
          ? Math.min(Math.max(position.width, minWidth), window.innerWidth - 32)
          : Math.min(Math.max(position.width, minWidth), maxWidth, window.innerWidth - 32),
        maxHeight: position.maxHeight,
        transform: position.compact ? 'none' : 'translateX(-100%)',
      }}
    >
      <div className="max-h-[inherit] overflow-y-auto pr-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={cn(
              'group flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-[13px] transition-colors',
              currentValue === option.value
                ? 'bg-primary/10 font-semibold text-primary'
                : 'text-foreground hover:bg-black/5 dark:hover:bg-white/5'
            )}
            onClick={() => onSelect(option.value)}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate">{option.label}</span>
              {option.badge ? (
                <span className="shrink-0 rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground dark:bg-white/10">
                  {option.badge}
                </span>
              ) : null}
            </span>
            {currentValue === option.value ? (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-3 w-3" />
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
