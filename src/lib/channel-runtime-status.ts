import type { TFunction } from 'i18next';
import type { Status } from '@/components/common/StatusBadge';

export type ChannelRuntimeState = 'connected' | 'connecting' | 'configured' | 'error' | 'disconnected' | 'unknown';

export function resolveChannelRuntimeStatusMeta(
  status: ChannelRuntimeState,
  t: TFunction<'agents' | 'channels'>,
): { status: Status; label: string } {
  switch (status) {
    case 'connected':
      return { status: 'connected', label: t('runtime.connected', '已连接') };
    case 'connecting':
      return { status: 'connecting', label: t('runtime.connecting', '连接中') };
    case 'configured':
      return { status: 'configured', label: t('runtime.configuredOnly', '已配置') };
    case 'error':
      return { status: 'error', label: t('runtime.error', '错误') };
    case 'unknown':
      return { status: 'disconnected', label: t('runtime.unknown', '未知') };
    case 'disconnected':
    default:
      return { status: 'disconnected', label: t('runtime.disconnected', '未连接') };
  }
}
