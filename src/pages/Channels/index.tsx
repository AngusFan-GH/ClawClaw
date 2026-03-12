/**
 * Channels Page
 * Manage messaging channel connections with configuration UI
 */
import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trash2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
  const configuredDisplayChannels: Channel[] = [];

  for (const channel of safeChannels) {
    configuredChannelTypeSet.add(channel.type);
    configuredDisplayChannels.push(channel);
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

  return (
    <div className="flex flex-col -m-6 bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 pb-8 pt-10 md:px-8">
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={(
            <div className="flex items-center gap-3">
              {statusText && (
                <div className="inline-flex h-9 items-center gap-2 rounded-xl border border-border/70 bg-card/85 px-3 text-[13px] font-medium text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{statusText}</span>
                </div>
              )}
              <Button
                variant="outline"
                onClick={handleRefresh}
                disabled={gatewayStatus.state !== 'running'}
                className="h-9 rounded-xl border-black/10 bg-transparent px-4 text-[13px] font-medium text-foreground/80 shadow-none transition-colors hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
              >
                <RefreshCw className={cn("h-3.5 w-3.5 mr-2", loading && "animate-spin")} />
                {t('refresh')}
              </Button>
            </div>
          )}
        />

        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
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
            <section className="mb-8 rounded-2xl border border-border/70 bg-card/75 p-4 md:p-5">
              <h2 className="mb-4 text-2xl font-semibold tracking-tight text-foreground">
                {t('configured')}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
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

          <section className="mb-8 rounded-2xl border border-border/70 bg-card/75 p-4 md:p-5">
            <h2 className="mb-4 text-2xl font-semibold tracking-tight text-foreground">
              {t('supportedChannels')}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
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
                      'group relative flex items-start gap-4 overflow-hidden rounded-2xl border border-border/60 bg-card/80 p-4 text-left transition-colors hover:bg-accent/50'
                    )}
                  >
                    <div className="mb-3 h-[46px] w-[46px] shrink-0 flex items-center justify-center rounded-full border border-border/70 bg-card shadow-sm">
                      <ChannelLogo type={type} />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0 py-0.5 mt-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-[16px] font-semibold text-foreground truncate">{meta.name}</h3>
                        {meta.isPlugin && (
                          <Badge variant="secondary" className="rounded-xl border-0 bg-muted px-2 py-0.5 font-mono text-[10px] font-medium text-foreground/70 shadow-none">
                            {t('pluginBadge')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
                        {t(meta.description.replace('channels:', ''))}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
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
            const [channelType] = channelToDelete.id.split('-');
            setConfiguredTypes((prev) => prev.filter((type) => type !== channelType));
            setChannelToDelete(null);
          }
        }}
        onCancel={() => setChannelToDelete(null)}
      />
    </div>
  );
}

function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'telegram':
      return <img src={telegramIcon} alt="Telegram" className="w-[22px] h-[22px]" />;
    case 'discord':
      return <img src={discordIcon} alt="Discord" className="w-[22px] h-[22px]" />;
    case 'whatsapp':
      return <img src={whatsappIcon} alt="WhatsApp" className="w-[22px] h-[22px]" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="w-[22px] h-[22px]" />;
    case 'feishu':
      return <img src={feishuIcon} alt="Feishu" className="w-[22px] h-[22px]" />;
    case 'wecom':
      return <img src={wecomIcon} alt="WeCom" className="w-[22px] h-[22px]" />;
    case 'qqbot':
      return <img src={qqIcon} alt="QQ" className="w-[22px] h-[22px]" />;
    default:
      return <span className="text-[22px]">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
}

interface ChannelCardProps {
  channel: Channel;
  onClick: () => void;
  onDelete: () => void;
}

function ChannelCard({ channel, onClick, onDelete }: ChannelCardProps) {
  const { t } = useTranslation('channels');
  const meta = CHANNEL_META[channel.type];

  return (
    <div 
      onClick={onClick}
      className="group relative flex cursor-pointer items-start gap-4 overflow-hidden rounded-2xl border border-border/60 bg-card/80 p-4 text-left transition-colors hover:bg-accent/50"
    >
      <div
        className={cn(
          'mb-3 h-[46px] w-[46px] shrink-0 flex items-center justify-center rounded-full border shadow-sm',
          channel.status === 'connected'
            ? 'bg-emerald-500/12 border-emerald-500/30'
            : 'bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/10'
        )}
      >
        <ChannelLogo type={channel.type} />
      </div>
      <div className="flex flex-col flex-1 min-w-0 py-0.5 mt-1">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-[16px] font-semibold text-foreground truncate">{channel.name}</h3>
            {meta?.isPlugin && (
              <Badge
                variant="secondary"
                className="rounded-xl border-0 bg-muted px-2 py-0.5 font-mono text-[10px] font-medium text-foreground/70 shadow-none"
              >
                {t('pluginBadge', 'Plugin')}
              </Badge>
            )}
            <div
              className={cn(
                'w-2 h-2 rounded-full shrink-0',
                channel.status === 'connected'
                  ? 'bg-green-500'
                  : channel.status === 'connecting'
                    ? 'bg-yellow-500 animate-pulse'
                    : channel.status === 'error'
                      ? 'bg-destructive'
                      : 'bg-muted-foreground'
              )}
              title={channel.status}
            />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="opacity-0 group-hover:opacity-100 h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all shrink-0 -mr-2"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {channel.error ? (
          <p className="text-[13.5px] text-destructive line-clamp-2 leading-[1.5]">
            {channel.error}
          </p>
        ) : (
          <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
            {meta ? t(meta.description.replace('channels:', '')) : CHANNEL_NAMES[channel.type]}
          </p>
        )}
      </div>
    </div>
  );
}

export default Channels;
