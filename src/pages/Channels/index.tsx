import { useMemo, useState } from 'react';
import { AlertCircle, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingIcon } from '@/components/common/LoadingSpinner';
import { useChannelsStore } from '@/stores/channels';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import { ChannelConfigModal } from '@/components/channels/ChannelConfigModal';
import { ChannelLogo as SharedChannelLogo } from '@/components/channels/ChannelLogo';
import { PageHeader } from '@/components/layout/PageHeader';
import { cn } from '@/lib/utils';
import { useGatewayPageRefresh } from '@/lib/use-gateway-page-refresh';
import { resolveChannelRuntimeStatusMeta } from '@/lib/channel-runtime-status';
import {
  CHANNEL_META,
  channelSupportsMultipleAccounts,
  getPrimaryChannels,
  type ChannelAccount,
  type ChannelGroup,
  type ChannelType,
} from '@/types/channel';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

function resolveLocalizedChannelName(
  type: ChannelType,
  fallbackName: string,
  t: ReturnType<typeof useTranslation<'channels'>>['t'],
): string {
  switch (type) {
    case 'wechat':
    case 'dingtalk':
    case 'feishu':
    case 'wecom':
    case 'qqbot':
      return t(`displayName.${type}`, fallbackName);
    default:
      return fallbackName;
  }
}

