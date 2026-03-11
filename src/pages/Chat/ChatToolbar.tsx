/**
 * Chat Toolbar
 * Session selector, new session, refresh, and thinking toggle.
 * Rendered in the Header when on the Chat page.
 */
import { RefreshCw, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

export function ChatToolbar() {
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const { t } = useTranslation(['chat', 'common']);

  const gatewayStatusLabel =
    gatewayStatus.state === 'running'
      ? t('common:status.connected')
      : gatewayStatus.state === 'error'
        ? t('common:status.error')
        : gatewayStatus.state === 'starting'
          ? t('common:status.loading')
          : t('common:status.disconnected');

  return (
    <div className="flex items-center gap-2">
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

      {/* Refresh */}
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

      {/* Thinking Toggle */}
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
  );
}
