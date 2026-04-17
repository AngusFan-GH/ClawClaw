import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type OptionItem = {
  badgeLabel?: string;
  description?: string;
  label: string;
  value: string;
  disabled?: boolean;
};

export type SelectProps = {
  'aria-label'?: string;
  children?: React.ReactNode;
  className?: string;
  defaultValue?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  onBlur?: React.FocusEventHandler<HTMLButtonElement>;
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  onFocus?: React.FocusEventHandler<HTMLButtonElement>;
  placeholder?: string;
  value?: string;
};

function flattenOptionLabel(children: React.ReactNode): string {
  const parts: string[] = [];
  React.Children.forEach(children, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      parts.push(String(child));
      return;
    }
    if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
      parts.push(flattenOptionLabel(child.props.children));
    }
  });
  return parts.join('').trim();
}

function extractOptions(children: React.ReactNode): OptionItem[] {
  const items: OptionItem[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<Record<string, unknown>>(child)) {
      return;
    }
    if (child.type === React.Fragment) {
      items.push(...extractOptions((child.props as { children?: React.ReactNode }).children));
      return;
    }
    if (typeof child.type === 'string' && child.type.toLowerCase() === 'option') {
      const props = child.props as {
        value?: unknown;
        children?: React.ReactNode;
        disabled?: boolean;
        'data-badge-label'?: string;
        'data-description'?: string;
      };
      items.push({
        badgeLabel: typeof props['data-badge-label'] === 'string' ? props['data-badge-label'] : undefined,
        description: typeof props['data-description'] === 'string' ? props['data-description'] : undefined,
        value: String(props.value ?? ''),
        label: flattenOptionLabel(props.children),
        disabled: Boolean(props.disabled),
      });
      return;
    }
    if (typeof child.type === 'string' && child.type.toLowerCase() === 'optgroup') {
      items.push(...extractOptions((child.props as { children?: React.ReactNode }).children));
    }
  });
  return items;
}

const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      className,
      children,
      disabled,
      id,
      name,
      onBlur,
      onChange,
      onFocus,
      placeholder,
      value,
      defaultValue,
    },
    ref,
  ) => {
    const options = React.useMemo(() => extractOptions(children), [children]);
    const isControlled = value !== undefined;
    const initialValue = React.useMemo(() => {
      if (value !== undefined) {
        return String(value);
      }
      if (defaultValue !== undefined) {
        return String(defaultValue);
      }
      return options.find((option) => !option.disabled)?.value ?? '';
    }, [defaultValue, options, value]);
    const [internalValue, setInternalValue] = React.useState(initialValue);
    const [open, setOpen] = React.useState(false);
    const rootRef = React.useRef<HTMLDivElement | null>(null);
    const mergedButtonRef = React.useRef<HTMLButtonElement | null>(null);
    const listboxId = React.useId();

    React.useEffect(() => {
      if (isControlled) {
        setInternalValue(String(value ?? ''));
      }
    }, [isControlled, value]);

    React.useEffect(() => {
      if (isControlled) {
        return;
      }
      setInternalValue(initialValue);
    }, [initialValue, isControlled]);

    React.useEffect(() => {
      if (!open) {
        return;
      }
      const handlePointerDown = (event: MouseEvent) => {
        if (!rootRef.current?.contains(event.target as Node)) {
          setOpen(false);
        }
      };
      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          setOpen(false);
          mergedButtonRef.current?.focus();
        }
      };
      document.addEventListener('mousedown', handlePointerDown);
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('mousedown', handlePointerDown);
        document.removeEventListener('keydown', handleEscape);
      };
    }, [open]);

    const selectedValue = isControlled ? String(value ?? '') : internalValue;
    const selectedOption = options.find((option) => option.value === selectedValue);
    const triggerLabel = selectedOption?.label || placeholder || options[0]?.label || '';

    const emitChange = (nextValue: string) => {
      if (!isControlled) {
        setInternalValue(nextValue);
      }
      if (!onChange) {
        return;
      }
      const syntheticEvent = {
        target: { value: nextValue, name, id },
        currentTarget: { value: nextValue, name, id },
      } as React.ChangeEvent<HTMLSelectElement>;
      onChange(syntheticEvent);
    };

    const handleSelect = (nextValue: string) => {
      emitChange(nextValue);
      setOpen(false);
      mergedButtonRef.current?.focus();
    };

    const setRefs = (node: HTMLButtonElement | null) => {
      mergedButtonRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    };

    return (
      <div ref={rootRef} className="relative">
        <input type="hidden" name={name} value={selectedValue} />
        <button
          id={id}
          ref={setRefs}
          type="button"
          role="combobox"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              setOpen((current) => !current);
            }
          }}
          onFocus={onFocus as React.FocusEventHandler<HTMLButtonElement> | undefined}
          onBlur={onBlur as React.FocusEventHandler<HTMLButtonElement> | undefined}
          className={cn(
            'flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-input/80 bg-card/80 px-3.5 py-2 text-left text-sm ring-offset-background backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45',
            className,
          )}
        >
          <span className="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
            <span className="min-w-0 truncate">{triggerLabel}</span>
            {selectedOption?.badgeLabel ? (
              <span className="shrink-0 rounded-full border border-border/80 bg-muted/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {selectedOption.badgeLabel}
              </span>
            ) : null}
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
        {open ? (
          <div
            id={listboxId}
            role="listbox"
            className="absolute left-0 right-0 z-50 mt-2 max-h-72 overflow-auto rounded-xl border border-border/80 bg-popover/95 p-1 shadow-xl backdrop-blur"
          >
            {options.map((option) => {
              const active = option.value === selectedValue;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={disabled || option.disabled}
                  onClick={() => handleSelect(option.value)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    active
                      ? 'bg-primary/10 text-foreground'
                      : 'text-foreground hover:bg-muted/70',
                    (disabled || option.disabled) && 'cursor-not-allowed opacity-45',
                  )}
                >
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
                    <span className="min-w-0 truncate">{option.label}</span>
                    {option.badgeLabel ? (
                      <span
                        className={cn(
                          'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                          active
                            ? 'border-primary/30 bg-primary/10 text-primary'
                            : 'border-border/80 bg-muted/70 text-muted-foreground',
                        )}
                      >
                        {option.badgeLabel}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  },
);
Select.displayName = 'Select';

export { Select };
