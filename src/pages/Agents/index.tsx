import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Bot, Check, ChevronDown, FolderOpen, PencilLine, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusBadge } from '@/components/common/StatusBadge';
import { LoadingIcon } from '@/components/common/LoadingSpinner';
import { ChannelLogo as SharedChannelLogo } from '@/components/channels/ChannelLogo';
import { PageHeader } from '@/components/layout/PageHeader';
import { useAgentsStore } from '@/stores/agents';
import { useChannelsStore } from '@/stores/channels';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { CHANNEL_NAMES, type ChannelGroup, type ChannelType } from '@/types/channel';
import type { AgentSummary } from '@/types/agent';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { invokeIpc } from '@/lib/api-client';
import { useGatewayPageRefresh } from '@/lib/use-gateway-page-refresh';
import { resolveChannelRuntimeStatusMeta, type ChannelRuntimeState } from '@/lib/channel-runtime-status';
import { isMultiInstanceProviderType, PROVIDER_TYPE_INFO, type ProviderAccount, type ProviderVendorInfo } from '@/lib/providers';
import i18n from '@/i18n';

function resolveLocalizedChannelName(type: ChannelType, fallbackName: string): string {
  switch (type) {
    case 'wechat':
    case 'dingtalk':
    case 'feishu':
    case 'wecom':
    case 'qqbot':
      return i18n.t(`channels:displayName.${type}`, { defaultValue: fallbackName });
    default:
      return fallbackName;
  }
}

export function Agents() {
  const { t } = useTranslation('agents');
  const navigate = useNavigate();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const gatewayLifecycle = useGatewayStore((state) => state.lifecycle);
  const refreshProviderSnapshot = useProviderStore((state) => state.refreshProviderSnapshot);
  const {
    agents,
    defaultAgentId,
    channelAccountOwners,
    loading,
    error,
    fetchAgents,
    createAgent,
    deleteAgent,
  } = useAgentsStore();
  const { channelGroups, fetchChannels } = useChannelsStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<AgentSummary | null>(null);

  const { refresh: handleRefresh } = useGatewayPageRefresh({
    fetchAgents,
    fetchChannels,
    gatewayState: gatewayStatus.state,
    gatewayLifecycleState: gatewayLifecycle.state,
  });
  const activeAgent = useMemo(
    () => agents.find((agent) => agent.gateway.id === activeAgentId) ?? null,
    [activeAgentId, agents],
  );
  const stats = useMemo(
    () => ({
      total: agents.length,
      defaults: agents.filter((agent) => agent.gateway.isDefault).length,
      custom: agents.filter((agent) => !agent.gateway.isDefault).length,
      connected: agents.filter((agent) => agent.local.boundChannelAccounts.length > 0).length,
    }),
    [agents],
  );

  useEffect(() => {
    void refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  return (
    <div className="flex h-[calc(100vh-2.5rem)] flex-col overflow-hidden bg-background -m-6">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 pb-8 pt-10 md:px-8">
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={(
            <div className="flex items-center gap-3">
              {loading && (
                <div className="inline-flex h-9 items-center gap-2 rounded-xl border border-border/70 bg-card/85 px-3.5 text-[12px] font-medium text-muted-foreground">
                  <LoadingIcon className="h-3.5 w-3.5" />
                  <span>{t('loadingDescription', '正在同步分身配置和绑定关系，请稍候。')}</span>
                </div>
              )}
              <Button
                variant="outline"
                onClick={handleRefresh}
                className="h-9 rounded-xl border-black/10 bg-transparent px-4 text-[13px] font-medium text-foreground/80 shadow-none transition-colors hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-2" />
                {t('refresh')}
              </Button>
              <Button
                onClick={() => setShowAddDialog(true)}
                className="h-9 rounded-xl px-4 text-[13px] font-medium shadow-none"
              >
                <Plus className="h-3.5 w-3.5 mr-2" />
                {t('addAgent')}
              </Button>
            </div>
          )}
        />

        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          {gatewayStatus.state !== 'running' && gatewayLifecycle.state === 'idle' && (
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

          <section className="mb-8 rounded-[18px] border border-border/70 bg-card/78 p-4">
            <div className="mb-4">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                {t('stats.title', '概览')}
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {t('stats.description', '快速查看分身数量、默认分身和当前已接管的连接情况。')}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {loading && agents.length === 0 ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={`agent-stat-skeleton-${index}`}
                    className="rounded-[16px] border border-border/60 bg-background/88 px-4 py-4 animate-pulse"
                  >
                    <div className="h-3 w-20 rounded bg-muted" />
                    <div className="mt-3 h-8 w-12 rounded bg-muted" />
                  </div>
                ))
              ) : (
                <>
                  <AgentStatCard label={t('stats.total')} value={stats.total} />
                  <AgentStatCard label={t('stats.defaults')} value={stats.defaults} />
                  <AgentStatCard label={t('stats.custom')} value={stats.custom} />
                  <AgentStatCard label={t('stats.connected')} value={stats.connected} />
                </>
              )}
            </div>
          </section>

          <section className="rounded-[18px] border border-border/70 bg-card/78 p-4">
            <div className="mb-4">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                {t('list.title')}
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {t('list.description')}
              </p>
            </div>

            {loading && agents.length === 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={`agent-card-skeleton-${index}`}
                    className="rounded-[18px] border border-border/60 bg-background/88 px-4 py-4 animate-pulse"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="h-11 w-11 rounded-xl bg-muted" />
                        <div className="min-w-0 flex-1">
                          <div className="h-5 w-40 rounded bg-muted" />
                          <div className="mt-2 h-3 w-24 rounded bg-muted" />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <div className="h-9 w-9 rounded-[10px] bg-muted" />
                        <div className="h-9 w-9 rounded-[10px] bg-muted" />
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="h-16 rounded-xl bg-muted/80" />
                      <div className="h-16 rounded-xl bg-muted/80" />
                      <div className="h-16 rounded-xl bg-muted/80" />
                    </div>
                  </div>
                ))}
              </div>
            ) : agents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/30 px-4 py-8 text-center">
                <p className="text-sm font-medium text-foreground">{t('empty.title')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('empty.description')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {agents.map((agent) => (
                  <AgentCard
                    key={agent.gateway.id}
                    agent={agent}
                    channelGroups={channelGroups}
                    channelAccountOwners={channelAccountOwners}
                    defaultAgentId={defaultAgentId}
                    onOpenSettings={() => setActiveAgentId(agent.gateway.id)}
                    onDelete={() => setAgentToDelete(agent)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {showAddDialog && (
        <AddAgentDialog
          onClose={() => setShowAddDialog(false)}
          onCreate={async (name) => {
            await createAgent(name);
            setShowAddDialog(false);
            toast.success(t('toast.agentCreated'));
          }}
        />
      )}

      {activeAgent && (
        <AgentSettingsModal
          agent={activeAgent}
          channelGroups={channelGroups}
          allAgents={agents}
          defaultAgentId={defaultAgentId}
          channelAccountOwners={useAgentsStore.getState().channelAccountOwners}
          onOpenChannels={() => navigate('/channels')}
          onClose={() => setActiveAgentId(null)}
        />
      )}

      <ConfirmDialog
        open={!!agentToDelete}
        title={t('deleteDialog.title')}
        message={agentToDelete ? t('deleteDialog.message', { name: resolveAgentDisplayName(agentToDelete) }) : ''}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!agentToDelete) return;
          await deleteAgent(agentToDelete.gateway.id);
          setAgentToDelete(null);
          if (activeAgentId === agentToDelete.gateway.id) {
            setActiveAgentId(null);
          }
          toast.success(t('toast.agentDeleted'));
        }}
        onCancel={() => setAgentToDelete(null)}
      />
    </div>
  );
}

function AgentStatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[16px] border border-border/60 bg-background/88 px-4 py-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
        {label}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{value}</div>
    </div>
  );
}

function splitAgentModelDisplay(modelDisplay: string): { value: string; isDefaultModel: boolean } {
  const trimmed = modelDisplay.trim();
  const normalized = trimmed.replace(/\s*\((?:默认|default)\)\s*$/i, '').trim();
  return {
    value: normalized || trimmed,
    isDefaultModel: normalized !== trimmed,
  };
}

type AgentModelOption = {
  value: string;
  label: string;
  shortLabel: string;
};

function getRuntimeProviderFallbackKey(account: ProviderAccount): string | undefined {
  if (account.vendorId === 'google' && account.authMode === 'oauth_browser') {
    return 'google-gemini-cli';
  }
  if (
    account.vendorId === 'openai'
    && (account.authMode === 'oauth_browser' || account.authMode === 'oauth_device')
  ) {
    return 'openai-codex';
  }
  if (account.vendorId === 'minimax-portal-cn') {
    return 'minimax-portal';
  }
  if (isMultiInstanceProviderType(account.vendorId)) {
    return undefined;
  }
  return account.vendorId;
}

function getProviderDisplayName(account: ProviderAccount, vendor?: ProviderVendorInfo): string {
  if (
    account.vendorId === 'local-model'
    || account.metadata?.localModel
    || account.metadata?.managedBy === 'preset-local-model'
  ) {
    return i18n.t('chat:composer.localModelProvider', '本地模型');
  }
  return account.label || vendor?.name || account.vendorId;
}

function resolveAccountModelOptions(
  account: ProviderAccount,
  vendor: ProviderVendorInfo | undefined,
  providerDisplayName: string,
): AgentModelOption[] {
  const runtimeProviderKey = getRuntimeProviderFallbackKey(account);
  const fallbackVendor = PROVIDER_TYPE_INFO.find((item) => item.id === account.vendorId);
  const candidates = [account.model || vendor?.defaultModelId || fallbackVendor?.defaultModelId, ...(account.fallbackModels ?? [])]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const seen = new Set<string>();

  return candidates.flatMap((candidate) => {
    const normalizedRef = runtimeProviderKey
      ? (candidate.startsWith(`${runtimeProviderKey}/`) ? candidate : `${runtimeProviderKey}/${candidate}`)
      : candidate;
    if (seen.has(normalizedRef)) {
      return [];
    }
    seen.add(normalizedRef);
    const modelName = normalizedRef.split('/').pop() || normalizedRef;
    return [{
      value: normalizedRef,
      label: `${providerDisplayName} · ${modelName}`,
      shortLabel: modelName,
    }];
  });
}

function dedupeModelOptions(options: AgentModelOption[]): AgentModelOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = option.value.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveAgentDisplayName(agent: AgentSummary): string {
  return agent.gateway.name?.trim() || agent.gateway.identity?.name?.trim() || agent.gateway.id;
}

function resolveAgentAvatar(agent: AgentSummary): string | null {
  return agent.gateway.identity?.emoji?.trim() || null;
}

async function openWorkspaceFolder(workspace?: string | null) {
  const normalizedWorkspace = workspace?.trim();
  if (!normalizedWorkspace || normalizedWorkspace === 'default') return;
  const result = await invokeIpc<string>('shell:openPath', normalizedWorkspace);
  if (typeof result === 'string' && result.trim()) {
    const lower = result.toLowerCase();
    if (lower.includes('no such file') || lower.includes('not found') || lower.includes('failed to open')) {
      throw new Error('Workspace directory not found');
    }
    throw new Error(result);
  }
}

