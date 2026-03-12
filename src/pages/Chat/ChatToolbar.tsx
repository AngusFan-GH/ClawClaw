/**
 * Chat Toolbar
 * Model selector, gateway status, refresh, and thinking toggle.
 * Rendered in the Header when on the Chat page.
 */
import { RefreshCw, Brain, Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ChatToolbarModelOption {
  value: string;
  label: string;
  shortLabel: string;
}

export function ChatToolbar({
  modelOptions = [],
  selectedModel,
  defaultModelValue,
  defaultModelShortLabel,
  currentAgentLabel,
  showAgentLabel = false,
  onModelChange,
  onConfigureModels,
  modelDisabled = false,
}: {
  modelOptions?: ChatToolbarModelOption[];
  selectedModel?: string;
  defaultModelValue?: string;
  defaultModelShortLabel?: string;
  currentAgentLabel?: string;
  showAgentLabel?: boolean;
  onModelChange?: (model?: string) => void | Promise<void>;
  onConfigureModels?: () => void;
  modelDisabled?: boolean;
}) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const { t } = useTranslation(['chat', 'common']);
  const hasModelOptions = modelOptions.length > 0;
  const currentModelValue = selectedModel || defaultModelValue;
  const selectedOption = modelOptions.find((option) => option.value === currentModelValue);
  const currentModelShortLabel =
    selectedOption?.shortLabel || defaultModelShortLabel || t('chat:composer.defaultModel');

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

  const gatewayStatusLabel =
    gatewayStatus.state === 'running'
      ? t('common:status.connected')
      : gatewayStatus.state === 'error'
        ? t('common:status.error')
        : gatewayStatus.state === 'starting'
          ? t('common:status.loading')
          : t('common:status.disconnected');

  return (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="flex min-w-0 items-center">
        <div className="flex min-w-0 items-center gap-2">
          {showAgentLabel && currentAgentLabel ? (
            <div
              className="flex h-8 max-w-[140px] items-center rounded-[10px] border border-black/10 bg-white/80 px-3 text-[12px] text-foreground/80 dark:border-white/10 dark:bg-white/[0.06]"
              title={currentAgentLabel}
            >
              <span className="truncate font-medium">{currentAgentLabel}</span>
            </div>
          ) : null}
          {hasModelOptions ? (
            <div className="relative" ref={modelMenuRef}>
              <button
                type="button"
                aria-label={t('chat:composer.modelAriaLabel')}
                className="flex h-8 min-w-[132px] max-w-[180px] items-center gap-2 rounded-[10px] border border-black/10 bg-white/80 px-3 text-left text-[12px] text-foreground transition-colors hover:border-black/20 dark:border-white/10 dark:bg-white/[0.06] dark:hover:border-white/20"
                disabled={loading || modelDisabled}
                onClick={() => setModelMenuOpen((open) => !open)}
              >
                <span className="truncate font-medium">{currentModelShortLabel}</span>
                <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
              {modelMenuOpen && (
                <div className="absolute left-0 top-full z-50 mt-2 min-w-[220px] overflow-hidden rounded-[10px] border border-black/10 bg-card/95 p-1 dark:border-white/10 dark:bg-card/95">
                  {modelOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[13px] text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                      onClick={() => {
                        setModelMenuOpen(false);
                        void onModelChange?.(
                          selectedModel && defaultModelValue && option.value === defaultModelValue
                            ? undefined
                            : option.value
                        );
                      }}
                    >
                      <span className="flex-1 truncate">{option.label}</span>
                      {currentModelValue === option.value && (
                        <Check className="h-3.5 w-3.5 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : onConfigureModels ? (
            <Button
              type="button"
              variant="outline"
              onClick={onConfigureModels}
              className="h-8 rounded-[10px] border-black/10 bg-white/80 px-3 text-[12px] font-medium text-foreground/80 shadow-none hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:bg-white/[0.06] dark:hover:bg-white/5"
            >
              {t('chat:composer.configureModels')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Badge
          variant="secondary"
          className={cn(
            'h-8 rounded-[10px] border px-3 text-[12px]',
            gatewayStatus.state === 'running'
              ? 'border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-500'
              : gatewayStatus.state === 'error'
                ? 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-500'
                : 'border-black/10 bg-white/80 text-muted-foreground dark:border-white/10 dark:bg-white/[0.06]'
          )}
        >
          {gatewayStatusLabel}
        </Badge>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => refresh()}
              disabled={loading}
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('toolbar.refresh')}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-8 w-8',
                showThinking && 'bg-primary/10 text-primary',
              )}
              onClick={toggleThinking}
            >
              <Brain className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
