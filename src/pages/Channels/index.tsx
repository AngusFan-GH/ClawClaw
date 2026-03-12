/**
 * Channels Page
 * Manage messaging channel connections with configuration UI
 */
import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trash2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingIcon, PageLoader } from '@/components/common/LoadingSpinner';
import { useChannelsStore } from '@/stores/channels';
import { useGatewayStore } from '@/stores/gateway';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { ChannelConfigModal } from '@/components/channels/ChannelConfigModal';
import { PageHeader } from '@/components/layout/PageHeader';
import { cn } from '@/lib/utils';
import {
  CHANNEL_ICONS,
  CHANNEL_NAMES,
  CHANNEL_META,
  getAllChannels,
  getPrimaryChannels,
  type ChannelType,
  type Channel,
} from '@/types/channel';
import { useTranslation } from 'react-i18next';

import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

type DisplayChannel = Channel & {
  configured: boolean;
  runtimeLoaded: boolean;
  runtimeStatus: Channel['status'] | 'unknown';
};

const CHANNEL_BRAND_STYLES: Partial<Record<ChannelType, { shell: string; icon: string }>> = {
  telegram: {
    shell: 'bg-[#27A7E7] border-[#1f8ec7] shadow-[0_10px_24px_rgba(39,167,231,0.22)]',
    icon: 'brightness-0 invert',
  },
  discord: {
    shell: 'bg-[#5865F2] border-[#4752c4] shadow-[0_10px_24px_rgba(88,101,242,0.22)]',
    icon: 'brightness-0 invert',
  },
  whatsapp: {
    shell: 'bg-[#25D366] border-[#1faf54] shadow-[0_10px_24px_rgba(37,211,102,0.2)]',
    icon: 'brightness-0 invert',
  },
  feishu: {
    shell: 'bg-[linear-gradient(135deg,#0F67FF,#00C2FF)] border-[#0f67ff] shadow-[0_10px_24px_rgba(15,103,255,0.22)]',
    icon: 'brightness-0 invert',
  },
  dingtalk: {
    shell: 'bg-[#1677FF] border-[#0f5fd1] shadow-[0_10px_24px_rgba(22,119,255,0.22)]',
    icon: 'brightness-0 invert',
  },
  wecom: {
    shell: 'bg-[linear-gradient(135deg,#07C160,#00A1EA)] border-[#07c160] shadow-[0_10px_24px_rgba(7,193,96,0.22)]',
    icon: 'brightness-0 invert',
  },
  qqbot: {
    shell: 'bg-[linear-gradient(135deg,#12B7F5,#4E8CFF)] border-[#12b7f5] shadow-[0_10px_24px_rgba(18,183,245,0.22)]',
    icon: 'brightness-0 invert',
  },
};

