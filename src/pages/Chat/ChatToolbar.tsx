/**
 * Chat Toolbar
 * Model selector, gateway status, refresh, and thinking toggle.
 * Rendered in the Header when on the Chat page.
 */
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { RefreshButton } from '@/components/common/RefreshButton';
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
  currentAgentLabel,
  showAgentLabel = false,
}: {
  currentAgentLabel?: string;
  showAgentLabel?: boolean;
}) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const gatewayInitialized = useGatewayStore((s) => s.isInitialized);
  const { t } = useTranslation(['chat', 'common']);
  const displayGatewayState = gatewayInitialized ? gatewayStatus.state : 'starting';

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
    displayGatewayState === 'running'
      ? t('toolbar.gatewayRunning')
      : displayGatewayState === 'error'
        ? t('toolbar.gatewayError')
        : displayGatewayState === 'starting'
          ? t('toolbar.gatewayStarting')
          : displayGatewayState === 'reconnecting'
            ? t('toolbar.gatewayReconnecting')
            : t('toolbar.gatewayStopped');

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
        <Badge
          variant="secondary"
          className={cn(
            'h-8 rounded-[10px] border px-3 text-[12px]',
            displayGatewayState === 'running'
              ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
              : displayGatewayState === 'error'
                ? 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
                : displayGatewayState === 'starting' || displayGatewayState === 'reconnecting'
                  ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400'
                  : 'border-black/10 bg-white/80 text-muted-foreground dark:border-white/10 dark:bg-white/[0.06]'
          )}
        >
          <span className="inline-flex items-center gap-2">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                displayGatewayState === 'running'
                  ? 'bg-emerald-500'
                  : displayGatewayState === 'error'
                    ? 'bg-red-500'
                    : displayGatewayState === 'starting' || displayGatewayState === 'reconnecting'
                      ? 'bg-sky-500 animate-pulse'
                      : 'bg-muted-foreground/60'
              )}
            />
            {gatewayStatusLabel}
          </span>
        </Badge>

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

        {null}
      </div>
    </div>
  );
}
