import { Lock, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GatewayLifecycle } from '@/types/gateway';
import { LoadingIcon } from './LoadingSpinner';

function getSourceLabel(t: (key: string) => string, source?: string): string {
  if (
    source?.startsWith('channel:saveConfig:') ||
    source?.startsWith('channel:setEnabled') ||
    source?.startsWith('channel:delete')
  ) {
    return t('gateway.lifecycle.sources.channels');
  }
  if (
    source?.startsWith('create-agent') ||
    source?.startsWith('update-agent') ||
    source?.startsWith('assign-channel') ||
    source?.startsWith('delete-agent') ||
    source?.startsWith('remove-agent-channel')
  ) {
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
    case 'gateway.autoStart':
      return t('gateway.lifecycle.sources.startup');
    default:
      return t('gateway.lifecycle.sources.config');
  }
}

export function GatewayLifecycleOverlay({ lifecycle }: { lifecycle: GatewayLifecycle }) {
  const { t } = useTranslation('common');

  if (lifecycle.state !== 'scheduled' && lifecycle.state !== 'applying') {
    return null;
  }

  const sourceLabel = getSourceLabel(t, lifecycle.source);
  const isStart = lifecycle.action === 'start';
  const isReload = lifecycle.action === 'reload';
  const title =
    lifecycle.state === 'scheduled'
      ? isStart
        ? t('gateway.lifecycle.scheduledStartTitle')
        : isReload
        ? t('gateway.lifecycle.scheduledReloadTitle')
        : t('gateway.lifecycle.scheduledRestartTitle')
      : isStart
        ? t('gateway.lifecycle.applyingStartTitle')
        : isReload
        ? t('gateway.lifecycle.applyingReloadTitle')
        : t('gateway.lifecycle.applyingRestartTitle');
  const description =
    lifecycle.state === 'scheduled'
      ? t('gateway.lifecycle.scheduledDescription', { source: sourceLabel })
      : t('gateway.lifecycle.applyingDescription', { source: sourceLabel });

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-background/72 backdrop-blur-[3px]">
      <div className="mx-6 w-full max-w-md rounded-[20px] border border-border/80 bg-card/95 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-500/[0.12] text-sky-600 dark:text-sky-400">
            {lifecycle.state === 'scheduled' ? (
              <RefreshCw className="h-5 w-5" />
            ) : (
              <LoadingIcon className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold tracking-tight text-foreground">{title}</div>
            <div className="mt-2 text-[13px] leading-[1.7] text-muted-foreground">{description}</div>
            <div className="mt-3 inline-flex items-center rounded-full bg-sky-500/[0.10] px-2.5 py-1 text-[11px] font-medium text-sky-700 dark:text-sky-300">
              {sourceLabel}
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2 rounded-xl border border-border/70 bg-muted/35 px-3 py-2.5 text-[12px] text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          <span>{t('gateway.lifecycle.overlayBlockedHint')}</span>
        </div>
      </div>
    </div>
  );
}