function AgentCard({
  agent,
  channelGroups,
  channelAccountOwners,
  defaultAgentId,
  onOpenSettings,
  onDelete,
}: {
  agent: AgentSummary;
  channelGroups: ChannelGroup[];
  channelAccountOwners: Record<string, string>;
  defaultAgentId: string;
  onOpenSettings: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('agents');
  const displayName = resolveAgentDisplayName(agent);
  const identityName = agent.gateway.identity?.name?.trim();
  const avatarGlyph = resolveAgentAvatar(agent);
  const workspacePath = agent.local.workspace?.trim() || '';
  const channelTypes = new Set(agent.local.boundChannelAccounts.map((binding) => binding.channelType));
  if (agent.gateway.id === defaultAgentId) {
    for (const group of channelGroups) {
      for (const account of group.accounts) {
        const ownerId = channelAccountOwners[`${group.type}:${account.accountId}`];
        if (!ownerId) {
          channelTypes.add(group.type);
        }
      }
    }
  }
  const channelLabels = Array.from(channelTypes)
    .map((channelType) =>
      resolveLocalizedChannelName(
        channelType as ChannelType,
        CHANNEL_NAMES[channelType as ChannelType] || channelType,
      ),
    )
    .filter(Boolean);
  const modelMeta = splitAgentModelDisplay(agent.local.modelDisplay);
  const connectionSummary = channelLabels.length > 0
    ? channelLabels.join(' / ')
    : t('none');

  return (
    <div
      className={cn(
        'h-full rounded-[18px] border border-border/70 bg-background/88 p-5 transition-colors hover:border-black/10 hover:bg-accent/35 dark:hover:border-white/10',
        agent.gateway.isDefault && 'border-sky-200/80 bg-[linear-gradient(180deg,rgba(56,189,248,0.08),rgba(255,255,255,0.88))]'
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              'mt-0.5 flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] border text-[24px]',
              agent.gateway.isDefault
                ? 'border-sky-200 bg-sky-50 text-sky-600'
                : 'border-border/70 bg-muted/[0.45] text-foreground/78'
            )}
          >
            {avatarGlyph ? (
              <span aria-hidden="true">{avatarGlyph}</span>
            ) : (
              <Bot className="h-6 w-6" strokeWidth={2} />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  <h2 className="truncate text-[22px] font-semibold tracking-[-0.02em] text-foreground">{displayName}</h2>
                  {agent.gateway.isDefault && (
                    <Badge className="rounded-full border border-sky-200/80 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 shadow-none">
                      {t('defaultBadge')}
                    </Badge>
                  )}
                </div>

                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                  <span className="font-mono text-muted-foreground/85">{agent.gateway.id}</span>
                  {identityName && identityName !== displayName ? (
                    <span className="text-muted-foreground/80">
                      {t('meta.identity', 'Identity')}
                      <span className="mx-1 text-muted-foreground/45">·</span>
                      <span className="text-foreground/80">{identityName}</span>
                    </span>
                  ) : null}
                </div>
              </div>

              <TooltipProvider delayDuration={120}>
                <div className="flex shrink-0 items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-[12px] border border-border/70 bg-background/80 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
                        onClick={onOpenSettings}
                      >
                        <PencilLine className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('settings')}</TooltipContent>
                  </Tooltip>
                  {!agent.gateway.isDefault && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="dangerGhost"
                          size="icon"
                          className="h-9 w-9 rounded-[12px] border border-red-200/80 bg-red-50/80 shadow-none hover:bg-red-100"
                          onClick={onDelete}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('deleteAgent')}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </TooltipProvider>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,0.85fr)_minmax(0,1.35fr)]">
          <div className="rounded-[16px] border border-border/70 bg-card/88 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/75">
              {t('fieldLabels.model')}
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-[18px] font-semibold tracking-[-0.01em] text-foreground">{modelMeta.value}</span>
              {modelMeta.isDefaultModel ? (
                <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {t('defaultBadge')}
                </span>
              ) : null}
              {agent.local.inheritedModel ? (
                <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {t('inherited')}
                </span>
              ) : null}
            </div>
          </div>

          <div className="rounded-[16px] border border-border/70 bg-card/88 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/75">
              {t('fieldLabels.channels')}
            </div>
            <div className="mt-2 text-[17px] font-medium text-foreground/82" title={connectionSummary}>
              <span className="block truncate">{connectionSummary}</span>
            </div>
          </div>

          <div className="rounded-[16px] border border-border/70 bg-card/88 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/75">
              {t('meta.workspace', 'Workspace')}
            </div>
            <div className="mt-2">
              {workspacePath ? (
                <button
                  type="button"
                  onClick={() => {
                    void openWorkspaceFolder(workspacePath).catch((error) => {
                      toast.error(t('toast.openWorkspaceFailed', { error: String(error) }));
                    });
                  }}
                  className="group inline-flex min-w-0 max-w-full items-center gap-2 rounded-2xl border border-border/70 bg-background px-3 py-2 font-mono text-[12px] text-foreground/82 transition-colors hover:border-primary/25 hover:bg-primary/5 hover:text-foreground"
                  title={workspacePath}
                >
                  <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                  <span className="truncate">{workspacePath}</span>
                </button>
              ) : (
                <span className="truncate font-mono text-[12px] text-foreground/80">default</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputClasses = 'h-[44px] rounded-xl font-mono text-[13px] bg-muted/70 dark:bg-muted/40 border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const labelClasses = 'text-[14px] text-foreground/80 font-bold';

function PageChannelLogo({ type, branded = false }: { type: ChannelType; branded?: boolean }) {
  return (
    <SharedChannelLogo
      type={type}
      branded={branded}
      sizeClassName="h-[40px] w-[40px]"
      iconClassName="h-[20px] w-[20px]"
      shapeClassName="rounded-full"
      shellClassName="bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/10 shadow-sm"
      fallbackClassName="text-[20px] leading-none"
    />
  );
}

function AddAgentDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onCreate(name.trim());
    } catch (error) {
      toast.error(t('toast.agentCreateFailed', { error: String(error) }));
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md rounded-2xl bg-card overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-2xl font-semibold tracking-tight">
            {t('createDialog.title')}
          </CardTitle>
          <CardDescription className="text-[15px] mt-1 text-foreground/70">
            {t('createDialog.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-4 p-6">
          <div className="space-y-2.5">
            <Label htmlFor="agent-name" className={labelClasses}>{t('createDialog.nameLabel')}</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('createDialog.namePlaceholder')}
              className={inputClasses}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-9 rounded-xl border-black/10 bg-transparent px-4 text-[13px] font-medium text-foreground/80 shadow-none hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => void handleSubmit()}
              disabled={saving || !name.trim()}
              className="h-9 rounded-xl px-4 text-[13px] font-medium shadow-none"
            >
              {saving ? (
                <>
                  <LoadingIcon className="h-4 w-4 mr-2" />
                  {t('creating')}
                </>
              ) : (
                t('common:actions.save')
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AgentSettingsModal({
  agent,
  channelGroups,
  allAgents,
  defaultAgentId,
  channelAccountOwners,
  onOpenChannels,
  onClose,
}: {
  agent: AgentSummary;
  channelGroups: ChannelGroup[];
  allAgents: AgentSummary[];
  defaultAgentId: string;
  channelAccountOwners: Record<string, string>;
  onOpenChannels: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('agents');
  const { updateAgent, assignChannel, removeChannel } = useAgentsStore();
  const { fetchChannels } = useChannelsStore();
  const providerAccounts = useProviderStore((state) => state.accounts);
  const providerStatuses = useProviderStore((state) => state.statuses);
  const providerVendors = useProviderStore((state) => state.vendors);
  const defaultAccountId = useProviderStore((state) => state.defaultAccountId);
  const workspacePath = agent.local.workspace?.trim() || '';
  const [name, setName] = useState(resolveAgentDisplayName(agent));
  const [savingName, setSavingName] = useState(false);
  const [selectedModelRef, setSelectedModelRef] = useState(agent.local.inheritedModel ? '__inherit__' : (agent.local.modelRef ?? '__inherit__'));
  const [savingModel, setSavingModel] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [showBindingModal, setShowBindingModal] = useState(false);
  const [channelToRemove, setChannelToRemove] = useState<{
    channelType: ChannelType;
    accountId: string;
    name: string;
  } | null>(null);
  const [bindingKey, setBindingKey] = useState<string | null>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const [modelMenuPosition, setModelMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useEffect(() => {
    setName(resolveAgentDisplayName(agent));
    setSelectedModelRef(agent.local.inheritedModel ? '__inherit__' : (agent.local.modelRef ?? '__inherit__'));
    setModelMenuOpen(false);
  }, [agent]);

  const providerStatusMap = useMemo(
    () => new Map((providerStatuses ?? []).map((status) => [status.id, status])),
    [providerStatuses],
  );
  const vendorMap = useMemo(
    () => new Map((providerVendors ?? []).map((vendor) => [vendor.id, vendor])),
    [providerVendors],
  );
  const modelOptions = useMemo(() => {
    const eligibleAccounts = providerAccounts
      .filter((account) => account.enabled)
      .filter((account) => account.authMode === 'local'
        || account.authMode === 'oauth_device'
        || account.authMode === 'oauth_browser'
        || Boolean(providerStatusMap.get(account.id)?.hasKey));

    return dedupeModelOptions(
      eligibleAccounts
        .flatMap((account) => {
          const vendor = vendorMap.get(account.vendorId);
          const providerDisplayName = getProviderDisplayName(account, vendor);
          return resolveAccountModelOptions(account, vendor, providerDisplayName);
        })
        .sort((left, right) => left.label.localeCompare(right.label)),
    );
  }, [providerAccounts, providerStatusMap, vendorMap]);
  const defaultModelOption = useMemo(() => {
    const defaultAccount = providerAccounts.find((account) => account.id === defaultAccountId);
    if (!defaultAccount) return null;
    const vendor = vendorMap.get(defaultAccount.vendorId);
    const providerDisplayName = getProviderDisplayName(defaultAccount, vendor);
    return resolveAccountModelOptions(defaultAccount, vendor, providerDisplayName)[0] ?? null;
  }, [defaultAccountId, providerAccounts, vendorMap]);
  const selectedModelOption = modelOptions.find((option) => option.value === selectedModelRef);
  const selectableModelOptions = modelOptions.filter((option) => {
    if (option.value === selectedModelRef) {
      return false;
    }
    if (defaultModelOption && option.value === defaultModelOption.value) {
      return false;
    }
    return true;
  });

  useEffect(() => {
    if (!modelMenuOpen) return;

    const updatePosition = () => {
      const rect = modelTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 16;
      const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
      const availableAbove = rect.top - viewportPadding;
      const openUpward = availableBelow < 260 && availableAbove > availableBelow;
      setModelMenuPosition({
        top: openUpward ? rect.top - 8 : rect.bottom + 8,
        left: rect.left,
        width: rect.width,
        maxHeight: Math.max(180, Math.min(320, openUpward ? availableAbove - 8 : availableBelow - 8)),
      });
    };

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!modelMenuRef.current?.contains(target) && !modelTriggerRef.current?.contains(target)) {
        setModelMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModelMenuOpen(false);
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [modelMenuOpen]);

  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === resolveAgentDisplayName(agent)) return;
    setSavingName(true);
    try {
      await updateAgent(agent.gateway.id, { name: name.trim() });
      toast.success(t('toast.agentUpdated'));
    } catch (error) {
      toast.error(t('toast.agentUpdateFailed', { error: String(error) }));
    } finally {
      setSavingName(false);
    }
  };

  const handleSelectModel = async (nextValue: string) => {
    if (savingModel || nextValue === selectedModelRef) {
      setModelMenuOpen(false);
      return;
    }
    setSelectedModelRef(nextValue);
    setModelMenuOpen(false);
    setSavingModel(true);
    try {
      await updateAgent(agent.gateway.id, {
        model: nextValue === '__inherit__' ? null : nextValue,
      });
      toast.success(t('toast.agentUpdated'));
    } catch (error) {
      setSelectedModelRef(agent.local.inheritedModel ? '__inherit__' : (agent.local.modelRef ?? '__inherit__'));
      toast.error(t('toast.agentUpdateFailed', { error: String(error) }));
    } finally {
      setSavingModel(false);
    }
  };

  const handleChannelSaved = async (channelType: ChannelType, accountId: string) => {
    try {
      await assignChannel(agent.gateway.id, channelType, accountId);
      // Binding only changes local ownership metadata. Avoid blocking the modal on
      // a runtime channel-status probe while Gateway is reloading.
      await fetchChannels(false, { includeRuntime: false });
      toast.success(
        t('toast.channelAssigned', {
          channel: `${CHANNEL_NAMES[channelType] || channelType} / ${accountId}`,
          defaultValue: `${CHANNEL_NAMES[channelType] || channelType} / ${accountId} 已分配给分身`,
        }),
      );
    } catch (error) {
      toast.error(t('toast.channelAssignFailed', { error: String(error) }));
      throw error;
    }
  };

  const runtimeChannelsByType = useMemo(
    () => Object.fromEntries((channelGroups ?? []).map((group) => [group.type, group])),
    [channelGroups],
  );
  const agentNamesById = useMemo(
    () =>
      Object.fromEntries(
        allAgents.map((item) => [
          item.gateway.id,
          item.gateway.name?.trim() || item.gateway.identity?.name?.trim() || item.gateway.id,
        ]),
      ) as Record<string, string>,
    [allAgents],
  );

  const configuredChannelTypes = useMemo(
    () => new Set((channelGroups ?? []).filter((g) => g.configured).map((g) => g.type)),
    [channelGroups],
  );
  const assignedChannels = agent.local.boundChannelAccounts.map((binding) => {
    const runtimeChannel = runtimeChannelsByType[binding.channelType];
    const runtimeAccount = runtimeChannel?.accounts.find((account) => account.accountId === binding.accountId);
    // Prefer runtime account status. When the channel has no runtime account
    // at all, fall back to the channel-level configured flag to avoid showing
    // "未连接" for a channel that is properly set up.
    const accountStatus = runtimeAccount?.status as ChannelRuntimeState | undefined;
    const effectiveStatus: ChannelRuntimeState =
      accountStatus && accountStatus !== 'unknown'
        ? accountStatus
        : runtimeChannel
          ? runtimeChannel.configured
            ? 'configured'
            : (runtimeChannel.status as ChannelRuntimeState) || 'disconnected'
          : configuredChannelTypes.has(binding.channelType as ChannelType)
            ? 'configured'
            : 'disconnected';
    const runtimeStatus = resolveChannelRuntimeStatusMeta(effectiveStatus, t);
    return {
      channelType: binding.channelType as ChannelType,
      accountId: binding.accountId,
      isDefaultAccount: binding.isDefaultAccount,
      name: resolveLocalizedChannelName(
        binding.channelType as ChannelType,
        CHANNEL_NAMES[binding.channelType as ChannelType] || binding.channelType,
      ),
      status: runtimeStatus.status,
      statusLabel: runtimeStatus.label,
      error: runtimeAccount?.error || runtimeChannel?.error,
    };
  });
  const implicitDefaultChannels = useMemo(() => {
    if (agent.gateway.id !== defaultAgentId) {
      return [];
    }
    return channelGroups.flatMap((group) =>
      group.accounts
        .filter((account) => !channelAccountOwners[`${group.type}:${account.accountId}`])
        .map((account) => {
          // Prefer runtime account status; if no runtime data at all (account.status
          // is 'configured' meaning no runtime connection), show "已配置".
          const accountStatus = account.status as ChannelRuntimeState | undefined;
          const hasRuntimeStatus = accountStatus && accountStatus !== 'unknown';
          const effectiveStatus: ChannelRuntimeState = hasRuntimeStatus
            ? accountStatus
            : group.configured
              ? 'configured'
              : accountStatus || 'disconnected';
          const runtimeStatus = resolveChannelRuntimeStatusMeta(effectiveStatus, t);
          return {
            channelType: group.type,
            accountId: account.accountId,
            isDefaultAccount: account.isDefaultAccount,
            name: resolveLocalizedChannelName(group.type, group.name),
            status: runtimeStatus.status,
            statusLabel: runtimeStatus.label,
            error: account.error,
            implicitDefault: true,
          };
        }),
    );
  }, [agent.gateway.id, channelAccountOwners, channelGroups, defaultAgentId, t]);
  const visibleAssignedChannels = useMemo(() => {
    const merged = [...assignedChannels];
    for (const channel of implicitDefaultChannels) {
      if (merged.some((item) => item.channelType === channel.channelType && item.accountId === channel.accountId)) {
        continue;
      }
      merged.push(channel);
    }
    return merged;
  }, [assignedChannels, implicitDefaultChannels]);
  const availableBindings = useMemo(
    () =>
      channelGroups.flatMap((group) =>
        group.accounts.map((account) => {
          const ownerId = channelAccountOwners[`${group.type}:${account.accountId}`];
          const implicitAssignedHere = !ownerId && defaultAgentId === agent.gateway.id;
          return {
            channelType: group.type,
            channelName: resolveLocalizedChannelName(group.type, group.name),
            accountId: account.accountId,
            isDefaultAccount: account.isDefaultAccount,
            status: account.status,
            configured: account.configured,
            error: account.error,
            ownerId,
            ownerName: ownerId ? agentNamesById[ownerId] : undefined,
            isAssignedHere: ownerId === agent.gateway.id,
            implicitAssignedHere,
            fallbackOwnerName: !ownerId && defaultAgentId ? agentNamesById[defaultAgentId] : undefined,
          };
        }),
      ),
    [agent.gateway.id, agentNamesById, channelAccountOwners, channelGroups, defaultAgentId],
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border bg-card shadow-[0_26px_80px_rgba(15,23,42,0.22)]">
        <CardHeader className="shrink-0 border-b border-border/60 pb-4">
          <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-[30px] font-semibold tracking-tight">
              {t('settingsDialog.title', { name: resolveAgentDisplayName(agent) })}
            </CardTitle>
            <CardDescription className="mt-2 max-w-2xl text-[15px] leading-6 text-foreground/70">
              {t('settingsDialog.description')}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="-mr-2 -mt-2 h-8 w-8 rounded-xl text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-6 pt-6">
          <div className="space-y-6">
            <section className="rounded-3xl border border-border/70 bg-muted/[0.18] p-5">
              <div className="mb-4 flex items-start gap-4">
                <div className={cn(
                  'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border text-xl shadow-sm',
                  agent.gateway.isDefault
                    ? 'border-primary/20 bg-primary/12'
                    : 'border-black/8 bg-background dark:border-white/10'
                )}>
                  {resolveAgentAvatar(agent) ? (
                    <span aria-hidden="true">{resolveAgentAvatar(agent)}</span>
                  ) : (
                    <Bot className="h-5 w-5 text-foreground/75" strokeWidth={2} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <h3 className="truncate text-[20px] font-semibold tracking-tight text-foreground">
                      {resolveAgentDisplayName(agent)}
                    </h3>
                    {agent.gateway.isDefault ? (
                      <Badge
                        variant="secondary"
                        className="rounded-full border-0 bg-primary/12 px-2.5 py-1 text-[11px] font-medium text-primary shadow-none"
                      >
                        {t('defaultBadge')}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 font-mono text-[12px] text-muted-foreground/80">{agent.gateway.id}</p>
                </div>
              </div>

              <div className="space-y-2.5">
              <Label htmlFor="agent-settings-name" className={labelClasses}>{t('settingsDialog.nameLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  id="agent-settings-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={inputClasses}
                />
                <Button
                  variant="outline"
                  onClick={() => void handleSaveName()}
                  disabled={savingName || !name.trim() || name.trim() === resolveAgentDisplayName(agent)}
                  className="h-[44px] text-[13px] font-medium rounded-xl px-4 border-black/10 dark:border-white/10 bg-muted/70 dark:bg-muted/40 hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
                >
                  {savingName ? (
                    <LoadingIcon className="h-4 w-4" />
                  ) : (
                    t('common:actions.save')
                  )}
                </Button>
              </div>
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl border border-border/70 bg-muted/[0.18] p-5">
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/75 font-medium">
                  {t('settingsDialog.agentIdLabel')}
                </p>
                <p className="mt-2 font-mono text-[13px] text-foreground">{agent.gateway.id}</p>
              </div>
              <div className="rounded-3xl border border-border/70 bg-muted/[0.18] p-5">
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/75 font-medium">
                  {t('settingsDialog.modelLabel')}
                </p>
                <div className="mt-2 space-y-3">
                  <Button
                    ref={modelTriggerRef}
                    type="button"
                    variant="outline"
                    onClick={() => setModelMenuOpen((open) => !open)}
                    disabled={savingModel}
                    className="h-[44px] w-full justify-between rounded-xl border-black/10 bg-background px-3.5 text-[13px] font-medium text-foreground shadow-sm hover:bg-background dark:border-white/10 dark:bg-background"
                  >
                    <span className="truncate text-left">
                      {selectedModelRef === '__inherit__'
                        ? (defaultModelOption?.label ?? agent.local.modelDisplay)
                        : selectedModelOption
                          ? selectedModelOption.label
                          : selectedModelRef}
                    </span>
                    {selectedModelRef === '__inherit__' ? (
                      <span className="mr-1 inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {t('defaultBadge')}
                      </span>
                    ) : null}
                    {savingModel ? (
                      <LoadingIcon className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', modelMenuOpen && 'rotate-180')} />
                    )}
                  </Button>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-border/70 bg-muted/[0.18] p-5">
              <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/75 font-medium">
                {t('meta.workspace', 'Workspace')}
              </p>
              {workspacePath ? (
                <button
                  type="button"
                  onClick={() => {
                    void openWorkspaceFolder(workspacePath).catch((error) => {
                      toast.error(t('toast.openWorkspaceFailed', { error: String(error) }));
                    });
                  }}
                  className="group mt-2 inline-flex min-w-0 max-w-full items-center gap-2 rounded-2xl bg-background px-3.5 py-3 font-mono text-[13px] text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:bg-primary/8 hover:text-foreground"
                  title={workspacePath}
                >
                  <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                  <span className="truncate">{workspacePath}</span>
                </button>
              ) : (
                <p className="mt-2 font-mono text-[13px] text-foreground">default</p>
              )}
            </section>

            <section className="rounded-3xl border border-border/70 bg-muted/[0.18] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[20px] font-semibold tracking-tight text-foreground">
                  {t('settingsDialog.channelsTitle')}
                </h3>
                <p className="mt-1 max-w-2xl text-[14px] leading-6 text-foreground/70">
                  {t('settingsDialog.channelsDescription', '先在连接页配置账户，再在这里把具体账户绑定到当前分身。这里显示的是绑定摘要，不直接编辑连接凭据。')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={onOpenChannels}
                  className="h-9 rounded-xl border-black/10 bg-transparent px-4 text-[13px] font-medium text-foreground/80 shadow-none hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
                >
                  {t('settingsDialog.openChannels', '去配置连接')}
                </Button>
                <Button
                  onClick={() => setShowBindingModal(true)}
                  className="h-9 rounded-xl px-4 text-[13px] font-medium shadow-none"
                >
                  <Plus className="h-3.5 w-3.5 mr-2" />
                  {t('settingsDialog.addChannel', '绑定已有连接')}
                </Button>
              </div>
            </div>

            {visibleAssignedChannels.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/80 bg-muted/35 p-4 text-[13.5px] text-muted-foreground">
                {t('settingsDialog.noChannels', '当前没有绑定任何连接。请先在连接页配置账户，再回来绑定。')}
              </div>
            ) : (
              <div className="space-y-3">
                {visibleAssignedChannels.map((channel) => (
                  <div
                    key={`${channel.channelType}:${channel.accountId}`}
                    className="rounded-2xl border border-border/70 bg-muted/35 p-4 sm:p-5"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3.5">
                        <PageChannelLogo type={channel.channelType} branded />
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <p className="truncate text-[15.5px] font-semibold text-foreground">{channel.name}</p>
                            {'implicitDefault' in channel && channel.implicitDefault ? (
                              <Badge
                                variant="secondary"
                                className="rounded-full border-0 bg-amber-500/12 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 shadow-none dark:text-amber-300"
                              >
                                {t('settingsDialog.defaultFallbackBadge', '默认接管')}
                              </Badge>
                            ) : null}
                          </div>
                          <p
                            className={cn(
                              'mt-1 text-[13.5px]',
                              channel.isDefaultAccount ? 'font-medium text-primary' : 'text-muted-foreground',
                            )}
                          >
                            {channel.isDefaultAccount
                              ? `${t('defaultAccount', '默认账户')}：${channel.accountId}`
                              : t('settingsDialog.boundAccount', {
                                accountId: channel.accountId,
                                defaultValue: `账户：${channel.accountId}`,
                              })}
                          </p>
                          {channel.error ? (
                            <p className="mt-2 text-[12px] text-destructive">{channel.error}</p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <div className="flex items-center justify-end gap-2.5">
                          <StatusBadge status={channel.status} label={channel.statusLabel} />
                          <Button
                            variant="dangerGhost"
                            size="icon"
                            className="h-8 w-8 rounded-[10px]"
                            onClick={() =>
                              setChannelToRemove({
                                channelType: channel.channelType,
                                accountId: channel.accountId,
                                name: `${channel.name} / ${channel.accountId}`,
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </section>
          </div>
        </CardContent>
      </Card>

      {showBindingModal && (
        <BindingPickerModal
          bindings={availableBindings}
          defaultAgentName={defaultAgentId ? agentNamesById[defaultAgentId] : undefined}
          onClose={() => setShowBindingModal(false)}
          onOpenChannels={onOpenChannels}
          onBind={async (channelType, accountId) => {
            setBindingKey(`${channelType}:${accountId}`);
            try {
              await handleChannelSaved(channelType, accountId);
              setShowBindingModal(false);
            } finally {
              setBindingKey(null);
            }
          }}
          bindingKey={bindingKey}
        />
      )}

      <ConfirmDialog
        open={!!channelToRemove}
        title={t('removeChannelDialog.title')}
        message={channelToRemove ? t('removeChannelDialog.message', {
          name: channelToRemove.name,
          defaultValue: `确认解绑 ${channelToRemove.name}？`,
        }) : ''}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!channelToRemove) return;
          const removing = channelToRemove;
          setChannelToRemove(null);
          try {
            await removeChannel(agent.gateway.id, removing.channelType, removing.accountId);
            await fetchChannels(false, { includeRuntime: false });
            toast.success(t('toast.channelRemoved', {
              channel: removing.name,
              defaultValue: `${removing.name} 已解绑`,
            }));
          } catch (error) {
            toast.error(t('toast.channelRemoveFailed', { error: String(error) }));
          }
        }}
        onCancel={() => setChannelToRemove(null)}
      />
      {modelMenuOpen && modelMenuPosition
        ? createPortal(
            <div
              ref={modelMenuRef}
              className="fixed z-[130] overflow-hidden rounded-[16px] border border-black/10 bg-card shadow-[0_18px_44px_rgba(15,23,42,0.12)] dark:border-white/10 dark:bg-card"
              style={{
                top: modelMenuPosition.top,
                left: modelMenuPosition.left,
                width: modelMenuPosition.width,
                maxHeight: modelMenuPosition.maxHeight,
                transform: modelMenuPosition.top > (modelTriggerRef.current?.getBoundingClientRect().top ?? 0) ? 'none' : 'translateY(-100%)',
              }}
            >
              <div className="max-h-[inherit] overflow-y-auto p-1.5">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2.5 text-left text-[13px] text-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                  onClick={() => void handleSelectModel('__inherit__')}
                >
                  <span className="flex-1 truncate">{defaultModelOption?.label ?? agent.local.modelDisplay}</span>
                  <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {t('defaultBadge')}
                  </span>
                  {selectedModelRef === '__inherit__' ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                </button>
                {selectableModelOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2.5 text-left text-[13px] text-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                    onClick={() => void handleSelectModel(option.value)}
                  >
                    <span className="flex-1 truncate">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function BindingPickerModal({
  bindings,
  bindingKey,
  defaultAgentName,
  onClose,
  onOpenChannels,
  onBind,
}: {
  bindings: Array<{
    channelType: ChannelType;
    channelName: string;
    accountId: string;
    isDefaultAccount: boolean;
    status: string;
    configured: boolean;
    error?: string;
    ownerId?: string;
    ownerName?: string;
    fallbackOwnerName?: string;
    isAssignedHere: boolean;
    implicitAssignedHere: boolean;
  }>;
  bindingKey: string | null;
  defaultAgentName?: string;
  onClose: () => void;
  onOpenChannels: () => void;
  onBind: (channelType: ChannelType, accountId: string) => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const availableBindings = bindings.filter((binding) => binding.configured || binding.status !== 'disconnected' || binding.error);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-2xl font-semibold tracking-tight">
            {t('bindingDialog.title', '绑定已有连接')}
          </CardTitle>
          <CardDescription className="text-[15px] mt-1 text-foreground/70">
            {t('bindingDialog.description', '按账户绑定已配置连接。多账户连接会分别归属到不同分身。')}
          </CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto space-y-4 p-6 pt-4">
          {availableBindings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/80 bg-muted/35 p-5 text-sm text-muted-foreground">
              <p>{t('bindingDialog.empty', '还没有可绑定的连接。请先去连接页配置账户。')}</p>
              <Button
                variant="outline"
                onClick={onOpenChannels}
                className="mt-4 h-9 rounded-xl border-black/10 bg-transparent px-4 text-[13px] font-medium text-foreground/80 shadow-none hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
              >
                {t('settingsDialog.openChannels', '去配置连接')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {availableBindings.map((binding) => {
                const ownerLabel = binding.ownerId
                  ? t('bindingDialog.otherOwner', {
                      name: binding.ownerName || binding.ownerId,
                      defaultValue: `当前归属：${binding.ownerName || binding.ownerId}`,
                    })
                  : binding.fallbackOwnerName || defaultAgentName
                    ? t('bindingDialog.fallbackOwner', {
                        name: binding.fallbackOwnerName || defaultAgentName,
                        defaultValue: `未显式绑定，默认回退到：${binding.fallbackOwnerName || defaultAgentName}`,
                      })
                    : t('bindingDialog.unassigned', '未绑定分身');
                const currentBindingKey = `${binding.channelType}:${binding.accountId}`;
                return (
                  <div key={currentBindingKey} className="rounded-2xl border border-border/70 bg-muted/25 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <PageChannelLogo type={binding.channelType} branded />
                          <div className="min-w-0">
                            <p className="text-[15px] font-semibold text-foreground">{binding.channelName}</p>
                            <p className="text-[13px] text-muted-foreground">{ownerLabel}</p>
                          </div>
                        </div>
                        <p className="mt-3 text-[12px] text-muted-foreground/80">
                          {t('bindingDialog.account', {
                            accountId: binding.accountId,
                            defaultValue: `账户：${binding.accountId}`,
                          })}
                        </p>
                        <p className="mt-1 text-[12px] text-muted-foreground/70">
                          {binding.configured
                            ? t('bindingDialog.accountConfigured', '该账户已完成配置，可直接绑定。')
                            : t('bindingDialog.accountNotConfigured', '该账户尚未完成配置，建议先回到连接页补全配置。')}
                        </p>
                        {binding.isDefaultAccount ? (
                          <Badge
                            variant="secondary"
                            className="mt-2 rounded-full border-0 bg-primary/12 px-2 py-0.5 text-[10px] font-medium text-primary shadow-none"
                          >
                            {t('defaultAccount', '默认账户')}
                          </Badge>
                        ) : null}
                        {binding.error ? (
                          <p className="mt-2 text-[12px] text-destructive">{binding.error}</p>
                        ) : null}
                      </div>
                      <Button
                        onClick={() => void onBind(binding.channelType, binding.accountId)}
                        disabled={bindingKey === currentBindingKey || binding.isAssignedHere || binding.implicitAssignedHere}
                        className="h-9 rounded-xl px-4 text-[13px] font-medium shadow-none"
                      >
                        {bindingKey === currentBindingKey
                          ? t('bindingDialog.binding', '绑定中...')
                          : binding.isAssignedHere
                            ? t('bindingDialog.boundHere', '已绑定')
                            : binding.implicitAssignedHere
                              ? t('bindingDialog.defaultFallbackHere', '默认接管中')
                            : binding.ownerId
                              ? t('bindingDialog.reassignAction', '转移到当前分身')
                              : t('bindingDialog.bindAction', '绑定到当前分身')}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
        <div className="flex justify-end gap-2 border-t border-border/60 bg-card px-6 py-4">
          <Button
            variant="outline"
            onClick={onClose}
            className="h-9 rounded-xl border-black/10 bg-transparent px-4 text-[13px] font-medium text-foreground/80 shadow-none hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
          >
            {t('common:actions.cancel')}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default Agents;
