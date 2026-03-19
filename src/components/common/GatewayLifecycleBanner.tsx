import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GatewayLifecycle } from '@/types/gateway';
import { cn } from '@/lib/utils';

function getSourceLabel(t: (key: string) => string, source?: string): string {
  if (source?.startsWith('channel:saveConfig:') || source?.startsWith('channel:setEnabled') || source?.startsWith('channel:delete')) {
    return t('gateway.lifecycle.sources.channels');
  }
  if (source?.startsWith('create-agent') || source?.startsWith('update-agent') || source?.startsWith('assign-channel') || source?.startsWith('delete-agent') || source?.startsWith('remove-agent-channel')) {
    return t('gateway.lifecycle.sources.agents');
  }

  switch (source) {
    case 'settings.proxy':
      return t('gateway.lifecycle.sources.proxy');
    case 'security.apply':
    case 'security.reset':
      return t('gateway.lifecycle.sources.security');
    case 'gateway.manualRestart':
      return t('gateway.lifecycle.sources.manual');
    default:
      return t('gateway.lifecycle.sources.config');
  }
}

export function GatewayLifecycleBanner({ lifecycle }: { lifecycle: GatewayLifecycle }) {
  const { t } = useTranslation('common');

  if (lifecycle.state !== 'failed') return null;

  const sourceLabel = getSourceLabel(t, lifecycle.source);
  const title = t('gateway.lifecycle.failedTitle');
  const description = lifecycle.error || t('gateway.lifecycle.failedDescription');

  return (
    <div
      className={cn(
        'mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors',
        'border-destructive/30 bg-destructive/10'
      )}
    >
      <div className="mt-0.5 shrink-0">
        <AlertCircle className="h-4.5 w-4.5 text-destructive" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[13px] font-medium text-foreground">{title}</div>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
              'bg-destructive/12 text-destructive'
            )}
          >
            {sourceLabel}
          </span>
        </div>
        <div className="mt-1 text-[12px] leading-[1.6] text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}
