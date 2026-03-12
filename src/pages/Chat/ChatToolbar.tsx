/**
 * Chat Toolbar
 * Model selector, gateway status, refresh, and thinking toggle.
 * Rendered in the Header when on the Chat page.
 */
import { RefreshCw, Brain, Check, ChevronsUpDown, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LoadingIcon } from '@/components/common/LoadingSpinner';
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
  isEmpty = false,
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
  isEmpty?: boolean;
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
  void hasModelOptions;
  void currentModelShortLabel;

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
        {showAgentLabel && currentAgentLabel ? (
          <div
            className="flex h-8 max-w-[140px] items-center rounded-[10px] border border-black/10 bg-white/80 px-3 text-[12px] text-foreground/80 dark:border-white/10 dark:bg-white/[0.06]"
            title={currentAgentLabel}
          >
            <span className="truncate font-medium">{currentAgentLabel}</span>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isEmpty ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'relative h-10 w-10 rounded-[12px] border shadow-none',
                  gatewayStatus.state === 'running'
                    ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-600 hover:bg-emerald-500/16 dark:text-emerald-400'
                    : gatewayStatus.state === 'error'
                      ? 'border-red-500/35 bg-red-500/10 text-red-600 hover:bg-red-500/14 dark:text-red-400'
                      : gatewayStatus.state === 'starting'
                        ? 'border-sky-500/35 bg-sky-500/10 text-sky-600 hover:bg-sky-500/14 dark:text-sky-400'
                        : 'border-black/10 bg-white/80 text-muted-foreground/80 hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.06] dark:hover:bg-white/5'
                )}
                disabled
              >
                {gatewayStatus.state === 'starting' ? (
                  <>
                    <span className="absolute inset-0 rounded-[12px] border border-sky-500/30 animate-ping" />
                    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-sky-500 shadow-[0_0_0_2px_rgba(255,255,255,0.9)] dark:shadow-[0_0_0_2px_rgba(17,24,39,0.9)]" />
                  </>
                ) : gatewayStatus.state === 'running' ? (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_2px_rgba(255,255,255,0.9)] dark:shadow-[0_0_0_2px_rgba(17,24,39,0.9)]" />
                ) : gatewayStatus.state === 'error' ? (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 shadow-[0_0_0_2px_rgba(255,255,255,0.9)] dark:shadow-[0_0_0_2px_rgba(17,24,39,0.9)]" />
                ) : null}
                <Link2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{gatewayStatusLabel}</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Badge
            variant="secondary"
            className={cn(
              'h-8 rounded-[10px] border px-3 text-[12px]',
              gatewayStatus.state === 'running'
                ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                : gatewayStatus.state === 'error'
                  ? 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
                  : gatewayStatus.state === 'starting'
                    ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400'
                    : 'border-black/10 bg-white/80 text-muted-foreground dark:border-white/10 dark:bg-white/[0.06]'
            )}
          >
            <span className="inline-flex items-center gap-2">
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  gatewayStatus.state === 'running'
                    ? 'bg-emerald-500'
                    : gatewayStatus.state === 'error'
                      ? 'bg-red-500'
                      : gatewayStatus.state === 'starting'
                        ? 'bg-sky-500 animate-pulse'
                        : 'bg-muted-foreground/60'
                )}
              />
              {gatewayStatusLabel}
            </span>
          </Badge>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                isEmpty
                  ? 'h-10 w-10 rounded-[12px] border border-black/10 bg-white/80 shadow-none hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.06] dark:hover:bg-white/5'
                  : 'h-8 w-8'
              )}
              onClick={() => refresh()}
              disabled={loading}
            >
              {loading ? <LoadingIcon className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('toolbar.refresh')}</p>
          </TooltipContent>
        </Tooltip>

        {null}
      </div>
    </div>
  );
}