export function Channels() {
  const { t } = useTranslation('channels');
  const { channels, loading, error, fetchChannels, deleteChannel } = useChannelsStore();
  const gatewayStatus = useGatewayStore((state) => state.status);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedChannelType, setSelectedChannelType] = useState<ChannelType | null>(null);
  const [configuredTypes, setConfiguredTypes] = useState<string[]>([]);
  const [configuredTypesReady, setConfiguredTypesReady] = useState(false);
  const [channelToDelete, setChannelToDelete] = useState<{ id: string } | null>(null);

  const fetchConfiguredTypes = useCallback(async () => {
    try {
      const result = await hostApiFetch<{
        success: boolean;
        channels?: string[];
      }>('/api/channels/configured');
      if (result.success && result.channels) {
        setConfiguredTypes(result.channels);
      }
    } catch {
      // Ignore refresh errors here and keep the last known state.
    } finally {
      setConfiguredTypesReady(true);
    }
  }, []);

  useEffect(() => {
    void fetchConfiguredTypes();
    void fetchChannels();
  }, [fetchChannels, fetchConfiguredTypes]);

  useEffect(() => {
    const unsubscribe = subscribeHostEvent('gateway:channel-status', () => {
      void fetchChannels();
      void fetchConfiguredTypes();
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [fetchChannels, fetchConfiguredTypes]);

  const safeChannels = Array.isArray(channels) ? channels : [];
  const displayedChannelTypes = getPrimaryChannels();
  const allChannelTypes = getAllChannels();
  const configuredChannelTypeSet = new Set<ChannelType>();
  const configuredDisplayChannels: DisplayChannel[] = [];

  for (const channel of safeChannels) {
    configuredChannelTypeSet.add(channel.type);
    configuredDisplayChannels.push({
      ...channel,
      configured: channel.configured ?? true,
      runtimeLoaded: channel.runtimeLoaded ?? true,
      runtimeStatus: channel.runtimeStatus ?? channel.status,
    });
  }

  for (const type of configuredTypes) {
    if (!(type in CHANNEL_META)) continue;
    const typedType = type as ChannelType;
    if (configuredChannelTypeSet.has(typedType)) continue;
    configuredChannelTypeSet.add(typedType);
    configuredDisplayChannels.push({
      id: `${typedType}-default`,
      type: typedType,
      name: CHANNEL_NAMES[typedType],
      status: 'disconnected',
      configured: true,
      runtimeLoaded: false,
      runtimeStatus: gatewayStatus.state === 'running' ? 'unknown' : 'disconnected',
    });
  }

  configuredDisplayChannels.sort((a, b) => {
    return allChannelTypes.indexOf(a.type) - allChannelTypes.indexOf(b.type);
  });

  const handleRefresh = () => {
    void Promise.all([fetchChannels(), fetchConfiguredTypes()]);
  };

  const isLoadingConfiguredTypes = !configuredTypesReady;
  const showRefreshingHint = loading && configuredTypesReady;
  const statusText = isLoadingConfiguredTypes
    ? t('loadingConfiguredStatus', '正在加载连接配置...')
    : showRefreshingHint
      ? t('refreshingStatus', '正在刷新连接状态...')
      : null;

  const showPageLoader =
    (loading || isLoadingConfiguredTypes) && configuredDisplayChannels.length === 0;

  return (
    <div className="flex flex-col -m-6 bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 pb-8 pt-10 md:px-8">
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={(
            <div className="flex flex-wrap items-center gap-2.5">
              {statusText && (
                <div className="inline-flex h-9 items-center gap-2 rounded-[12px] border border-border/70 bg-card/85 px-3 text-[13px] font-medium text-muted-foreground">
                  <LoadingIcon className="h-3.5 w-3.5" />
                  <span>{statusText}</span>
                </div>
              )}
              <Button
                variant="outline"
                onClick={handleRefresh}
                disabled={gatewayStatus.state !== 'running'}
                className="h-9 rounded-[12px] border-black/10 bg-transparent px-4 text-[13px] font-medium text-foreground/80 shadow-none transition-colors hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
              >
                {loading ? <LoadingIcon className="h-3.5 w-3.5 mr-2" /> : <RefreshCw className="h-3.5 w-3.5 mr-2" />}
                {t('refresh')}
              </Button>
            </div>
          )}
        />

        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          {showPageLoader ? (
            <PageLoader
              title={t('loadingTitle', '正在加载连接')}
              description={t('loadingDescription', '正在同步已配置渠道和运行状态，请稍候。')}
            />
          ) : (
            <>
          {gatewayStatus.state !== 'running' && (
            <div className="mb-8 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <span className="text-yellow-700 dark:text-yellow-400 text-sm font-medium">
                {t('gatewayWarning')}
              </span>
            </div>
          )}

          {error && (
            <div className="mb-8 p-4 rounded-xl border border-destructive/50 bg-destructive/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive text-sm font-medium">
                {error}
              </span>
            </div>
          )}

          {configuredDisplayChannels.length > 0 && (
            <section className="mb-8 rounded-[18px] border border-border/70 bg-card/78 p-4 md:p-5">
              <div className="mb-5 flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                    {t('configured')}
                  </h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {t('configuredDesc')}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {configuredDisplayChannels.map((channel) => (
                  <ChannelCard
                    key={channel.id}
                    channel={channel}
                    onClick={() => {
                      setSelectedChannelType(channel.type);
                      setShowAddDialog(true);
                    }}
                    onDelete={() => setChannelToDelete({ id: channel.id })}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="mb-8 rounded-[18px] border border-border/70 bg-card/78 p-4 md:p-5">
            <div className="mb-5 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                  {t('supportedChannels')}
                </h2>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {t('availableDesc')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {displayedChannelTypes.map((type) => {
                const meta = CHANNEL_META[type];
                const isConfigured = configuredChannelTypeSet.has(type);
                if (isConfigured) return null;

                return (
                  <button
                    key={type}
                    onClick={() => {
                      setSelectedChannelType(type);
                      setShowAddDialog(true);
                    }}
                    className={cn(
                      'group relative flex items-start gap-4 overflow-hidden rounded-[16px] border border-border/60 bg-card/84 p-4 text-left transition-colors hover:border-black/10 hover:bg-accent/45 dark:hover:border-white/10'
                    )}
                  >
                    <div className="mt-0.5 shrink-0">
                      <ChannelLogo type={type} branded />
                    </div>
                    <div className="mt-0.5 flex min-w-0 flex-1 flex-col">
                      <div className="mb-2 flex items-center gap-2">
                        <h3 className="truncate text-[17px] font-semibold tracking-[-0.02em] text-foreground">{meta.name}</h3>
                        {meta.isPlugin && (
                          <Badge variant="secondary" className="rounded-[10px] border border-black/6 bg-black/[0.03] px-2 py-0.5 text-[10px] font-medium text-foreground/70 shadow-none dark:border-white/10 dark:bg-white/[0.04]">
                            {t('pluginBadge')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[14px] text-muted-foreground line-clamp-2 leading-[1.55]">
                        {t(meta.description.replace('channels:', ''))}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
          </>
          )}
        </div>
      </div>

      {showAddDialog && (
        <ChannelConfigModal
          initialSelectedType={selectedChannelType}
          configuredTypes={configuredTypes}
          onClose={() => {
            setShowAddDialog(false);
            setSelectedChannelType(null);
          }}
          onChannelSaved={async () => {
            await Promise.all([fetchChannels(), fetchConfiguredTypes()]);
            setShowAddDialog(false);
            setSelectedChannelType(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!channelToDelete}
        title={t('common.confirm', 'Confirm')}
        message={t('deleteConfirm')}
        confirmLabel={t('common.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (channelToDelete) {
            await deleteChannel(channelToDelete.id);
            await fetchConfiguredTypes();
            setChannelToDelete(null);
          }
        }}
        onCancel={() => setChannelToDelete(null)}
      />
    </div>
  );
}

function ChannelLogo({ type, branded = false }: { type: ChannelType; branded?: boolean }) {
  const brand = CHANNEL_BRAND_STYLES[type];
  const shellClass = branded
    ? brand?.shell ?? 'bg-slate-900 border-slate-800 shadow-[0_10px_24px_rgba(15,23,42,0.16)]'
    : 'border-border/70 bg-card shadow-sm';
  const iconClass = branded ? brand?.icon ?? 'brightness-0 invert' : '';

  const wrap = (content: React.ReactNode) => (
    <div
      className={cn(
        'flex h-[50px] w-[50px] items-center justify-center rounded-[16px] border',
        shellClass
      )}
    >
      {content}
    </div>
  );

  switch (type) {
    case 'telegram':
      return wrap(<img src={telegramIcon} alt="Telegram" className={cn('h-[22px] w-[22px]', iconClass)} />);
    case 'discord':
      return wrap(<img src={discordIcon} alt="Discord" className={cn('h-[22px] w-[22px]', iconClass)} />);
    case 'whatsapp':
      return wrap(<img src={whatsappIcon} alt="WhatsApp" className={cn('h-[22px] w-[22px]', iconClass)} />);
    case 'dingtalk':
      return wrap(<img src={dingtalkIcon} alt="DingTalk" className={cn('h-[22px] w-[22px]', iconClass)} />);
    case 'feishu':
      return wrap(<img src={feishuIcon} alt="Feishu" className={cn('h-[22px] w-[22px]', iconClass)} />);
    case 'wecom':
      return wrap(<img src={wecomIcon} alt="WeCom" className={cn('h-[22px] w-[22px]', iconClass)} />);
    case 'qqbot':
      return wrap(<img src={qqIcon} alt="QQ" className={cn('h-[22px] w-[22px]', iconClass)} />);
    default:
      return wrap(
        <span className={cn('text-[22px]', branded ? 'brightness-0 invert' : '')}>
          {CHANNEL_ICONS[type] || '💬'}
        </span>
      );
  }
}

interface ChannelCardProps {
  channel: DisplayChannel;
  onClick: () => void;
  onDelete: () => void;
}

function ChannelCard({ channel, onClick, onDelete }: ChannelCardProps) {
  const { t } = useTranslation('channels');
  const meta = CHANNEL_META[channel.type];
  const runtimeStatus = channel.runtimeStatus ?? channel.status;
  const runtimeLabel =
    runtimeStatus === 'connected'
      ? t('runtime.connected')
      : runtimeStatus === 'connecting'
        ? t('runtime.connecting')
        : runtimeStatus === 'error'
          ? t('runtime.error')
          : runtimeStatus === 'disconnected'
            ? t('runtime.stopped')
            : t('runtime.unknown');

  return (
    <div 
      onClick={onClick}
      className="group relative flex cursor-pointer items-start gap-4 overflow-hidden rounded-[16px] border border-border/60 bg-card/84 p-4 text-left transition-colors hover:border-black/10 hover:bg-accent/45 dark:hover:border-white/10"
    >
      <div className="mt-0.5 shrink-0">
        <ChannelLogo type={channel.type} branded />
      </div>
      <div className="mt-0.5 flex min-w-0 flex-1 flex-col">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="truncate text-[17px] font-semibold tracking-[-0.02em] text-foreground">{channel.name}</h3>
              <span
                className={cn(
                  'h-2.5 w-2.5 rounded-full shrink-0',
                  runtimeStatus === 'connected'
                    ? 'bg-emerald-500'
                    : runtimeStatus === 'connecting'
                      ? 'bg-amber-500 animate-pulse'
                      : runtimeStatus === 'error'
                        ? 'bg-destructive'
                        : 'bg-muted-foreground'
                )}
                title={runtimeLabel}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge
                variant="secondary"
                className="rounded-[10px] border border-black/6 bg-black/[0.03] px-2 py-0.5 text-[10px] font-semibold text-foreground/70 shadow-none dark:border-white/10 dark:bg-white/[0.04]"
              >
                {t('configuredBadge')}
              </Badge>
              {meta?.isPlugin && (
                <Badge
                  variant="secondary"
                  className="rounded-[10px] border border-black/6 bg-black/[0.03] px-2 py-0.5 text-[10px] font-semibold text-foreground/70 shadow-none dark:border-white/10 dark:bg-white/[0.04]"
                >
                  {t('pluginBadge', 'Plugin')}
                </Badge>
              )}
            </div>
          </div>

          <Button
            variant="dangerGhost"
            size="icon"
            className="h-8 w-8 rounded-[10px] shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {channel.error ? (
          <p className="text-[14px] leading-[1.55] text-destructive line-clamp-2">
            {channel.error}
          </p>
        ) : (
          <div className="space-y-1.5">
            <p
              className={cn(
                'text-[12px] font-medium',
                channel.runtimeLoaded
                  ? runtimeStatus === 'connected'
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : runtimeStatus === 'connecting'
                      ? 'text-amber-700 dark:text-amber-300'
                      : runtimeStatus === 'error'
                        ? 'text-destructive'
                        : 'text-foreground/62 dark:text-foreground/70'
                  : 'text-foreground/62 dark:text-foreground/70'
              )}
            >
              {channel.runtimeLoaded ? runtimeLabel : t('runtime.notLoaded')}
            </p>
            <p className="text-[14px] text-muted-foreground line-clamp-2 leading-[1.55]">
              {meta ? t(meta.description.replace('channels:', '')) : CHANNEL_NAMES[channel.type]}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Channels;
