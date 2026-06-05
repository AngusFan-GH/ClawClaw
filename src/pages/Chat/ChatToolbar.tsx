/**
 * Chat Toolbar
 * Model selector, refresh, and thinking toggle.
 * Rendered in the Header when on the Chat page.
 */
import { Select } from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { RefreshButton } from '@/components/common/RefreshButton';
import { Blocks, Brain, Clock3, Download, Focus, Search, Settings2, X } from 'lucide-react';
import { useChatStore } from '@/stores/chat';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ChatToolbarModelOption {
  value: string;
  label: string;
  shortLabel: string;
}

export function ChatToolbar({
  currentAgentLabel,
  showAgentLabel = false,
  searchQuery,
  onSearchChange,
  canExport = false,
  onExport,
  showToolCalls = true,
  onToggleToolCalls,
  showThinking = false,
  onToggleThinking,
  chatFocusMode = false,
  onToggleFocusMode,
  hiddenCronCount = 0,
  hideCronSessions = true,
  onToggleCronSessions,
  autoScrollMode = 'near-bottom',
  onAutoScrollModeChange,
}: {
  currentAgentLabel?: string;
  showAgentLabel?: boolean;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  canExport?: boolean;
  onExport?: () => void;
  showToolCalls?: boolean;
  onToggleToolCalls?: () => void;
  showThinking?: boolean;
  onToggleThinking?: () => void;
  chatFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  hiddenCronCount?: number;
  hideCronSessions?: boolean;
  onToggleCronSessions?: () => void;
  autoScrollMode?: 'always' | 'near-bottom' | 'off';
  onAutoScrollModeChange?: (mode: 'always' | 'near-bottom' | 'off') => void;
}) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const { t } = useTranslation(['chat', 'common']);

  useEffect(() => {
    if (!modelMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModelMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [modelMenuOpen]);

  return (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="flex min-w-0 shrink-0 items-center">
        {showAgentLabel && currentAgentLabel ? (
          <div
            className="flex h-8 max-w-[140px] items-center rounded-[10px] border border-black/10 bg-white/80 px-3 text-[12px] text-foreground/80 dark:border-white/10 dark:bg-white/[0.06]"
            title={currentAgentLabel}
          >
            <span className="truncate font-medium">{currentAgentLabel}</span>
          </div>
        ) : null}
      </div>

      {onSearchChange ? (
        <div className="flex min-w-0 flex-1 justify-center px-4">
          <div className="flex h-8 w-full max-w-sm items-center rounded-[10px] border border-black/10 bg-white/80 px-3 text-[12px] text-foreground/80 dark:border-white/10 dark:bg-white/[0.06]">
            <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              className="flex-1 border-0 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
              placeholder={t('common:actions.search', 'Search')}
              value={searchQuery ?? ''}
              onChange={(e) => onSearchChange(e.target.value)}
              aria-label="Search"
            />
            {searchQuery ? (
              <button
                type="button"
                className="ml-1 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => onSearchChange('')}
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex shrink-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <RefreshButton
              label={t('toolbar.refresh')}
              loading={loading}
              mode="icon"
              variant="ghost"
              className="h-8 w-8 rounded-lg border-0 bg-transparent"
              onClick={() => refresh()}
            />
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('toolbar.refresh')}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
              onClick={onExport}
              disabled={!canExport}
              aria-label={t('toolbar.exportChat', 'Export chat')}
              title={t('toolbar.exportChat', 'Export chat')}
            >
              <Download className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('toolbar.exportChat', 'Export chat')}</p>
          </TooltipContent>
        </Tooltip>

        {onToggleToolCalls ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  'relative inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                  showToolCalls
                    ? 'text-primary hover:bg-primary/10'
                    : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10'
                )}
                onClick={onToggleToolCalls}
                aria-label={t('toolbar.toolCallsToggle', 'Toggle tool calls and tool results')}
                title={t('toolbar.toolCallsToggle', 'Toggle tool calls and tool results')}
              >
                <Blocks className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('toolbar.toolCallsToggle', 'Toggle tool calls and tool results')}</p>
            </TooltipContent>
          </Tooltip>
        ) : null}

        {onToggleThinking ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                  showThinking
                    ? 'text-primary hover:bg-primary/10'
                    : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10'
                )}
                onClick={onToggleThinking}
                aria-label={showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}
                title={showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}
              >
                <Brain className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}</p>
            </TooltipContent>
          </Tooltip>
        ) : null}

        <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                  aria-label={t('toolbar.settings', 'Chat settings')}
                  title={t('toolbar.settings', 'Chat settings')}
                >
                  <Settings2 className="h-4 w-4" />
                </button>
              </SheetTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('toolbar.settings', 'Chat settings')}</p>
            </TooltipContent>
          </Tooltip>
          <SheetContent side="right" className="w-[360px] max-w-[95vw]">
            <SheetHeader>
              <SheetTitle>{t('toolbar.settings', 'Chat settings')}</SheetTitle>
              <SheetDescription>
                {t('toolbar.chatSettingsDescription', 'Control local chat display and scrolling behavior.')}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {t('toolbar.autoScrollMode', 'Auto-scroll mode')}
                </label>
                <Select
                  value={autoScrollMode}
                  onChange={(event) => onAutoScrollModeChange?.(event.target.value as 'always' | 'near-bottom' | 'off')}
                >
                  <option value="always">{t('toolbar.autoScrollAlways', 'Always')}</option>
                  <option value="near-bottom">{t('toolbar.autoScrollNearBottom', 'Near bottom')}</option>
                  <option value="off">{t('toolbar.autoScrollOff', 'Off')}</option>
                </Select>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {onToggleFocusMode ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                  chatFocusMode
                    ? 'text-primary hover:bg-primary/10'
                    : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10'
                )}
                onClick={onToggleFocusMode}
                aria-label={t('toolbar.focusToggle', 'Toggle focus mode (hide sidebar + page header)')}
                title={t('toolbar.focusToggle', 'Toggle focus mode (hide sidebar + page header)')}
              >
                <Focus className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('toolbar.focusToggle', 'Toggle focus mode (hide sidebar + page header)')}</p>
            </TooltipContent>
          </Tooltip>
        ) : null}

        {onToggleCronSessions ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  'relative inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                  hideCronSessions
                    ? 'text-primary hover:bg-primary/10'
                    : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10'
                )}
                onClick={onToggleCronSessions}
                aria-label={
                  hideCronSessions
                    ? t('toolbar.showCronSessions', 'Show cron sessions')
                    : t('toolbar.hideCronSessions', 'Hide cron sessions')
                }
                title={
                  hideCronSessions
                    ? t('toolbar.showCronSessions', 'Show cron sessions')
                    : t('toolbar.hideCronSessions', 'Hide cron sessions')
                }
              >
                <Clock3 className="h-4 w-4" />
                {hideCronSessions && hiddenCronCount > 0 ? (
                  <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-4 text-white">
                    {hiddenCronCount}
                  </span>
                ) : null}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {hideCronSessions
                  ? t('toolbar.showCronSessionsHidden', {
                    count: hiddenCronCount,
                    defaultValue: `Show cron sessions (${hiddenCronCount} hidden)`,
                  })
                  : t('toolbar.hideCronSessions', 'Hide cron sessions')}
              </p>
            </TooltipContent>
          </Tooltip>
        ) : null}

      </div>
    </div>
  );
}
