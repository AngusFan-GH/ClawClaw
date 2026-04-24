import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

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
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  position: ChatModelMenuPosition | null;
  options: Array<{ value: string; label: string }>;
  currentValue?: string;
  onSelect: (value: string) => void;
}) {
  if (!open || !position) {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[120] overflow-hidden rounded-[12px] border border-black/10 bg-card/95 p-1 shadow-lg dark:border-white/10 dark:bg-card/95"
      style={{
        top: position.compact ? position.top : undefined,
        bottom: position.compact ? undefined : window.innerHeight - position.top,
        left: position.left,
        width: position.compact
          ? Math.min(Math.max(position.width, 220), window.innerWidth - 32)
          : Math.min(320, window.innerWidth - 32),
        maxHeight: position.maxHeight,
        transform: position.compact ? 'none' : 'translateX(-100%)',
      }}
    >
      <div className="max-h-[inherit] overflow-y-auto">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-[13px] text-foreground hover:bg-black/5 dark:hover:bg-white/5"
            onClick={() => onSelect(option.value)}
          >
            <span className="flex-1 truncate">{option.label}</span>
            {currentValue === option.value ? (
              <Check className="h-3.5 w-3.5 shrink-0" />
            ) : null}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
