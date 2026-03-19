import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bot, FolderOpen, PencilLine, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusBadge, type Status } from '@/components/common/StatusBadge';
import { LoadingIcon } from '@/components/common/LoadingSpinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { useAgentsStore } from '@/stores/agents';
import { useChannelsStore } from '@/stores/channels';
import { useGatewayStore } from '@/stores/gateway';
import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelGroup, type ChannelType } from '@/types/channel';
import type { AgentSummary } from '@/types/agent';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';
import { invokeIpc } from '@/lib/api-client';
import { subscribeHostEvent } from '@/lib/host-events';

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

export function Agents() {
  const { t } = useTranslation('agents');
  const navigate = useNavigate();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const gatewayLifecycle = useGatewayStore((state) => state.lifecycle);
  const {
    agents,
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

  useEffect(() => {
    void fetchAgents();
    void fetchChannels(false, { includeRuntime: false });
  }, [fetchAgents, fetchChannels]);

  useEffect(() => {
    const unsubscribeGateway = subscribeHostEvent('gateway:status', () => {
      void fetchAgents();
      void fetchChannels(false);
    });
    const unsubscribeChannels = subscribeHostEvent('gateway:channel-status', () => {
      void fetchAgents();
      void fetchChannels(false);
    });
    return () => {
      if (typeof unsubscribeGateway === 'function') {
        unsubscribeGateway();
      }
      if (typeof unsubscribeChannels === 'function') {
        unsubscribeChannels();
      }
    };
  }, [fetchAgents, fetchChannels]);
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
  const handleRefresh = () => {
    void fetchAgents();
    void fetchChannels(false);
  };

  return (
    <div className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
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

          <div className="grid gap-3 mb-5 md:grid-cols-2 xl:grid-cols-4">
            {loading && agents.length === 0 ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={`agent-stat-skeleton-${index}`} className="rounded-xl border bg-card px-4 py-4 animate-pulse">
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

          <section className="rounded-xl border bg-card p-4">
            <div className="mb-3">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                {t('list.title')}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('list.description')}
              </p>
            </div>

            {loading && agents.length === 0 ? (
              <div className="grid gap-3 grid-cols-1">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={`agent-card-skeleton-${index}`}
                    className="rounded-xl border bg-card px-4 py-4 animate-pulse"
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
              <div className="rounded-xl border border-dashed px-4 py-8 text-center">
                <p className="text-sm font-medium text-foreground">{t('empty.title')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('empty.description')}</p>
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-1">
                {agents.map((agent) => (
                  <AgentCard
                    key={agent.gateway.id}
                    agent={agent}
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
    <div className="rounded-xl border bg-card px-4 py-4">
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
  onOpenSettings,
  onDelete,
}: {
  agent: AgentSummary;
  onOpenSettings: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('agents');
  const displayName = resolveAgentDisplayName(agent);
  const identityName = agent.gateway.identity?.name?.trim();
  const avatarGlyph = resolveAgentAvatar(agent);
  const workspacePath = agent.local.workspace?.trim() || '';
  const channelLabels = Array.from(new Set(agent.local.boundChannelAccounts.map((binding) => binding.channelType)))
    .map((channelType) => CHANNEL_NAMES[channelType as ChannelType] || channelType)
    .filter(Boolean);
  const modelMeta = splitAgentModelDisplay(agent.local.modelDisplay);
  const connectionSummary = channelLabels.length > 0
    ? channelLabels.join(' / ')
    : t('none');

  return (
    <div
      className={cn(
        'h-full rounded-[28px] border border-border/80 bg-background/96 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.045)] transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_18px_44px_rgba(15,23,42,0.08)]',
        agent.gateway.isDefault && 'border-sky-200/80 bg-[linear-gradient(180deg,rgba(56,189,248,0.08),rgba(255,255,255,0.96))]'
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              'mt-0.5 flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] border text-[24px] shadow-[0_8px_20px_rgba(15,23,42,0.08)]',
              agent.gateway.isDefault
                ? 'border-sky-200 bg-sky-50 text-sky-600'
                : 'border-border/70 bg-muted/[0.5] text-foreground/78'
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
                        className="h-9 w-9 rounded-2xl border border-border/70 bg-background/80 text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground"
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
                          className="h-9 w-9 rounded-2xl border border-red-200/80 bg-red-50/80 shadow-sm hover:bg-red-100"
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
          <div className="rounded-[22px] border border-border/70 bg-white/72 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
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

          <div className="rounded-[22px] border border-border/70 bg-white/72 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/75">
              {t('fieldLabels.channels')}
            </div>
            <div className="mt-2 text-[17px] font-medium text-foreground/82" title={connectionSummary}>
              <span className="block truncate">{connectionSummary}</span>
            </div>
          </div>

          <div className="rounded-[22px] border border-border/70 bg-white/72 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
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

function ChannelLogo({ type, branded = false }: { type: ChannelType; branded?: boolean }) {
  const brand = CHANNEL_BRAND_STYLES[type];
  const shellClass = branded
    ? brand?.shell ?? 'bg-slate-900 border-slate-800 shadow-[0_10px_24px_rgba(15,23,42,0.16)]'
    : 'bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/10 shadow-sm';
  const iconClass = branded ? brand?.icon ?? 'brightness-0 invert' : '';

  const wrap = (content: React.ReactNode) => (
    <div className={cn('h-[40px] w-[40px] shrink-0 flex items-center justify-center rounded-full border', shellClass)}>
      {content}
    </div>
  );

  switch (type) {
    case 'telegram':
      return wrap(<img src={telegramIcon} alt="Telegram" className={cn('w-[20px] h-[20px]', iconClass)} />);
    case 'discord':
      return wrap(<img src={discordIcon} alt="Discord" className={cn('w-[20px] h-[20px]', iconClass)} />);
    case 'whatsapp':
      return wrap(<img src={whatsappIcon} alt="WhatsApp" className={cn('w-[20px] h-[20px]', iconClass)} />);
    case 'dingtalk':
      return wrap(<img src={dingtalkIcon} alt="DingTalk" className={cn('w-[20px] h-[20px]', iconClass)} />);
    case 'feishu':
      return wrap(<img src={feishuIcon} alt="Feishu" className={cn('w-[20px] h-[20px]', iconClass)} />);
    case 'wecom':
      return wrap(<img src={wecomIcon} alt="WeCom" className={cn('w-[20px] h-[20px]', iconClass)} />);
    case 'qqbot':
      return wrap(<img src={qqIcon} alt="QQ" className={cn('w-[20px] h-[20px]', iconClass)} />);
    default:
      return <span className="text-[20px] leading-none">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
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
  channelAccountOwners,
  onOpenChannels,
  onClose,
}: {
  agent: AgentSummary;
  channelGroups: ChannelGroup[];
  allAgents: AgentSummary[];
  channelAccountOwners: Record<string, string>;
  onOpenChannels: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('agents');
  const modelMeta = splitAgentModelDisplay(agent.local.modelDisplay);
  const { updateAgent, assignChannel, removeChannel } = useAgentsStore();
  const { fetchChannels } = useChannelsStore();
  const workspacePath = agent.local.workspace?.trim() || '';
  const [name, setName] = useState(resolveAgentDisplayName(agent));
  const [savingName, setSavingName] = useState(false);
  const [showBindingModal, setShowBindingModal] = useState(false);
  const [channelToRemove, setChannelToRemove] = useState<{
    channelType: ChannelType;
    accountId: string;
    name: string;
  } | null>(null);
  const [bindingKey, setBindingKey] = useState<string | null>(null);

  useEffect(() => {
    setName(resolveAgentDisplayName(agent));
  }, [agent]);

  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === resolveAgentDisplayName(agent)) return;
    setSavingName(true);
    try {
      await updateAgent(agent.gateway.id, name.trim());
      toast.success(t('toast.agentUpdated'));
    } catch (error) {
      toast.error(t('toast.agentUpdateFailed', { error: String(error) }));
    } finally {
      setSavingName(false);
    }
  };

  const handleChannelSaved = async (channelType: ChannelType, accountId: string) => {
    try {
      await assignChannel(agent.gateway.id, channelType, accountId);
      await fetchChannels();
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

  const assignedChannels = agent.local.boundChannelAccounts.map((binding) => {
    const runtimeChannel = runtimeChannelsByType[binding.channelType];
    const runtimeAccount = runtimeChannel?.accounts.find((account) => account.accountId === binding.accountId);
    const effectiveStatus = runtimeAccount?.status || runtimeChannel?.status || 'disconnected';
    const displayStatus: Status =
      effectiveStatus === 'unknown'
        ? 'disconnected'
        : effectiveStatus === 'configured'
          ? 'configured'
          : effectiveStatus;
    return {
      channelType: binding.channelType as ChannelType,
      accountId: binding.accountId,
      isDefaultAccount: binding.isDefaultAccount,
      name: CHANNEL_NAMES[binding.channelType as ChannelType] || binding.channelType,
      status: displayStatus,
      statusLabel: effectiveStatus === 'configured'
        ? t('runtime.configuredOnly', '已配置')
        : effectiveStatus === 'unknown'
          ? t('runtime.unknown', '未知')
          : runtimeAccount || runtimeChannel
            ? undefined
            : t('settingsDialog.assignedStatus'),
      error: runtimeAccount?.error || runtimeChannel?.error,
    };
  });
  const availableBindings = useMemo(
    () =>
      channelGroups.flatMap((group) =>
        group.accounts.map((account) => {
          const ownerId = channelAccountOwners[`${group.type}:${account.accountId}`];
          return {
            channelType: group.type,
            channelName: group.name,
            accountId: account.accountId,
            isDefaultAccount: account.isDefaultAccount,
            status: account.status,
            configured: account.configured,
            error: account.error,
            ownerId,
            ownerName: ownerId ? agentNamesById[ownerId] : undefined,
            isAssignedHere: ownerId === agent.gateway.id,
          };
        }),
      ),
    [agent.gateway.id, agentNamesById, channelAccountOwners, channelGroups],
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
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13.5px] text-foreground">
                  <span>{modelMeta.value}</span>
                  {modelMeta.isDefaultModel ? (
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      {t('defaultBadge')}
                    </span>
                  ) : null}
                  {agent.local.inheritedModel ? (
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {t('inherited')}
                    </span>
                  ) : null}
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

            {assignedChannels.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/80 bg-muted/35 p-4 text-[13.5px] text-muted-foreground">
                {t('settingsDialog.noChannels', '当前没有绑定任何连接。请先在连接页配置账户，再回来绑定。')}
              </div>
            ) : (
              <div className="space-y-3">
                {assignedChannels.map((channel) => (
                  <div key={`${channel.channelType}:${channel.accountId}`} className="flex items-center justify-between rounded-2xl border border-border/70 bg-muted/35 p-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <ChannelLogo type={channel.channelType} branded />
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-foreground">{channel.name}</p>
                        <p className="text-[13.5px] text-muted-foreground">
                          {t('settingsDialog.boundAccount', {
                            accountId: channel.accountId,
                            defaultValue: `账户：${channel.accountId}`,
                          })}
                        </p>
                        {channel.isDefaultAccount ? (
                          <Badge
                            variant="secondary"
                            className="mt-1 rounded-full border-0 bg-primary/12 px-2 py-0.5 text-[10px] font-medium text-primary shadow-none"
                          >
                            {t('defaultAccount', '默认账户')}
                          </Badge>
                        ) : null}
                        {channel.error && (
                          <p className="text-xs text-destructive mt-1">{channel.error}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
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
            await fetchChannels();
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
    </div>
  );
}

function BindingPickerModal({
  bindings,
  bindingKey,
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
    isAssignedHere: boolean;
  }>;
  bindingKey: string | null;
  onClose: () => void;
  onOpenChannels: () => void;
  onBind: (channelType: ChannelType, accountId: string) => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const availableBindings = bindings.filter((binding) => binding.configured || binding.status !== 'disconnected' || binding.error);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl rounded-2xl bg-card overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-2xl font-semibold tracking-tight">
            {t('bindingDialog.title', '绑定已有连接')}
          </CardTitle>
          <CardDescription className="text-[15px] mt-1 text-foreground/70">
            {t('bindingDialog.description', '按账户绑定已配置连接。多账户连接会分别归属到不同分身。')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4 p-6">
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
                  : t('bindingDialog.unassigned', '未绑定分身');
                const currentBindingKey = `${binding.channelType}:${binding.accountId}`;
                return (
                  <div key={currentBindingKey} className="rounded-2xl border border-border/70 bg-muted/25 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <ChannelLogo type={binding.channelType} branded />
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
                        disabled={bindingKey === currentBindingKey || binding.isAssignedHere}
                        className="h-9 rounded-xl px-4 text-[13px] font-medium shadow-none"
                      >
                        {bindingKey === currentBindingKey
                          ? t('bindingDialog.binding', '绑定中...')
                          : binding.isAssignedHere
                            ? t('bindingDialog.boundHere', '已绑定')
                            : t('bindingDialog.bindAction', '绑定到当前分身')}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-9 rounded-xl border-black/10 bg-transparent px-4 text-[13px] font-medium text-foreground/80 shadow-none hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
            >
              {t('common:actions.cancel')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default Agents;
