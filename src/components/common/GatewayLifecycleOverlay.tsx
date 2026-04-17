import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
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
  if (source === 'provider.runtimeSync') {
    return t('gateway.lifecycle.sources.models');
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

function shouldBlockLifecycle(lifecycle: GatewayLifecycle, pathname: string): boolean {
  if (pathname !== '/') return false;
  if (lifecycle.state !== 'applying' || lifecycle.action !== 'restart') return false;

  return (
    lifecycle.source === 'gateway.manualRestart'
    || lifecycle.source === 'security.apply'
    || lifecycle.source === 'security.reset'
  );
}

export function GatewayLifecycleOverlay({ lifecycle }: { lifecycle: GatewayLifecycle }) {
  const { t } = useTranslation('common');
  const location = useLocation();
  const shouldBlock = shouldBlockLifecycle(lifecycle, location.pathname);

  if (!shouldBlock) {
    return null;
  }

  const sourceLabel = getSourceLabel(t, lifecycle.source);
  const title = t('gateway.lifecycle.applyingRestartTitle');
  const description = t('gateway.lifecycle.applyingDescription', { source: sourceLabel });

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-background/72 backdrop-blur-[3px]">
      <div className="mx-6 w-full max-w-sm rounded-[20px] border border-border/80 bg-card/95 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-500/[0.12] text-sky-600 dark:text-sky-400">
            <LoadingIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold tracking-tight text-foreground">{title}</div>
            <div className="mt-2 text-[13px] leading-[1.7] text-muted-foreground">{description}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
