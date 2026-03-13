import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Cpu,
  Eye,
  EyeOff,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { useProviderStore } from '@/stores/providers';
import { trackUiEvent } from '@/lib/telemetry';
import { ProvidersSettings } from '@/components/settings/ProvidersSettings';
import { FeedbackState } from '@/components/common/FeedbackState';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLoader } from '@/components/common/LoadingSpinner';
import { toast } from 'sonner';
import { hostApiFetch } from '@/lib/host-api';
import { type ProviderAccount } from '@/lib/providers';

type UsageHistoryEntry = {
  timestamp: string;
  sessionId: string;
  agentId: string;
  model?: string;
  provider?: string;
  content?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd?: number;
};

type UsageWindow = '7d' | '30d' | 'all';
type UsageGroupBy = 'model' | 'day';

type ProviderModelOption = {
  id: string;
  name: string;
};

type ResolvedProviderModelResponse = {
  runtimeProviderId?: string;
  models: ProviderModelOption[];
  resolved?: boolean;
  source?: string;
  error?: string;
};

function isLocalModelAccount(account: { vendorId: string; metadata?: { localModel?: boolean; managedBy?: string } }): boolean {
  return account.vendorId === 'local-model'
    || (account.vendorId === 'custom' && (account.metadata?.localModel || account.metadata?.managedBy === 'preset-local-model'));
}

function isLocalModelProviderAccount(account: ProviderAccount): boolean {
  return account.vendorId === 'local-model' && account.metadata?.localModelProvider === true;
}

async function resolveLocalProviderModels(payload: {
  accountId: string;
  baseUrl?: string;
  apiProtocol?: ProviderAccount['apiProtocol'];
  apiKey?: string | null;
}): Promise<ResolvedProviderModelResponse> {
  return hostApiFetch<ResolvedProviderModelResponse>('/api/provider-model-options/resolve', {
    method: 'POST',
    body: JSON.stringify({
      vendorId: 'local-model',
      authMode: 'api_key',
      accountId: payload.accountId,
      baseUrl: payload.baseUrl,
      apiProtocol: payload.apiProtocol,
      apiKey: payload.apiKey ?? undefined,
    }),
  });
}

