import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bot, PencilLine, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusBadge } from '@/components/common/StatusBadge';
import { LoadingIcon, PageLoader } from '@/components/common/LoadingSpinner';
import { ChannelConfigModal } from '@/components/channels/ChannelConfigModal';
import { PageHeader } from '@/components/layout/PageHeader';
import { useAgentsStore } from '@/stores/agents';
import { useChannelsStore } from '@/stores/channels';
import { useGatewayStore } from '@/stores/gateway';
import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelType } from '@/types/channel';
import type { AgentSummary } from '@/types/agent';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

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
  const gatewayStatus = useGatewayStore((state) => state.status);
  const {
    agents,
    loading,
    error,
    fetchAgents,
    createAgent,
    deleteAgent,
  } = useAgentsStore();
  const { channels, fetchChannels } = useChannelsStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<AgentSummary | null>(null);

  useEffect(() => {
    void Promise.all([fetchAgents(), fetchChannels()]);
  }, [fetchAgents, fetchChannels]);
  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? null,
    [activeAgentId, agents],
  );
  const stats = useMemo(
    () => ({
      total: agents.length,
      defaults: agents.filter((agent) => agent.isDefault).length,
      custom: agents.filter((agent) => !agent.isDefault).length,
      connected: agents.filter((agent) => agent.channelTypes.length > 0).length,
    }),
    [agents],
  );
  const handleRefresh = () => {
    void Promise.all([fetchAgents(), fetchChannels()]);
  };

  if (loading) {
    return (
      <div className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)]">
        <PageLoader
          title={t('loadingTitle', '正在加载分身')}
          description={t('loadingDescription', '正在同步分身配置和绑定关系，请稍候。')}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 pb-8 pt-10 md:px-8">
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={(
            <div className="flex items-center gap-3">
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

          <div className="grid gap-3 mb-5 md:grid-cols-2 xl:grid-cols-4">
            <AgentStatCard label={t('stats.total')} value={stats.total} />
            <AgentStatCard label={t('stats.defaults')} value={stats.defaults} />
            <AgentStatCard label={t('stats.custom')} value={stats.custom} />
            <AgentStatCard label={t('stats.connected')} value={stats.connected} />
          </div>

          <section className="rounded-xl border bg-card p-4 md:p-5">
            <div className="mb-4">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                {t('list.title')}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('list.description')}
              </p>
            </div>

            {agents.length === 0 ? (
              <div className="rounded-xl border border-dashed px-4 py-8 text-center">
                <p className="text-sm font-medium text-foreground">{t('empty.title')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('empty.description')}</p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {agents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    onOpenSettings={() => setActiveAgentId(agent.id)}
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
          channels={channels}
          onClose={() => setActiveAgentId(null)}
        />
      )}

      <ConfirmDialog
        open={!!agentToDelete}
        title={t('deleteDialog.title')}
        message={agentToDelete ? t('deleteDialog.message', { name: agentToDelete.name }) : ''}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!agentToDelete) return;
          await deleteAgent(agentToDelete.id);
          setAgentToDelete(null);
          if (activeAgentId === agentToDelete.id) {
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
  const channelLabels = agent.channelTypes
    .map((channelType) => CHANNEL_NAMES[channelType as ChannelType] || channelType)
    .filter(Boolean);
  const modelMeta = splitAgentModelDisplay(agent.modelDisplay);

  return (
    <div
      className={cn(
        'h-full rounded-xl border bg-background/70 px-4 py-4 transition-colors hover:border-primary/35 hover:bg-background',
        agent.isDefault && 'border-primary/20 bg-primary/[0.04]'
      )}
    >
      <div className="flex items-start gap-3.5">
        <div className={cn(
          'mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border text-primary',
          agent.isDefault
            ? 'border-primary/15 bg-primary/10'
            : 'border-black/8 bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.03]'
        )}>
          <Bot className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2.5">
                <h2 className="truncate text-[17px] font-semibold text-foreground">{agent.name}</h2>
                {agent.isDefault && (
                  <Badge
                    variant="secondary"
                    className="rounded-full border-0 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary shadow-none"
                  >
                    {t('defaultBadge')}
                  </Badge>
                )}
              </div>
              <p className="mt-1 font-mono text-[12px] text-muted-foreground/85">{agent.id}</p>
            </div>
            <TooltipProvider delayDuration={120}>
              <div className="flex items-center gap-2 shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                      onClick={onOpenSettings}
                    >
                      <PencilLine className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('settings')}</TooltipContent>
                </Tooltip>
                {!agent.isDefault && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="dangerGhost"
                        size="icon"
                        className="h-8 w-8 rounded-[10px]"
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

          <div className="mt-4 flex flex-wrap items-center gap-2.5 text-[13px]">
            <div className="inline-flex min-w-0 items-center gap-2 rounded-lg border bg-muted/25 px-3 py-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/75">
                {t('fieldLabels.model')}
              </span>
              <div className="flex min-w-0 items-center gap-1.5">
                <p className="truncate font-medium text-foreground">{modelMeta.value}</p>
                {modelMeta.isDefaultModel ? (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {t('defaultBadge')}
                  </span>
                ) : null}
                {agent.inheritedModel ? (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {t('inherited')}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="inline-flex min-w-0 items-center gap-2 rounded-lg border bg-muted/25 px-3 py-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/75">
                {t('fieldLabels.channels')}
              </span>
              {channelLabels.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {channelLabels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center rounded-md bg-background px-2 py-0.5 text-[12px] font-medium text-foreground/80"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-foreground/55">{t('none')}</p>
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
  channels,
  onClose,
}: {
  agent: AgentSummary;
  channels: Array<{ type: string; name: string; status: 'connected' | 'connecting' | 'disconnected' | 'error'; error?: string }>;
  onClose: () => void;
}) {
  const { t } = useTranslation('agents');
  const modelMeta = splitAgentModelDisplay(agent.modelDisplay);
  const { updateAgent, assignChannel, removeChannel } = useAgentsStore();
  const { fetchChannels } = useChannelsStore();
  const [name, setName] = useState(agent.name);
  const [savingName, setSavingName] = useState(false);
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [channelToRemove, setChannelToRemove] = useState<ChannelType | null>(null);

  useEffect(() => {
    setName(agent.name);
  }, [agent.name]);

  const runtimeChannelsByType = useMemo(
    () => Object.fromEntries((channels ?? []).map((channel) => [channel.type, channel])),
    [channels],
  );

  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === agent.name) return;
    setSavingName(true);
    try {
      await updateAgent(agent.id, name.trim());
      toast.success(t('toast.agentUpdated'));
    } catch (error) {
      toast.error(t('toast.agentUpdateFailed', { error: String(error) }));
    } finally {
      setSavingName(false);
    }
  };

  const handleChannelSaved = async (channelType: ChannelType) => {
    try {
      await assignChannel(agent.id, channelType);
      await fetchChannels();
      toast.success(t('toast.channelAssigned', { channel: CHANNEL_NAMES[channelType] || channelType }));
    } catch (error) {
      toast.error(t('toast.channelAssignFailed', { error: String(error) }));
      throw error;
    }
  };

  const assignedChannels = agent.channelTypes.map((channelType) => {
    const runtimeChannel = runtimeChannelsByType[channelType];
    return {
      channelType: channelType as ChannelType,
      name: runtimeChannel?.name || CHANNEL_NAMES[channelType as ChannelType] || channelType,
      status: runtimeChannel?.status || 'disconnected',
      statusLabel: runtimeChannel ? undefined : t('settingsDialog.assignedStatus'),
      error: runtimeChannel?.error,
    };
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-card overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
          <div>
            <CardTitle className="text-2xl font-semibold tracking-tight">
              {t('settingsDialog.title', { name: agent.name })}
            </CardTitle>
            <CardDescription className="text-[15px] mt-1 text-foreground/70">
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
        </CardHeader>
        <CardContent className="space-y-6 pt-4 overflow-y-auto flex-1 p-6">
          <div className="space-y-4">
            <div className="space-y-2.5">
              <Label htmlFor="agent-settings-name" className={labelClasses}>{t('settingsDialog.nameLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  id="agent-settings-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  readOnly={agent.isDefault}
                  className={inputClasses}
                />
                {!agent.isDefault && (
                  <Button
                    variant="outline"
                    onClick={() => void handleSaveName()}
                    disabled={savingName || !name.trim() || name.trim() === agent.name}
                    className="h-[44px] text-[13px] font-medium rounded-xl px-4 border-black/10 dark:border-white/10 bg-muted/70 dark:bg-muted/40 hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
                  >
                    {savingName ? (
                      <LoadingIcon className="h-4 w-4" />
                    ) : (
                      t('common:actions.save')
                    )}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-border/70 bg-muted/35 p-4">
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                  {t('settingsDialog.agentIdLabel')}
                </p>
                <p className="font-mono text-[13px] text-foreground">{agent.id}</p>
              </div>
              <div className="space-y-1 rounded-2xl border border-border/70 bg-muted/35 p-4">
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                  {t('settingsDialog.modelLabel')}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 text-[13.5px] text-foreground">
                  <span>{modelMeta.value}</span>
                  {modelMeta.isDefaultModel ? (
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      {t('defaultBadge')}
                    </span>
                  ) : null}
                  {agent.inheritedModel ? (
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {t('inherited')}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-foreground tracking-tight">
                  {t('settingsDialog.channelsTitle')}
                </h3>
                <p className="text-[14px] text-foreground/70 mt-1">{t('settingsDialog.channelsDescription')}</p>
              </div>
              <Button
                onClick={() => setShowChannelModal(true)}
                className="h-9 rounded-xl px-4 text-[13px] font-medium shadow-none"
              >
                <Plus className="h-3.5 w-3.5 mr-2" />
                {t('settingsDialog.addChannel')}
              </Button>
            </div>

            {assignedChannels.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/80 bg-muted/35 p-4 text-[13.5px] text-muted-foreground">
                {t('settingsDialog.noChannels')}
              </div>
            ) : (
              <div className="space-y-3">
                {assignedChannels.map((channel) => (
                  <div key={channel.channelType} className="flex items-center justify-between rounded-2xl border border-border/70 bg-muted/35 p-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <ChannelLogo type={channel.channelType} branded />
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-foreground">{channel.name}</p>
                        <p className="text-[13.5px] text-muted-foreground">
                          {CHANNEL_NAMES[channel.channelType]}
                        </p>
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
                        onClick={() => setChannelToRemove(channel.channelType)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {showChannelModal && (
        <ChannelConfigModal
          configuredTypes={agent.channelTypes}
          showChannelName={false}
          allowExistingConfig
          onClose={() => setShowChannelModal(false)}
          onChannelSaved={async (channelType) => {
            await handleChannelSaved(channelType);
            setShowChannelModal(false);
          }}
        />
      )}

      <ConfirmDialog
        open={!!channelToRemove}
        title={t('removeChannelDialog.title')}
        message={channelToRemove ? t('removeChannelDialog.message', { name: CHANNEL_NAMES[channelToRemove] || channelToRemove }) : ''}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!channelToRemove) return;
          try {
            await removeChannel(agent.id, channelToRemove);
            await fetchChannels();
            toast.success(t('toast.channelRemoved', { channel: CHANNEL_NAMES[channelToRemove] || channelToRemove }));
          } catch (error) {
            toast.error(t('toast.channelRemoveFailed', { error: String(error) }));
          } finally {
            setChannelToRemove(null);
          }
        }}
        onCancel={() => setChannelToRemove(null)}
      />
    </div>
  );
}

export default Agents;