export function Channels() {
  const { t } = useTranslation('channels');
  const { channelGroups, loading, error, fetchChannels, deleteChannel } = useChannelsStore();
  const agents = useAgentsStore((state) => state.agents);
  const defaultAgentId = useAgentsStore((state) => state.defaultAgentId);
  const fetchAgents = useAgentsStore((state) => state.fetchAgents);
  const channelAccountOwners = useAgentsStore((state) => state.channelAccountOwners);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const gatewayLifecycle = useGatewayStore((state) => state.lifecycle);
  const navigate = useNavigate();

  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [selectedChannelType, setSelectedChannelType] = useState<ChannelType | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [createNewAccount, setCreateNewAccount] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    type: ChannelType;
    accountId: string;
    isDefaultAccount: boolean;
    groupName: string;
  } | null>(null);

  useGatewayPageRefresh({
    fetchAgents,
    fetchChannels,
    gatewayState: gatewayStatus.state,
    gatewayLifecycleState: gatewayLifecycle.state,
  });

  const configuredGroups = useMemo(
    () => [...channelGroups].sort((left, right) => getPrimaryChannels().indexOf(left.type) - getPrimaryChannels().indexOf(right.type)),
    [channelGroups],
  );

  const configuredTypes = useMemo(
    () => configuredGroups.map((group) => group.type),
    [configuredGroups],
  );
  const agentNamesById = useMemo(
    () =>
      Object.fromEntries(
        agents.map((agent) => [
          agent.gateway.id,
          agent.gateway.name?.trim() || agent.gateway.identity?.name?.trim() || agent.gateway.id,
        ]),
      ) as Record<string, string>,
    [agents],
  );
  const defaultAgentName = defaultAgentId ? agentNamesById[defaultAgentId] : undefined;

  const supportedUnconfiguredTypes = getPrimaryChannels().filter((type) => !configuredTypes.includes(type));
  const openConfig = (type: ChannelType, accountId?: string | null, options?: { createNewAccount?: boolean }) => {
    setSelectedChannelType(type);
    setSelectedAccountId(accountId ?? null);
    setCreateNewAccount(!!options?.createNewAccount);
    setShowConfigDialog(true);
  };

  return (
    <div className="flex flex-col -m-6 bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 pb-8 pt-10 md:px-8">
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={(
            <div className="flex items-center gap-2.5">
              {loading && (
                <div className="inline-flex h-8 items-center gap-2 rounded-[12px] border border-border/70 bg-card/85 px-3 text-[12px] font-medium text-muted-foreground">
                  <LoadingIcon className="h-3.5 w-3.5" />
                  <span>{t('refreshingStatus', '正在同步连接状态...')}</span>
                </div>
              )}
              <Button
                variant="outline"
                onClick={() => void fetchChannels(true)}
                disabled={loading}
                className="h-8 rounded-[12px] border-black/10 bg-transparent px-3.5 text-[12px] font-medium text-foreground/80 shadow-none transition-colors hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                {t('refresh')}
              </Button>
            </div>
          )}
        />

        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          <>
            {gatewayStatus.state !== 'running' && gatewayLifecycle.state === 'idle' && (
              <div className="mb-8 flex items-center gap-3 rounded-xl border border-yellow-500/50 bg-yellow-500/10 p-4">
                <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                  {t('gatewayWarning')}
                </span>
              </div>
            )}

            {error && (
              <div className="mb-8 flex items-center gap-3 rounded-xl border border-destructive/50 bg-destructive/10 p-4">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <span className="text-sm font-medium text-destructive">{error}</span>
              </div>
            )}

            <section className="mb-8 rounded-[18px] border border-border/70 bg-card/78 p-4">
              <div className="mb-4">
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">{t('configured')}</h2>
                <p className="mt-1 text-[13px] text-muted-foreground">{t('configuredDesc')}</p>
              </div>
              {loading && configuredGroups.length === 0 ? (
                <div className="grid grid-cols-1 gap-4">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <ChannelTypeCardSkeleton key={`configured-channel-skeleton-${index}`} />
                  ))}
                </div>
              ) : configuredGroups.length > 0 ? (
                <div className="grid grid-cols-1 gap-4">
                  {configuredGroups.map((group) => (
                    <ChannelTypeCard
                      key={group.type}
                      group={group}
                      displayName={resolveLocalizedChannelName(group.type, group.name, t)}
                      accountOwnerships={Object.fromEntries(
                        group.accounts.map((account) => {
                          const ownerId = channelAccountOwners[`${group.type}:${account.accountId}`];
                          return [
                            account.accountId,
                            ownerId
                              ? {
                                  label: agentNamesById[ownerId] || ownerId,
                                  mode: 'explicit' as const,
                                }
                              : defaultAgentName
                                ? {
                                    label: defaultAgentName,
                                    mode: 'fallback' as const,
                                  }
                                : undefined,
                          ];
                        }),
                      )}
                      onEditAccount={(account) => openConfig(group.type, account.accountId)}
                      onAddAccount={() => openConfig(group.type, null, { createNewAccount: true })}
                      onManageBinding={() => navigate('/agents')}
                      onDeleteAccount={(account) =>
                        setPendingDelete({
                          type: group.type,
                          accountId: account.accountId,
                          isDefaultAccount: account.isDefaultAccount,
                          groupName: group.name,
                        })
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border/70 bg-muted/30 px-3 py-4 text-[13px] text-muted-foreground">
                  {t('noConfiguredChannels', '还没有已配置连接。')}
                </div>
              )}
            </section>

            <section className="mb-8 rounded-[18px] border border-border/70 bg-card/78 p-4">
              <div className="mb-4">
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">{t('supportedChannels')}</h2>
                <p className="mt-1 text-[13px] text-muted-foreground">{t('availableDesc')}</p>
              </div>

              {loading && configuredGroups.length === 0 ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <SupportedChannelCardSkeleton key={`supported-channel-skeleton-${index}`} />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {supportedUnconfiguredTypes.map((type) => {
                    const meta = CHANNEL_META[type];
                    return (
                      <div
                        key={type}
                        role="button"
                        tabIndex={0}
                        onClick={() => openConfig(type)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openConfig(type);
                          }
                        }}
                        className="group relative flex cursor-pointer items-start gap-4 overflow-hidden rounded-[16px] border border-border/60 bg-card/84 p-4 text-left transition-colors hover:border-black/10 hover:bg-accent/45 focus:outline-none focus:ring-2 focus:ring-primary/35 dark:hover:border-white/10"
                      >
                        <div className="mt-0.5 shrink-0">
                          <PageChannelLogo type={type} branded />
                        </div>
                        <div className="mt-0.5 flex min-w-0 flex-1 flex-col">
                          <div className="mb-2 flex items-center gap-2">
                            <h3 className="truncate text-[17px] font-semibold tracking-[-0.02em] text-foreground">{meta.name}</h3>
                            {meta.isPlugin && (
                              <Badge
                                variant="secondary"
                                className="rounded-[10px] border border-black/6 bg-black/[0.03] px-2 py-0.5 text-[10px] font-medium text-foreground/70 shadow-none dark:border-white/10 dark:bg-white/[0.04]"
                              >
                                {t('pluginBadge')}
                              </Badge>
                            )}
                          </div>
                          <p className="line-clamp-2 text-[14px] leading-[1.55] text-muted-foreground">
                            {t(meta.description.replace('channels:', ''))}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        </div>
      </div>

      {showConfigDialog && (
        <ChannelConfigModal
          initialSelectedType={selectedChannelType}
          initialAccountId={selectedAccountId}
          initialCreateNewAccount={createNewAccount}
          configuredTypes={configuredTypes}
          onClose={() => {
            setShowConfigDialog(false);
            setSelectedChannelType(null);
            setSelectedAccountId(null);
            setCreateNewAccount(false);
          }}
          onChannelSaved={async () => {
            await fetchChannels(false, { includeRuntime: false });
            setShowConfigDialog(false);
            setSelectedChannelType(null);
            setSelectedAccountId(null);
            setCreateNewAccount(false);
          }}
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title={t('confirmTitle', '确认删除')}
        message={
          pendingDelete
            ? pendingDelete.isDefaultAccount
              ? t('deleteConfirmDefaultAccount', {
                  name: pendingDelete.groupName,
                  defaultValue: `确定要删除 ${pendingDelete.groupName} 的默认账户配置吗？`,
                })
              : t('deleteConfirmAccount', {
                  accountId: pendingDelete.accountId,
                  defaultValue: `确定要删除账户 ${pendingDelete.accountId} 吗？`,
                })
            : ''
        }
        confirmLabel={t('deleteAction', '删除')}
        cancelLabel={t('cancelAction', '取消')}
        variant="destructive"
        onConfirm={() => {
          if (!pendingDelete) return;
          const deleting = pendingDelete;
          setPendingDelete(null);
          void (async () => {
            try {
              await deleteChannel(`${deleting.type}:${deleting.accountId}`, deleting.accountId);
              await fetchChannels(false, { includeRuntime: false });
            } catch (error) {
              toast.error(
                t('toast.deleteFailed', {
                  error: error instanceof Error ? error.message : String(error),
                  defaultValue: `删除失败: ${String(error)}`,
                }),
              );
            }
          })();
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function ChannelTypeCard({
  group,
  displayName,
  accountOwnerships,
  onEditAccount,
  onAddAccount,
  onManageBinding,
  onDeleteAccount,
}: {
  group: ChannelGroup;
  displayName: string;
  accountOwnerships: Record<string, { label: string; mode: 'explicit' | 'fallback' } | undefined>;
  onEditAccount: (account: ChannelAccount) => void;
  onAddAccount: () => void;
  onManageBinding: () => void;
  onDeleteAccount: (account: ChannelAccount) => void;
}) {
  const { t } = useTranslation('channels');
  const meta = CHANNEL_META[group.type];
  return (
    <div className="rounded-[16px] border border-border/60 bg-card/84 p-4 transition-colors hover:border-black/10 dark:hover:border-white/10">
      <div className="flex items-start gap-3.5">
        <div className="mt-0.5 shrink-0">
          <PageChannelLogo type={group.type} branded />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-[18px] font-semibold tracking-[-0.02em] text-foreground">{displayName}</h3>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
            <div className="flex items-center gap-1.5">
              {channelSupportsMultipleAccounts(group.type) && (
                <Button
                  variant="outline"
                  className="h-8 rounded-xl border-black/10 bg-transparent px-3 text-[12px] font-medium text-foreground/75 shadow-none hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
                  onClick={onAddAccount}
                >
                  {t('addAccount', '新增账户')}
                </Button>
              )}
              <Button
                variant="outline"
                className="h-8 rounded-xl border-black/10 bg-transparent px-3 text-[12px] font-medium text-foreground/75 shadow-none hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
                onClick={onManageBinding}
              >
                {channelSupportsMultipleAccounts(group.type)
                  ? t('manageBindingAccounts', '按账户绑定')
                  : t('manageBinding', '管理归属')}
              </Button>
            </div>
          </div>

          {group.accounts.length > 0 ? (
            <div className="mt-3 space-y-2">
              {group.accounts.map((account) => (
                <div
                  key={account.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onEditAccount(account)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onEditAccount(account);
                    }
                  }}
                  className="flex w-full items-center justify-between rounded-[14px] border border-border/60 bg-background/70 px-3 py-2 text-left transition-colors hover:border-black/10 hover:bg-black/[0.02] focus:outline-none focus:ring-2 focus:ring-primary/35 dark:hover:border-white/10 dark:hover:bg-white/[0.03]"
                >
                  {(() => {
                    const ownership = accountOwnerships[account.accountId];
                    const ownershipLabel =
                      ownership?.mode === 'explicit'
                        ? ownership.label
                        : ownership?.mode === 'fallback'
                          ? ownership.label
                          : t('unassignedAgent', '未绑定');
                    return (
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {(() => {
                        const accountRuntimeStatus = resolveChannelRuntimeStatusMeta(
                          account.status === 'configured'
                            ? 'configured'
                            : account.status === 'connected'
                              ? 'connected'
                              : account.status === 'connecting'
                                ? 'connecting'
                                : account.status === 'error'
                                  ? 'error'
                                  : account.configured
                                    ? 'configured'
                                    : 'disconnected',
                          t,
                        );
                        return (
                          <>
                      <span className="text-[13px] font-semibold text-foreground">{account.accountId}</span>
                      {account.isDefaultAccount && (
                        <Badge
                          variant="secondary"
                          className="rounded-[10px] border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 shadow-none dark:text-emerald-300"
                        >
                          {t('defaultAccount', '默认账户')}
                        </Badge>
                      )}
                      <span className="shrink-0 text-[12px] text-foreground/60 dark:text-foreground/65">
                        {accountRuntimeStatus.label}
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          'rounded-[10px] px-2 py-0.5 text-[10px] font-semibold shadow-none',
                          ownership?.mode === 'explicit'
                            ? 'border border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                            : ownership?.mode === 'fallback'
                              ? 'border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                              : 'border border-black/6 bg-black/[0.03] text-foreground/70 dark:border-white/10 dark:bg-white/[0.04]',
                        )}
                      >
                        {ownership?.mode === 'explicit'
                          ? t('ownershipBadge.explicit', '已绑定')
                          : ownership?.mode === 'fallback'
                            ? t('ownershipBadge.fallback', '默认接管')
                            : t('ownershipBadge.unassigned', '未绑定')}
                      </Badge>
                      <span className="text-muted-foreground/50">·</span>
                      <span
                        className={cn(
                          'min-w-0 truncate text-[12px]',
                          ownership?.mode === 'fallback' ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground/80',
                        )}
                      >
                        {t('boundAgentLabel', '归属')}：{ownershipLabel}
                      </span>
                      {account.error ? (
                        <>
                          <span className="shrink-0 text-muted-foreground/50">·</span>
                          <span className="truncate text-[12px] text-destructive">{account.error}</span>
                        </>
                      ) : null}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                    );
                  })()}
                  {account.configured ? (
                    <Button
                      variant="dangerGhost"
                      size="icon"
                      className="ml-3 h-7 w-7 rounded-[10px] shrink-0"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteAccount(account);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-border/70 bg-muted/30 px-3 py-4 text-[13px] text-muted-foreground">
              {t('emptyConfiguredAccounts', '已配置该连接类型，但尚未发现可展示的账户。')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PageChannelLogo({ type, branded = false }: { type: ChannelType; branded?: boolean }) {
  return (
    <SharedChannelLogo
      type={type}
      branded={branded}
      sizeClassName="h-[50px] w-[50px]"
      iconClassName="h-[22px] w-[22px]"
      shapeClassName="rounded-[16px]"
      shellClassName="border-border/70 bg-card shadow-sm"
      fallbackClassName={cn('text-[22px]', branded ? 'text-white/95' : 'text-foreground')}
    />
  );
}

function ChannelTypeCardSkeleton() {
  return (
    <div className="rounded-[16px] border border-border/60 bg-card/84 p-4 animate-pulse">
      <div className="flex items-start gap-3.5">
        <div className="mt-0.5 h-[50px] w-[50px] shrink-0 rounded-[16px] bg-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="h-7 w-48 rounded bg-muted" />
              <div className="mt-2 h-5 w-16 rounded-full bg-muted" />
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-8 w-24 rounded-xl bg-muted" />
              <div className="h-8 w-24 rounded-xl bg-muted" />
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <div className="h-14 rounded-[14px] bg-muted/80" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SupportedChannelCardSkeleton() {
  return (
    <div className="rounded-[16px] border border-border/60 bg-card/84 p-4 animate-pulse">
      <div className="flex items-start gap-4">
        <div className="mt-0.5 h-[50px] w-[50px] shrink-0 rounded-[16px] bg-muted" />
        <div className="mt-0.5 min-w-0 flex-1">
          <div className="h-6 w-36 rounded bg-muted" />
          <div className="mt-3 h-4 w-full rounded bg-muted" />
          <div className="mt-2 h-4 w-3/4 rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}

export default Channels;
