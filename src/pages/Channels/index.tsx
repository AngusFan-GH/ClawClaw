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
import { toast } from 'sonner';

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

type DisplayChannelGroup = {
  type: ChannelType;
  name: string;
  runtimeStatus: Channel['status'] | 'unknown' | 'configured';
  runtimeLoaded: boolean;
  configured: boolean;
  accounts: DisplayChannel[];
  error?: string;
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
  const [selectedChannelAccountId, setSelectedChannelAccountId] = useState<string | null>(null);
  const [configuredTypes, setConfiguredTypes] = useState<string[]>([]);
  const [configuredAccountsByType, setConfiguredAccountsByType] = useState<Record<string, string[]>>({});
  const [configuredTypesReady, setConfiguredTypesReady] = useState(false);
  const [channelToDelete, setChannelToDelete] = useState<{ id: string; accountId?: string } | null>(null);

  const fetchConfiguredTypesWithTimeout = useCallback(async () => {
    return await Promise.race([
      hostApiFetch<{
        success: boolean;
        channels?: string[];
        accountsByType?: Record<string, string[]>;
      }>('/api/channels/configured'),
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), 3500);
      }),
    ]);
  }, []);

  const fetchConfiguredTypes = useCallback(async () => {
    try {
      const result = await fetchConfiguredTypesWithTimeout();
      if (result && result.success && result.channels) {
        setConfiguredTypes(result.channels);
        setConfiguredAccountsByType(result.accountsByType || {});
      }
    } catch {
      // Ignore refresh errors here and keep the last known state.
    } finally {
      setConfiguredTypesReady(true);
    }
  }, [fetchConfiguredTypesWithTimeout]);

  useEffect(() => {
    void fetchConfiguredTypes();
    void fetchChannels(false);
  }, [fetchChannels, fetchConfiguredTypes]);

  useEffect(() => {
    if (gatewayStatus.state === 'running') {
      void fetchChannels(false);
      void fetchConfiguredTypes();
    }
  }, [fetchChannels, fetchConfiguredTypes, gatewayStatus.state]);

  useEffect(() => {
    const unsubscribe = subscribeHostEvent('gateway:channel-status', () => {
      void fetchChannels(false);
      void fetchConfiguredTypes();
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [fetchChannels, fetchConfiguredTypes]);

  useEffect(() => {
    const unsubscribe = subscribeHostEvent('gateway:status', () => {
      void fetchChannels(false);
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
    const fallbackAccounts = configuredAccountsByType[typedType] || ['default'];

    for (const accountId of fallbackAccounts) {
      const fallbackId = `${typedType}:${accountId}`;
      if (configuredDisplayChannels.some((channel) => channel.id === fallbackId)) {
        configuredChannelTypeSet.add(typedType);
        continue;
      }
      configuredChannelTypeSet.add(typedType);
      configuredDisplayChannels.push({
        id: fallbackId,
        type: typedType,
        name: CHANNEL_NAMES[typedType],
        status: 'disconnected',
        configured: true,
        runtimeLoaded: false,
        runtimeStatus: gatewayStatus.state === 'running' ? 'unknown' : 'disconnected',
        accountId,
        metadata: {
          isDefaultAccount: accountId === 'default',
        },
      });
    }
  }

  configuredDisplayChannels.sort((a, b) => {
    return allChannelTypes.indexOf(a.type) - allChannelTypes.indexOf(b.type);
  });

  const configuredDisplayGroups: DisplayChannelGroup[] = Array.from(
    configuredDisplayChannels.reduce((map, channel) => {
      const existing = map.get(channel.type);
      if (existing) {
        existing.accounts.push(channel);
        return map;
      }
      map.set(channel.type, {
        type: channel.type,
        name: CHANNEL_NAMES[channel.type],
        runtimeStatus: channel.runtimeStatus,
        runtimeLoaded: channel.runtimeLoaded,
        configured: channel.configured,
        accounts: [channel],
        error: channel.error,
      });
      return map;
    }, new Map<ChannelType, DisplayChannelGroup>())
  ).map(([, group]) => {
    group.accounts.sort((left, right) => {
      const leftDefault = Boolean(left.metadata && (left.metadata as { isDefaultAccount?: boolean }).isDefaultAccount);
      const rightDefault = Boolean(right.metadata && (right.metadata as { isDefaultAccount?: boolean }).isDefaultAccount);
      if (leftDefault !== rightDefault) {
        return leftDefault ? -1 : 1;
      }
      return (left.accountId || '').localeCompare(right.accountId || '');
    });

    const anyConnected = group.accounts.some((account) => account.runtimeStatus === 'connected');
    const anyConnecting = group.accounts.some((account) => account.runtimeStatus === 'connecting');
    const anyError = group.accounts.some((account) => account.runtimeStatus === 'error' || Boolean(account.error));
    const anyConfigured = group.accounts.some((account) => account.configured);
    const runtimeLoaded = group.accounts.some((account) => account.runtimeLoaded);

    const nextRuntimeStatus: DisplayChannelGroup['runtimeStatus'] = anyConnected
      ? 'connected'
      : anyConnecting
        ? 'connecting'
        : anyError
          ? 'error'
          : anyConfigured
            ? 'configured'
            : runtimeLoaded
              ? 'unknown'
              : 'disconnected';

    return {
      ...group,
      runtimeLoaded,
      configured: anyConfigured,
      error: group.accounts.find((account) => account.error)?.error,
      runtimeStatus: nextRuntimeStatus,
    };
  }).sort((a, b) => allChannelTypes.indexOf(a.type) - allChannelTypes.indexOf(b.type));

  const handleRefresh = () => {
    void Promise.all([fetchChannels(true), fetchConfiguredTypes()]);
  };

  const isLoadingConfiguredTypes = !configuredTypesReady;
  const showRefreshingHint = loading && configuredTypesReady;
  const statusText = isLoadingConfiguredTypes
    ? t('loadingConfiguredStatus', '正在加载连接配置...')
    : showRefreshingHint
      ? t('refreshingStatus', '正在刷新连接状态...')
      : null;

  const showPageLoader =
    (loading || isLoadingConfiguredTypes) && configuredDisplayGroups.length === 0;

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

          {configuredDisplayGroups.length > 0 && (
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
                {configuredDisplayGroups.map((group) => (
                  <ChannelGroupCard
                    key={group.type}
                    group={group}
                    onEditAccount={(channel) => {
                      setSelectedChannelType(channel.type);
                      setSelectedChannelAccountId(channel.accountId ?? null);
                      setShowAddDialog(true);
                    }}
                    onDeleteAccount={(channel) =>
                      setChannelToDelete({ id: channel.id, accountId: channel.accountId })
                    }
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
                      setSelectedChannelAccountId(null);
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
          initialAccountId={selectedChannelAccountId}
          configuredTypes={configuredTypes}
          onClose={() => {
            setShowAddDialog(false);
            setSelectedChannelType(null);
            setSelectedChannelAccountId(null);
          }}
          onChannelSaved={async () => {
            await Promise.all([fetchChannels(), fetchConfiguredTypes()]);
            setShowAddDialog(false);
            setSelectedChannelType(null);
            setSelectedChannelAccountId(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!channelToDelete}
        title={t('confirmTitle', '确认删除')}
        message={
          channelToDelete?.accountId
            ? t('deleteConfirmAccount', {
                accountId: channelToDelete.accountId,
                defaultValue: `确定要删除账户 ${channelToDelete.accountId} 吗？`,
              })
            : t('deleteConfirm')
        }
        confirmLabel={t('deleteAction', '删除')}
        cancelLabel={t('cancelAction', '取消')}
        variant="destructive"
        onConfirm={() => {
          if (!channelToDelete) return;
          const pendingDelete = channelToDelete;
          setChannelToDelete(null);
          void (async () => {
            try {
              await deleteChannel(pendingDelete.id, pendingDelete.accountId);
              await fetchConfiguredTypes();
              await fetchChannels(false);
            } catch (error) {
              toast.error(
                t('toast.deleteFailed', {
                  error: error instanceof Error ? error.message : String(error),
                  defaultValue: `删除失败: ${String(error)}`,
                })
              );
            }
          })();
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

interface ChannelGroupCardProps {
  group: DisplayChannelGroup;
  onEditAccount: (channel: DisplayChannel) => void;
  onDeleteAccount: (channel: DisplayChannel) => void;
}

function ChannelGroupCard({ group, onEditAccount, onDeleteAccount }: ChannelGroupCardProps) {
  const { t } = useTranslation('channels');
  const meta = CHANNEL_META[group.type];
  const runtimeStatus = group.runtimeStatus;
  const runtimeLabel =
    runtimeStatus === 'connected'
      ? t('runtime.connected')
      : runtimeStatus === 'connecting'
        ? t('runtime.connecting')
        : runtimeStatus === 'error'
          ? t('runtime.error')
          : runtimeStatus === 'configured'
            ? t('runtime.configuredOnly', '已配置')
            :
        runtimeStatus === 'disconnected'
            ? t('runtime.stopped')
            : t('runtime.unknown');

  return (
    <div className="group relative overflow-hidden rounded-[16px] border border-border/60 bg-card/84 p-4 text-left transition-colors hover:border-black/10 hover:bg-accent/45 dark:hover:border-white/10">
      <div className="flex items-start gap-4">
        <div className="mt-0.5 shrink-0">
          <ChannelLogo type={group.type} branded />
        </div>
        <div className="mt-0.5 flex min-w-0 flex-1 flex-col">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="truncate text-[17px] font-semibold tracking-[-0.02em] text-foreground">{group.name}</h3>
                <span
                  className={cn(
                    'h-2.5 w-2.5 rounded-full shrink-0',
                    runtimeStatus === 'connected'
                      ? 'bg-emerald-500'
                      : runtimeStatus === 'connecting'
                        ? 'bg-amber-500 animate-pulse'
                        : runtimeStatus === 'error'
                          ? 'bg-destructive'
                          : runtimeStatus === 'configured'
                            ? 'bg-sky-500'
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
                {group.accounts.length > 1 && (
                  <Badge
                    variant="secondary"
                    className="rounded-[10px] border border-black/6 bg-black/[0.03] px-2 py-0.5 text-[10px] font-semibold text-foreground/70 shadow-none dark:border-white/10 dark:bg-white/[0.04]"
                  >
                    {t('accountCount', { count: group.accounts.length, defaultValue: `${group.accounts.length} 个账户` })}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <p
              className={cn(
                'text-[12px] font-medium',
                runtimeStatus === 'connected'
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : runtimeStatus === 'connecting'
                    ? 'text-amber-700 dark:text-amber-300'
                    : runtimeStatus === 'error'
                      ? 'text-destructive'
                      : runtimeStatus === 'configured'
                        ? 'text-sky-700 dark:text-sky-300'
                        : 'text-foreground/62 dark:text-foreground/70'
              )}
            >
              {runtimeLabel}
            </p>
            {group.error ? (
              <p className="text-[14px] leading-[1.55] text-destructive">
                {group.error}
              </p>
            ) : (
              <p className="text-[14px] text-muted-foreground line-clamp-2 leading-[1.55]">
                {meta ? t(meta.description.replace('channels:', '')) : CHANNEL_NAMES[group.type]}
              </p>
            )}
          </div>

          <div className="mt-4 space-y-2">
            {group.accounts.map((channel) => (
              <button
                key={channel.id}
                onClick={() => onEditAccount(channel)}
                className="flex w-full items-center justify-between rounded-[14px] border border-border/60 bg-background/70 px-3 py-2 text-left transition-colors hover:border-black/10 hover:bg-black/[0.02] dark:hover:border-white/10 dark:hover:bg-white/[0.03]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-foreground">
                      {channel.accountId || 'default'}
                    </span>
                    {channel.metadata?.isDefaultAccount === true && (
                      <Badge
                        variant="secondary"
                        className="rounded-[10px] border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 shadow-none dark:text-emerald-300"
                      >
                        {t('defaultAccount', '默认账户')}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-[12px] text-foreground/60 dark:text-foreground/65">
                    {channel.runtimeStatus === 'connected'
                      ? t('runtime.connected')
                      : channel.runtimeStatus === 'connecting'
                        ? t('runtime.connecting')
                        : channel.runtimeStatus === 'error'
                          ? t('runtime.error')
                          : channel.configured
                            ? t('runtime.configuredOnly', '已配置')
                            : t('runtime.stopped')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {channel.error && (
                    <span className="max-w-[240px] truncate text-[12px] text-destructive">
                      {channel.error}
                    </span>
                  )}
                  <Button
                    variant="dangerGhost"
                    size="icon"
                    className="h-8 w-8 rounded-[10px] shrink-0"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteAccount(channel);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Channels;