export function Models() {
  const { t } = useTranslation(['dashboard', 'settings']);
  const location = useLocation();
  const navigate = useNavigate();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const {
    accounts,
    defaultAccountId,
    loading: providerLoading,
    refreshProviderSnapshot,
    createAccount,
    updateAccount,
    removeAccount,
    setDefaultAccount,
    getAccountApiKey,
  } = useProviderStore();
  const isGatewayRunning = gatewayStatus.state === 'running';
  const isSetupFlow = useMemo(
    () => new URLSearchParams(location.search).get('fromSetup') === '1',
    [location.search],
  );

  const [usageHistory, setUsageHistory] = useState<UsageHistoryEntry[]>([]);
  const [usageGroupBy, setUsageGroupBy] = useState<UsageGroupBy>('model');
  const [usageWindow, setUsageWindow] = useState<UsageWindow>('7d');
  const [usagePage, setUsagePage] = useState(1);
  const [selectedUsageEntry, setSelectedUsageEntry] = useState<UsageHistoryEntry | null>(null);
  const [showLocalProviderDialog, setShowLocalProviderDialog] = useState(false);
  const [showAddLocalModelDialog, setShowAddLocalModelDialog] = useState(false);

  useEffect(() => {
    trackUiEvent('models.page_viewed');
  }, []);

  useEffect(() => {
    void refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  useEffect(() => {
    if (isGatewayRunning) {
      hostApiFetch<UsageHistoryEntry[]>('/api/usage/recent-token-history')
        .then((entries) => {
          setUsageHistory(Array.isArray(entries) ? entries : []);
          setUsagePage(1);
        })
        .catch(() => {
          setUsageHistory([]);
        });
    }
  }, [isGatewayRunning]);

  const visibleUsageHistory = isGatewayRunning ? usageHistory : [];
  const filteredUsageHistory = filterUsageHistoryByWindow(visibleUsageHistory, usageWindow);
  const usageGroups = groupUsageHistory(filteredUsageHistory, usageGroupBy);
  const usagePageSize = 5;
  const usageTotalPages = Math.max(1, Math.ceil(filteredUsageHistory.length / usagePageSize));
  const safeUsagePage = Math.min(usagePage, usageTotalPages);
  const pagedUsageHistory = filteredUsageHistory.slice((safeUsagePage - 1) * usagePageSize, safeUsagePage * usagePageSize);
  const usageLoading = isGatewayRunning && visibleUsageHistory.length === 0;
  const totalTokensInWindow = filteredUsageHistory.reduce((sum, entry) => sum + entry.totalTokens, 0);
  const totalCostInWindow = filteredUsageHistory.reduce((sum, entry) => sum + (entry.costUsd || 0), 0);

  const localProviderAccount = useMemo(
    () => accounts.find((account) => isLocalModelProviderAccount(account)) ?? null,
    [accounts],
  );
  const localModelAccounts = useMemo(
    () => accounts.filter((account) => isLocalModelAccount(account) && !isLocalModelProviderAccount(account)),
    [accounts],
  );
  const localProviderSeed = useMemo(
    () => localProviderAccount ?? localModelAccounts[0] ?? null,
    [localModelAccounts, localProviderAccount],
  );
  const otherModelAccounts = useMemo(
    () => accounts.filter((account) => !isLocalModelAccount(account)),
    [accounts],
  );
  const hasAnyConfiguredModels = useMemo(
    () => accounts.some((account) => account.enabled && !account.metadata?.localModelProvider && Boolean(account.model?.trim())),
    [accounts],
  );
  const handleDeleteLocalModel = async (accountId: string) => {
    try {
      await removeAccount(accountId);
      toast.success('已删除本地模型');
    } catch (error) {
      toast.error(`删除失败: ${String(error)}`);
    }
  };

  const handleSetDefaultLocalModel = async (accountId: string) => {
    try {
      await setDefaultAccount(accountId);
      toast.success('已设为默认模型');
    } catch (error) {
      toast.error(`设置默认失败: ${String(error)}`);
    }
  };

  const handleSaveLocalProvider = async (payload: {
    accountId?: string;
    apiKey?: string;
    baseUrl: string;
    apiProtocol: ProviderAccount['apiProtocol'];
  }) => {
    const now = new Date().toISOString();
    const providerPatch = {
      label: '本地模型',
      authMode: 'api_key' as const,
      baseUrl: payload.baseUrl.trim(),
      apiProtocol: payload.apiProtocol,
      enabled: true,
      metadata: {
        localModelProvider: true,
      },
      updatedAt: now,
    };

    if (payload.accountId) {
      await updateAccount(payload.accountId, providerPatch, payload.apiKey?.trim() || undefined);
      for (const modelAccount of localModelAccounts) {
        await updateAccount(modelAccount.id, {
          baseUrl: payload.baseUrl.trim(),
          apiProtocol: payload.apiProtocol,
          updatedAt: now,
        }, payload.apiKey?.trim() || undefined);
      }
      return;
    }

    await createAccount({
      id: `local-model-provider-${crypto.randomUUID()}`,
      vendorId: 'local-model',
      label: '本地模型',
      authMode: 'api_key',
      baseUrl: payload.baseUrl.trim(),
      apiProtocol: payload.apiProtocol,
      enabled: true,
      isDefault: false,
      metadata: {
        localModelProvider: true,
      },
      createdAt: now,
      updatedAt: now,
    }, payload.apiKey?.trim() || undefined);
  };

  const handleAddLocalModel = async (payload: { modelId: string; label: string }) => {
    if (!localProviderAccount) {
      throw new Error('请先配置本地模型提供商');
    }
    const trimmedModelId = payload.modelId.trim();
    const trimmedLabel = payload.label.trim();
    if (!trimmedModelId || !trimmedLabel) {
      throw new Error('请填写完整的模型信息');
    }
    const duplicate = localModelAccounts.find((account) => account.model?.trim() === trimmedModelId);
    if (duplicate) {
      throw new Error('该本地模型已经添加过了');
    }
    const apiKey = await getAccountApiKey(localProviderAccount.id);
    const now = new Date().toISOString();
    await createAccount({
      id: `local-model-${crypto.randomUUID()}`,
      vendorId: 'local-model',
      label: trimmedLabel,
      authMode: 'api_key',
      baseUrl: localProviderAccount.baseUrl,
      apiProtocol: localProviderAccount.apiProtocol || 'openai-completions',
      model: trimmedModelId,
      enabled: true,
      isDefault: false,
      metadata: {
        localModel: true,
      },
      createdAt: now,
      updatedAt: now,
    }, apiKey || undefined);
  };

  return (
    <div className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-5 pb-8 pt-10 sm:px-6 lg:px-8 lg:pt-12">
        <PageHeader
          title={t('dashboard:models.title')}
          subtitle={t('dashboard:models.subtitle')}
          description={t('dashboard:models.description')}
        />

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-1 pb-10">
          {isSetupFlow ? (
            <section className="rounded-[10px] border border-blue-500/15 bg-blue-500/[0.04] p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-foreground">
                    {hasAnyConfiguredModels ? '模型已配置完成' : '完成模型配置后即可继续'}
                  </h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {hasAnyConfiguredModels
                      ? '当前已经检测到可用模型。继续后将完成安装并进入聊天主页。'
                      : '请至少添加一个可用模型。你也可以稍后返回 Setup 跳过这一步。'}
                  </p>
                </div>
                {hasAnyConfiguredModels ? (
                  <Button
                    className="h-9 rounded-xl px-4"
                    onClick={() => navigate('/setup?step=complete')}
                  >
                    完成设置
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="rounded-[10px] border border-black/10 bg-[rgba(255,255,255,0.3)] p-4 dark:border-white/10 dark:bg-white/[0.03] sm:p-5">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">本地模型</h2>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  先配置本地模型提供商，再添加具体模型。默认模型会直接标记在具体模型上。
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                <Button
                  variant="outline"
                  className="h-9 rounded-xl border-black/10 bg-transparent px-4 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                  onClick={() => setShowLocalProviderDialog(true)}
                >
                  配置
                </Button>
                {localProviderAccount ? (
                  <Button
                    className="h-9 rounded-xl px-4"
                    onClick={() => setShowAddLocalModelDialog(true)}
                  >
                    添加模型
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="mb-4 rounded-[10px] border border-black/10 bg-black/[0.025] p-4 dark:border-white/10 dark:bg-white/[0.02]">
              {localProviderAccount ? (
                <div className="text-sm text-muted-foreground">
                  已配置本地模型提供商。需要调整 API Key、Base URL 或协议时，使用右上角“配置”。
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  还没有配置本地模型提供商。先完成提供商配置，再添加模型。
                </div>
              )}
            </div>

            {providerLoading ? (
              <div className="flex items-center justify-center rounded-[10px] border border-dashed border-border/80 bg-muted/35 py-12 text-muted-foreground">
                <PageLoader
                  compact
                  title="正在加载本地模型"
                  description="正在同步当前配置，请稍候。"
                  className="w-full py-0"
                />
              </div>
            ) : localModelAccounts.length === 0 && !localProviderAccount ? (
              <div className="rounded-[10px] border border-dashed border-border/80 bg-muted/35 px-5 py-8 text-sm text-muted-foreground">
                配置本地模型提供商后，这里会显示该提供商下的模型。
              </div>
            ) : localModelAccounts.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-border/80 bg-muted/35 px-5 py-8 text-sm text-muted-foreground">
                还没有添加本地模型。点击右上角“添加模型”。
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {localModelAccounts.map((account) => {
                  const isDefault = account.id === defaultAccountId;
                  return (
                    <div
                      key={account.id}
                      className="rounded-[10px] border border-black/10 bg-black/[0.025] p-4 text-left dark:border-white/10 dark:bg-white/[0.02]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-blue-500/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
                              <Cpu className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className="truncate text-[18px] font-semibold tracking-tight text-foreground">{account.label}</h3>
                                {isDefault ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-green-500/12 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-400/10 dark:text-green-200">
                                    <Star className="h-3 w-3" />
                                    默认
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-1 text-[13px] text-muted-foreground">{account.model || '未填写模型 ID'}</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {!isDefault ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-[10px] border-black/10 bg-transparent px-3 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                              onClick={() => void handleSetDefaultLocalModel(account.id)}
                            >
                              设为默认
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-[10px] text-muted-foreground hover:bg-black/5 hover:text-red-500 dark:hover:bg-white/5"
                            onClick={() => void handleDeleteLocalModel(account.id)}
                            aria-label="删除本地模型"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-[10px] border border-black/10 bg-[rgba(255,255,255,0.3)] p-4 dark:border-white/10 dark:bg-white/[0.03] sm:p-5">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                  模型提供商
                </h2>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  手动管理云端模型来源，以及额外添加的自定义兼容端点。
                </p>
              </div>
              <div className="shrink-0">
                <ProvidersSettings actionOnly />
              </div>
            </div>
            {otherModelAccounts.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-border/80 bg-muted/35 px-5 py-8 text-sm text-muted-foreground">
                目前没有额外的模型提供商。需要时可以添加 OpenAI、OpenRouter 或自定义兼容端点。
              </div>
            ) : (
              <ProvidersSettings embedded hideHeader autoOpenOnEmpty />
            )}
          </section>

          <section className="rounded-[10px] border border-black/10 bg-[rgba(255,255,255,0.3)] p-4 dark:border-white/10 dark:bg-white/[0.03] sm:p-5">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                  {t('dashboard:recentTokenHistory.title', 'Token Usage History')}
                </h2>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {t('dashboard:recentTokenHistory.description')}
                </p>
              </div>
            </div>
            <div className="mb-5 grid grid-cols-2 gap-2.5 lg:max-w-[410px] lg:grid-cols-3">
              <div className="rounded-[10px] border border-black/8 bg-black/[0.03] px-4 py-3 dark:border-white/8 dark:bg-white/[0.04]">
                <div className="text-[11px] uppercase tracking-[0.16em] text-foreground/45">{t('dashboard:models.stats.records')}</div>
                <div className="mt-1 text-[23px] font-semibold tracking-tight text-foreground">{filteredUsageHistory.length}</div>
              </div>
              <div className="rounded-[10px] border border-black/8 bg-black/[0.03] px-4 py-3 dark:border-white/8 dark:bg-white/[0.04]">
                <div className="text-[11px] uppercase tracking-[0.16em] text-foreground/45">{t('dashboard:models.stats.tokens')}</div>
                <div className="mt-1 text-[23px] font-semibold tracking-tight text-foreground">{formatCompactTokenCount(totalTokensInWindow)}</div>
              </div>
              <div className="rounded-[10px] border border-black/8 bg-black/[0.03] px-4 py-3 dark:border-white/8 dark:bg-white/[0.04]">
                <div className="text-[11px] uppercase tracking-[0.16em] text-foreground/45">{t('dashboard:models.stats.cost')}</div>
                <div className="mt-1 text-[23px] font-semibold tracking-tight text-foreground">${totalCostInWindow.toFixed(2)}</div>
              </div>
            </div>
            <div>
              {usageLoading ? (
                <div className="flex items-center justify-center rounded-[10px] border border-dashed border-border/80 bg-muted/35 py-12 text-muted-foreground">
                  <PageLoader
                    compact
                    title={t('dashboard:recentTokenHistory.loading')}
                    description={t('dashboard:models.loadingDescription', '正在同步模型和用量记录，请稍候。')}
                    className="w-full py-0"
                  />
                </div>
              ) : visibleUsageHistory.length === 0 ? (
                <div className="flex items-center justify-center rounded-[10px] border border-dashed border-border/80 bg-muted/35 py-12 text-muted-foreground">
                  <FeedbackState state="empty" title={t('dashboard:recentTokenHistory.empty')} />
                </div>
              ) : filteredUsageHistory.length === 0 ? (
                <div className="flex items-center justify-center rounded-[10px] border border-dashed border-border/80 bg-muted/35 py-12 text-muted-foreground">
                  <FeedbackState state="empty" title={t('dashboard:recentTokenHistory.emptyForWindow')} />
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex flex-col gap-3 rounded-[10px] border border-black/10 bg-black/[0.025] p-3 dark:border-white/10 dark:bg-white/[0.02] lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                      <div className="flex rounded-[10px] bg-transparent p-1 border border-black/10 dark:border-white/10">
                        <Button variant={usageGroupBy === 'model' ? 'secondary' : 'ghost'} size="sm" onClick={() => { setUsageGroupBy('model'); setUsagePage(1); }} className={usageGroupBy === 'model' ? 'rounded-[10px] bg-black/5 dark:bg-white/10 text-foreground' : 'rounded-[10px] text-muted-foreground'}>
                          {t('dashboard:recentTokenHistory.groupByModel')}
                        </Button>
                        <Button variant={usageGroupBy === 'day' ? 'secondary' : 'ghost'} size="sm" onClick={() => { setUsageGroupBy('day'); setUsagePage(1); }} className={usageGroupBy === 'day' ? 'rounded-[10px] bg-black/5 dark:bg-white/10 text-foreground' : 'rounded-[10px] text-muted-foreground'}>
                          {t('dashboard:recentTokenHistory.groupByTime')}
                        </Button>
                      </div>
                      <div className="flex rounded-[10px] bg-transparent p-1 border border-black/10 dark:border-white/10">
                        <Button variant={usageWindow === '7d' ? 'secondary' : 'ghost'} size="sm" onClick={() => { setUsageWindow('7d'); setUsagePage(1); }} className={usageWindow === '7d' ? 'rounded-[10px] bg-black/5 dark:bg-white/10 text-foreground' : 'rounded-[10px] text-muted-foreground'}>
                          {t('dashboard:recentTokenHistory.last7Days')}
                        </Button>
                        <Button variant={usageWindow === '30d' ? 'secondary' : 'ghost'} size="sm" onClick={() => { setUsageWindow('30d'); setUsagePage(1); }} className={usageWindow === '30d' ? 'rounded-[10px] bg-black/5 dark:bg-white/10 text-foreground' : 'rounded-[10px] text-muted-foreground'}>
                          {t('dashboard:recentTokenHistory.last30Days')}
                        </Button>
                        <Button variant={usageWindow === 'all' ? 'secondary' : 'ghost'} size="sm" onClick={() => { setUsageWindow('all'); setUsagePage(1); }} className={usageWindow === 'all' ? 'rounded-[10px] bg-black/5 dark:bg-white/10 text-foreground' : 'rounded-[10px] text-muted-foreground'}>
                          {t('dashboard:recentTokenHistory.allTime')}
                        </Button>
                      </div>
                    </div>
                    <p className="text-[13px] font-medium text-muted-foreground">
                      {t('dashboard:recentTokenHistory.showingLast', { count: filteredUsageHistory.length })}
                    </p>
                  </div>

                  <UsageBarChart
                    groups={usageGroups}
                    emptyLabel={t('dashboard:recentTokenHistory.empty')}
                    totalLabel={t('dashboard:recentTokenHistory.totalTokens')}
                    inputLabel={t('dashboard:recentTokenHistory.inputShort')}
                    outputLabel={t('dashboard:recentTokenHistory.outputShort')}
                    cacheLabel={t('dashboard:recentTokenHistory.cacheShort')}
                  />

                  <div className="space-y-3 pt-2">
                    {pagedUsageHistory.map((entry) => (
                      <div
                        key={`${entry.sessionId}-${entry.timestamp}`}
                        className="rounded-[10px] border border-black/10 bg-transparent p-5 transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-[15px] text-foreground truncate">
                              {entry.model || t('dashboard:recentTokenHistory.unknownModel')}
                            </p>
                            <p className="text-[13px] text-muted-foreground truncate mt-0.5">
                              {[entry.provider, entry.agentId, entry.sessionId].filter(Boolean).join(' • ')}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-bold text-[15px]">{formatTokenCount(entry.totalTokens)}</p>
                            <p className="text-[12px] text-muted-foreground mt-0.5">
                              {formatUsageTimestamp(entry.timestamp)}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] font-medium text-muted-foreground">
                          <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-sky-500" />{t('dashboard:recentTokenHistory.input', { value: formatTokenCount(entry.inputTokens) })}</span>
                          <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-violet-500" />{t('dashboard:recentTokenHistory.output', { value: formatTokenCount(entry.outputTokens) })}</span>
                          {entry.cacheReadTokens > 0 && (
                            <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-500" />{t('dashboard:recentTokenHistory.cacheRead', { value: formatTokenCount(entry.cacheReadTokens) })}</span>
                          )}
                          {entry.cacheWriteTokens > 0 && (
                            <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-500" />{t('dashboard:recentTokenHistory.cacheWrite', { value: formatTokenCount(entry.cacheWriteTokens) })}</span>
                          )}
                          {typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) && (
                            <span className="ml-auto flex items-center gap-1.5 rounded-[10px] bg-black/5 px-2 py-0.5 text-foreground/80 dark:bg-white/5">{t('dashboard:recentTokenHistory.cost', { amount: entry.costUsd.toFixed(4) })}</span>
                          )}
                          {devModeUnlocked && entry.content && (
                            <Button variant="outline" size="sm" className="h-6 rounded-[10px] border-black/10 px-2.5 text-[11.5px] dark:border-white/10" onClick={() => setSelectedUsageEntry(entry)}>
                              {t('dashboard:recentTokenHistory.viewContent')}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2">
                    <p className="text-[13px] font-medium text-muted-foreground">
                      {t('dashboard:recentTokenHistory.page', { current: safeUsagePage, total: usageTotalPages })}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setUsagePage((page) => Math.max(1, page - 1))} disabled={safeUsagePage <= 1} className="h-9 rounded-[10px] border-black/10 bg-transparent px-4 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5">
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        {t('dashboard:recentTokenHistory.prev')}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setUsagePage((page) => Math.min(usageTotalPages, page + 1))} disabled={safeUsagePage >= usageTotalPages} className="h-9 rounded-[10px] border-black/10 bg-transparent px-4 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5">
                        {t('dashboard:recentTokenHistory.next')}
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
      {devModeUnlocked && selectedUsageEntry && (
        <UsageContentPopup
          entry={selectedUsageEntry}
          onClose={() => setSelectedUsageEntry(null)}
          title={t('dashboard:recentTokenHistory.contentDialogTitle')}
          closeLabel={t('dashboard:recentTokenHistory.close')}
          unknownModelLabel={t('dashboard:recentTokenHistory.unknownModel')}
        />
      )}
      {showLocalProviderDialog ? (
        <LocalProviderConfigDialog
          account={localProviderSeed}
          onClose={() => setShowLocalProviderDialog(false)}
          onSave={async (payload) => {
            await handleSaveLocalProvider(payload);
            setShowLocalProviderDialog(false);
            toast.success(localProviderAccount ? '本地模型提供商已更新' : '本地模型提供商已配置');
          }}
        />
      ) : null}
      {showAddLocalModelDialog && localProviderAccount ? (
        <AddLocalModelDialog
          providerAccount={localProviderAccount}
          existingModels={localModelAccounts}
          getAccountApiKey={getAccountApiKey}
          onClose={() => setShowAddLocalModelDialog(false)}
          onAdd={async (payload) => {
            await handleAddLocalModel(payload);
            setShowAddLocalModelDialog(false);
            toast.success('本地模型已添加');
          }}
        />
      ) : null}
    </div>
  );
}

function formatTokenCount(value: number): string {
  return Intl.NumberFormat().format(value);
}

function formatCompactTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return Intl.NumberFormat().format(value);
}

function formatUsageTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function groupUsageHistory(
  entries: UsageHistoryEntry[],
  groupBy: UsageGroupBy,
): Array<{
  label: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  sortKey: number | string;
}> {
  const grouped = new Map<string, {
    label: string;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    sortKey: number | string;
  }>();

  for (const entry of entries) {
    const label = groupBy === 'model'
      ? (entry.model || 'Unknown')
      : formatUsageDay(entry.timestamp);
    const current = grouped.get(label) ?? {
      label,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      sortKey: groupBy === 'day' ? getUsageDaySortKey(entry.timestamp) : label.toLowerCase(),
    };
    current.totalTokens += entry.totalTokens;
    current.inputTokens += entry.inputTokens;
    current.outputTokens += entry.outputTokens;
    current.cacheTokens += entry.cacheReadTokens + entry.cacheWriteTokens;
    grouped.set(label, current);
  }

  return Array.from(grouped.values())
    .sort((a, b) => {
      if (groupBy === 'day') {
        return Number(a.sortKey) - Number(b.sortKey);
      }
      return b.totalTokens - a.totalTokens;
    })
    .slice(0, 8);
}

function formatUsageDay(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function getUsageDaySortKey(timestamp: string): number {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 0;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function filterUsageHistoryByWindow(entries: UsageHistoryEntry[], window: UsageWindow): UsageHistoryEntry[] {
  if (window === 'all') return entries;

  const now = Date.now();
  const days = window === '7d' ? 7 : 30;
  const cutoff = now - days * 24 * 60 * 60 * 1000;

  return entries.filter((entry) => {
    const timestamp = Date.parse(entry.timestamp);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
}

function UsageBarChart({
  groups,
  emptyLabel,
  totalLabel,
  inputLabel,
  outputLabel,
  cacheLabel,
}: {
  groups: Array<{
    label: string;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
  }>;
  emptyLabel: string;
  totalLabel: string;
  inputLabel: string;
  outputLabel: string;
  cacheLabel: string;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/80 bg-muted/35 p-8 text-center text-[14px] font-medium text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  const maxTokens = Math.max(...groups.map((group) => group.totalTokens), 1);

  return (
    <div className="space-y-4 bg-transparent p-5 rounded-2xl border border-black/10 dark:border-white/10">
      <div className="flex flex-wrap gap-4 text-[13px] font-medium text-muted-foreground mb-2">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
          {inputLabel}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
          {outputLabel}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          {cacheLabel}
        </span>
      </div>
      {groups.map((group) => (
        <div key={group.label} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-[13.5px]">
            <span className="truncate font-semibold text-foreground">{group.label}</span>
            <span className="text-muted-foreground font-medium">
              {totalLabel}: {formatTokenCount(group.totalTokens)}
            </span>
          </div>
          <div className="h-3.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/5">
            <div
              className="flex h-full overflow-hidden rounded-full"
              style={{
                width: group.totalTokens > 0
                  ? `${Math.max((group.totalTokens / maxTokens) * 100, 6)}%`
                  : '0%',
              }}
            >
              {group.inputTokens > 0 && (
                <div className="h-full bg-sky-500" style={{ width: `${(group.inputTokens / group.totalTokens) * 100}%` }} />
              )}
              {group.outputTokens > 0 && (
                <div className="h-full bg-violet-500" style={{ width: `${(group.outputTokens / group.totalTokens) * 100}%` }} />
              )}
              {group.cacheTokens > 0 && (
                <div className="h-full bg-amber-500" style={{ width: `${(group.cacheTokens / group.totalTokens) * 100}%` }} />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default Models;

function LocalProviderConfigDialog({
  account,
  onClose,
  onSave,
}: {
  account: ProviderAccount | null;
  onClose: () => void;
  onSave: (payload: { accountId?: string; apiKey?: string; baseUrl: string; apiProtocol: ProviderAccount['apiProtocol'] }) => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(account?.baseUrl || '');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>(account?.apiProtocol || 'openai-completions');
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const isEditing = Boolean(account?.metadata?.localModelProvider);

  const handleSubmit = async () => {
    if (!baseUrl.trim()) {
      toast.error('请填写 Base URL');
      return;
    }
    if (!isEditing && !apiKey.trim()) {
      toast.error('请填写 API Key');
      return;
    }
    try {
      setSaving(true);
      await onSave({
        accountId: account?.metadata?.localModelProvider ? account.id : undefined,
        apiKey,
        baseUrl,
        apiProtocol,
      });
    } catch (error) {
      toast.error(`保存失败: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-2xl border border-black/10 bg-background shadow-xl dark:border-white/10">
        <div className="flex items-start justify-between gap-3 border-b border-black/10 px-5 py-4 dark:border-white/10">
          <div>
            <p className="text-2xl font-semibold tracking-tight text-foreground">配置本地模型提供商</p>
            <p className="mt-1 text-sm text-muted-foreground">
              填写 API Key、Base URL 和接口协议。配置成功后，就可以在这个提供商下添加模型。
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9 rounded-xl">
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="space-y-5 px-5 py-5">
          <div className="space-y-2">
            <Label htmlFor="local-provider-api-key">API Key</Label>
            <div className="relative">
              <Input
                id="local-provider-api-key"
                type={showApiKey ? 'text' : 'password'}
                className="h-12 rounded-xl pr-12 font-mono"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={isEditing ? '留空表示保留当前 API Key' : 'sk-...'}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-3 inline-flex items-center text-muted-foreground"
                onClick={() => setShowApiKey((value) => !value)}
                aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
              >
                {showApiKey ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="local-provider-base-url">Base URL</Label>
            <Input
              id="local-provider-base-url"
              className="h-12 rounded-xl font-mono"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://your-local-model-gateway/v1"
            />
          </div>
          <div className="space-y-2">
            <Label>接口协议</Label>
            <div className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                variant={apiProtocol === 'openai-completions' ? 'default' : 'outline'}
                className="h-11 rounded-xl"
                onClick={() => setApiProtocol('openai-completions')}
              >
                OpenAI 兼容
              </Button>
              <Button
                type="button"
                variant={apiProtocol === 'anthropic-messages' ? 'default' : 'outline'}
                className="h-11 rounded-xl"
                onClick={() => setApiProtocol('anthropic-messages')}
              >
                Anthropic 兼容
              </Button>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-black/10 px-5 py-4 dark:border-white/10">
          <Button variant="outline" onClick={onClose} className="h-10 rounded-xl px-5">
            取消
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving} className="h-10 rounded-xl px-5">
            {saving ? '保存中...' : '保存配置'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddLocalModelDialog({
  providerAccount,
  existingModels,
  getAccountApiKey,
  onClose,
  onAdd,
}: {
  providerAccount: ProviderAccount;
  existingModels: ProviderAccount[];
  getAccountApiKey: (accountId: string) => Promise<string | null>;
  onClose: () => void;
  onAdd: (payload: { modelId: string; label: string }) => Promise<void>;
}) {
  const [loadingModels, setLoadingModels] = useState(true);
  const [modelOptions, setModelOptions] = useState<ProviderModelOption[]>([]);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [manualModelId, setManualModelId] = useState('');
  const [label, setLabel] = useState('');
  const [labelDirty, setLabelDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        setLoadingModels(true);
        setResolveError(null);
        const apiKey = await getAccountApiKey(providerAccount.id);
        const result = await resolveLocalProviderModels({
          accountId: providerAccount.id,
          baseUrl: providerAccount.baseUrl,
          apiProtocol: providerAccount.apiProtocol,
          apiKey,
        });
        if (cancelled) {
          return;
        }
        const availableModels = Array.isArray(result.models) ? result.models : [];
        const filteredModels = availableModels.filter((option) => (
          !existingModels.some((account) => account.model?.trim() === option.id.trim())
        ));
        setModelOptions(filteredModels);
        if (filteredModels[0]?.id) {
          setSelectedModelId(filteredModels[0].id);
          if (!labelDirty) {
            setLabel(filteredModels[0].name || filteredModels[0].id);
          }
        }
        if (result.error) {
          setResolveError(result.error);
        }
      } catch (error) {
        if (!cancelled) {
          setResolveError(String(error));
        }
      } finally {
        if (!cancelled) {
          setLoadingModels(false);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [existingModels, getAccountApiKey, labelDirty, providerAccount.apiProtocol, providerAccount.baseUrl, providerAccount.id]);

  const usingResolvedModels = modelOptions.length > 0;
  const effectiveModelId = usingResolvedModels ? selectedModelId.trim() : manualModelId.trim();

  const handleSubmit = async () => {
    if (!label.trim()) {
      toast.error('请填写模型名称');
      return;
    }
    if (!effectiveModelId) {
      toast.error('请填写模型 ID');
      return;
    }
    try {
      setSaving(true);
      await onAdd({
        label,
        modelId: effectiveModelId,
      });
    } catch (error) {
      toast.error(`添加失败: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-2xl border border-black/10 bg-background shadow-xl dark:border-white/10">
        <div className="flex items-start justify-between gap-3 border-b border-black/10 px-5 py-4 dark:border-white/10">
          <div>
            <p className="text-2xl font-semibold tracking-tight text-foreground">添加本地模型</p>
            <p className="mt-1 text-sm text-muted-foreground">
              优先从已配置的本地模型提供商拉取模型列表；如果服务不支持列出模型，再手动填写模型 ID。
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9 rounded-xl">
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="space-y-5 px-5 py-5">
          <div className="space-y-2">
            <Label htmlFor="local-model-label">模型名称</Label>
            <Input
              id="local-model-label"
              className="h-12 rounded-xl"
              value={label}
              onChange={(event) => {
                setLabelDirty(true);
                setLabel(event.target.value);
              }}
              placeholder="例如：Qwen3.5-27B"
            />
          </div>

          {loadingModels ? (
            <div className="rounded-[10px] border border-dashed border-border/80 bg-muted/35 px-5 py-8 text-sm text-muted-foreground">
              正在获取模型列表...
            </div>
          ) : usingResolvedModels ? (
            <div className="space-y-2">
              <Label htmlFor="local-model-select">可用模型</Label>
              <select
                id="local-model-select"
                className="h-12 w-full rounded-xl border border-input bg-background px-3 text-sm"
                value={selectedModelId}
                onChange={(event) => {
                  const nextModelId = event.target.value;
                  setSelectedModelId(nextModelId);
                  if (!labelDirty) {
                    const selected = modelOptions.find((option) => option.id === nextModelId);
                    setLabel(selected?.name || nextModelId);
                  }
                }}
              >
                {modelOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name || option.id}
                  </option>
                ))}
              </select>
              <p className="text-sm text-muted-foreground">已从当前本地模型提供商读取到 {modelOptions.length} 个模型。</p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="local-model-manual-id">模型 ID</Label>
              <Input
                id="local-model-manual-id"
                className="h-12 rounded-xl font-mono"
                value={manualModelId}
                onChange={(event) => {
                  setManualModelId(event.target.value);
                  if (!labelDirty && !label.trim()) {
                    setLabel(event.target.value);
                  }
                }}
                placeholder="your-provider/model-id"
              />
              <p className="text-sm text-muted-foreground">
                {resolveError ? `未能读取模型列表：${resolveError}` : '当前服务未返回模型列表，请手动填写模型 ID。'}
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-black/10 px-5 py-4 dark:border-white/10">
          <Button variant="outline" onClick={onClose} className="h-10 rounded-xl px-5">
            取消
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving || !label.trim() || !effectiveModelId} className="h-10 rounded-xl px-5">
            {saving ? '添加中...' : '添加模型'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function UsageContentPopup({
  entry,
  onClose,
  title,
  closeLabel,
  unknownModelLabel,
}: {
  entry: UsageHistoryEntry;
  onClose: () => void;
  title: string;
  closeLabel: string;
  unknownModelLabel: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-3xl rounded-2xl border border-black/10 dark:border-white/10 bg-background shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-black/10 dark:border-white/10 px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {(entry.model || unknownModelLabel)} • {formatUsageTimestamp(entry.timestamp)}
            </p>
          </div>
          <Button variant="outline" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
          <pre className="whitespace-pre-wrap break-words text-sm text-foreground font-mono">
            {entry.content}
          </pre>
        </div>
      </div>
    </div>
  );
}
