import type { MutableRefObject, RefObject } from 'react';
import { cn } from '@/lib/utils';
import type { SlashCommandDef } from './slash-commands';

export function ChatSlashMenu({
  menuRef,
  mode,
  argCommand,
  argItems,
  menuIndex,
  menuItems,
  groupedCommands,
  itemRefs,
  onHoverIndex,
  onApplyArg,
  onApplyCommand,
  getCommandDescription,
  getCategoryLabel,
  labels,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  mode: 'command' | 'args';
  argCommand: SlashCommandDef | null;
  argItems: string[];
  menuIndex: number;
  menuItems: SlashCommandDef[];
  groupedCommands: Record<string, SlashCommandDef[]>;
  itemRefs: MutableRefObject<Array<HTMLButtonElement | null>>;
  onHoverIndex: (index: number) => void;
  onApplyArg: (value: string) => void;
  onApplyCommand: (command: SlashCommandDef) => void;
  getCommandDescription: (command: SlashCommandDef) => string;
  getCategoryLabel: (category: string) => string;
  labels: {
    title: string;
    enterSelect: string;
    tabFill: string;
    escClose: string;
    navigate: string;
    optionsSuffix: string;
  };
}) {
  return (
    <div
      ref={menuRef}
      className="absolute inset-x-3 bottom-[calc(100%+14px)] z-[140] overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.16)] ring-1 ring-slate-200 dark:border-slate-800 dark:bg-slate-950 dark:ring-slate-800"
    >
      {mode === 'args' && argCommand ? (
        <>
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <span className="font-semibold text-slate-900 dark:text-slate-100">/{argCommand.name}</span>
            <span className="ml-2">{getCommandDescription(argCommand)}</span>
          </div>
          <div className="max-h-72 overflow-y-auto px-2 py-2">
            {argItems.map((arg, index) => (
              <button
                key={`${argCommand.key}:${arg}`}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                className={cn(
                  'grid w-full grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-3 rounded-[14px] border px-4 py-3 text-left transition-all outline-none',
                  index === menuIndex
                    ? 'border-primary/35 bg-primary/[0.10] text-slate-950 shadow-[0_10px_30px_rgba(37,99,235,0.12)] dark:bg-primary/20'
                    : 'border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-800 dark:hover:bg-slate-900/80'
                )}
                onMouseEnter={() => onHoverIndex(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onApplyArg(arg)}
              >
                <span
                  className={cn(
                    'h-8 w-1.5 shrink-0 rounded-full transition-colors',
                    index === menuIndex ? 'bg-primary' : 'bg-transparent'
                  )}
                />
                <span
                  className={cn(
                    'rounded-full px-2.5 py-1 font-mono text-xs',
                    index === menuIndex
                      ? 'bg-primary/15 text-primary dark:bg-primary/25 dark:text-slate-50'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  )}
                >
                  {arg}
                </span>
                <span
                  className={cn(
                    'truncate text-xs',
                    index === menuIndex
                      ? 'text-slate-700 dark:text-slate-200'
                      : 'text-slate-500 dark:text-slate-400'
                  )}
                >
                  /{argCommand.name} {arg}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-5 py-2.5 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <span>{labels.enterSelect}</span>
            <span>{labels.tabFill}</span>
            <span>{labels.escClose}</span>
          </div>
        </>
      ) : (
        <>
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            {labels.title}
          </div>
          <div className="max-h-80 overflow-y-auto px-2 py-2">
            {Object.entries(groupedCommands).map(([category, commands]) => (
              <div key={category} className="py-1">
                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                  {getCategoryLabel(category)}
                </div>
                {commands.map((command) => {
                  const globalIndex = menuItems.findIndex((item) => item.key === command.key);
                  return (
                    <button
                      key={command.key}
                      ref={(node) => {
                        itemRefs.current[globalIndex] = node;
                      }}
                      type="button"
                      className={cn(
                        'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border px-4 py-3 text-left transition-all outline-none',
                        globalIndex === menuIndex
                          ? 'border-primary/35 bg-primary/[0.10] text-slate-950 shadow-[0_10px_30px_rgba(37,99,235,0.12)] dark:bg-primary/20'
                          : 'border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-800 dark:hover:bg-slate-900/80'
                      )}
                      onMouseEnter={() => onHoverIndex(globalIndex)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onApplyCommand(command)}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span
                          className={cn(
                            'mt-0.5 h-8 w-1.5 shrink-0 rounded-full transition-colors',
                            globalIndex === menuIndex ? 'bg-primary' : 'bg-transparent'
                          )}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-slate-950 dark:text-slate-50">
                              /{command.name}
                            </span>
                            {command.args ? (
                              <span
                                className={cn(
                                  'truncate text-xs',
                                  globalIndex === menuIndex
                                    ? 'text-slate-700 dark:text-slate-200'
                                    : 'text-slate-500 dark:text-slate-400'
                                )}
                              >
                                {command.args}
                              </span>
                            ) : null}
                          </div>
                          <div
                            className={cn(
                              'truncate text-xs',
                              globalIndex === menuIndex
                                ? 'text-slate-700 dark:text-slate-200'
                                : 'text-slate-500 dark:text-slate-400'
                            )}
                          >
                            {getCommandDescription(command)}
                          </div>
                        </div>
                      </div>
                      {command.argOptions?.length ? (
                        <span
                          className={cn(
                            'rounded-full px-2.5 py-1 text-[11px]',
                            globalIndex === menuIndex
                              ? 'bg-primary/15 text-primary dark:bg-primary/25 dark:text-slate-50'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                          )}
                        >
                          {command.argOptions.length} {labels.optionsSuffix}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-5 py-2.5 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <span>{labels.navigate}</span>
            <span>{labels.tabFill}</span>
            <span>{labels.enterSelect}</span>
            <span>{labels.escClose}</span>
          </div>
        </>
      )}
    </div>
  );
}
