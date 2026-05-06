import type { GatewayLifecycle } from '@/types/gateway';

type Translate = (key: string) => string;

export function getGatewayLifecycleSourceLabel(t: Translate, source?: string): string {
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

export function isManualGatewayRestartInProgress(lifecycle: GatewayLifecycle): boolean {
  return (
    lifecycle.action === 'restart' &&
    lifecycle.source === 'gateway.manualRestart' &&
    (lifecycle.state === 'scheduled' || lifecycle.state === 'applying')
  );
}
