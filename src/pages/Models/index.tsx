import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  ChevronLeft,
  Cpu,
  ChevronRight,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { useProviderStore } from '@/stores/providers';
import { hostApiFetch } from '@/lib/host-api';
import { trackUiEvent } from '@/lib/telemetry';
import { ProvidersSettings } from '@/components/settings/ProvidersSettings';
import { FeedbackState } from '@/components/common/FeedbackState';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLoader } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';

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
type LocalModelPreset = {
  id: string;
  name: string;
  description?: string;
  modelId: string;
  baseUrl: string;
  apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  capabilities?: string[];
};

export function Models() {
  const { t } = useTranslation(['dashboard', 'settings']);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const {
    accounts,
    defaultAccountId,
    loading: providerLoading,
    refreshProviderSnapshot,
  } = useProviderStore();
  const isGatewayRunning = gatewayStatus.state === 'running';

  const [usageHistory, setUsageHistory] = useState<UsageHistoryEntry[]>([]);
  const [usageGroupBy, setUsageGroupBy] = useState<UsageGroupBy>('model');
  const [usageWindow, setUsageWindow] = useState<UsageWindow>('7d');
  const [usagePage, setUsagePage] = useState(1);
  const [selectedUsageEntry, setSelectedUsageEntry] = useState<UsageHistoryEntry | null>(null);
  const [localModelPresets, setLocalModelPresets] = useState<LocalModelPreset[]>([]);
  const [loadingLocalModelPresets, setLoadingLocalModelPresets] = useState(true);
  const [switchingPresetId, setSwitchingPresetId] = useState<string | null>(null);

  useEffect(() => {
    trackUiEvent('models.page_viewed');
  }, []);

  useEffect(() => {
    void refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  useEffect(() => {
    let cancelled = false;
    setLoadingLocalModelPresets(true);
    hostApiFetch<LocalModelPreset[]>('/api/local-model-presets')
      .then((presets) => {
        if (!cancelled) {
          setLocalModelPresets(Array.isArray(presets) ? presets : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLocalModelPresets([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingLocalModelPresets(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
  const presetLocalAccounts = useMemo(
    () => accounts.filter((account) => account.vendorId === 'custom' && account.metadata?.managedBy === 'preset-local-model'),
    [accounts],
  );
  const localModelCards = useMemo(
    () => localModelPresets.map((preset, index) => {
      const account = presetLocalAccounts[0];
      const currentPrimaryPresetId = account?.metadata?.primaryPresetId || account?.metadata?.presetId;
      return {
        preset,
        account,
        isDefault:
          account?.id === defaultAccountId
          && (
            currentPrimaryPresetId
              ? currentPrimaryPresetId === preset.id
              : account?.model === preset.modelId
          ),
        isRecommended: index === 0,
      };
    }),
    [defaultAccountId, localModelPresets, presetLocalAccounts],
  );
  const otherModelAccounts = useMemo(
    () => accounts.filter((account) => !(account.vendorId === 'custom' && account.metadata?.managedBy === 'preset-local-model')),
    [accounts],
  );

  const handleSetDefaultPreset = async (presetId: string) => {
    setSwitchingPresetId(presetId);
    try {
      await hostApiFetch(`/api/local-model-presets/${encodeURIComponent(presetId)}/activate`, {
        method: 'POST',
      });
      await refreshProviderSnapshot();
    } finally {
      setSwitchingPresetId(null);
    }
  };

  return (
    <div className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-5 pb-8 pt-10 sm:px-6 lg:px-8 lg:pt-12">
        <PageHeader
          title={t('dashboard:models.title')}
          subtitle={t('dashboard:models.subtitle')}
          description={t('dashboard:models.description')}
          actions={(
            <div className="grid grid-cols-2 gap-2.5 lg:max-w-[410px] lg:grid-cols-3 xl:min-w-[410px]">
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
          )}
        />

        {/* Content Area */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-1 pb-10">
          {localModelPresets.length > 0 && (
            <section className="rounded-[10px] border border-black/10 bg-[rgba(255,255,255,0.3)] p-4 dark:border-white/10 dark:bg-white/[0.03] sm:p-5">
              <div className="mb-5">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-foreground">本地模型</h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    预装模型会在启动时自动写入 OpenClaw 并立即可用。若存在多个预装模型，第一个会自动设为默认模型。
                  </p>
                </div>
              </div>

              {loadingLocalModelPresets || providerLoading ? (
                <div className="flex items-center justify-center rounded-[10px] border border-dashed border-border/80 bg-muted/35 py-12 text-muted-foreground">
                  <PageLoader
                    compact
                    title="正在加载本地模型"
                    description="正在同步预装模型和当前配置，请稍候。"
                    className="w-full py-0"
                  />
                </div>
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                  {localModelCards.map(({ preset, account, isDefault, isRecommended }) => (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={isDefault || !account || switchingPresetId === preset.id}
                      onClick={() => {
                        if (!isDefault && account) {
                          void handleSetDefaultPreset(preset.id);
                        }
                      }}
                      className={cn(
                        'w-full rounded-[10px] border border-black/10 bg-black/[0.025] p-4 text-left transition-colors dark:border-white/10 dark:bg-white/[0.02]',
                        !isDefault && account && 'hover:border-blue-300 hover:bg-blue-50/40 dark:hover:border-blue-500/30 dark:hover:bg-blue-500/5',
                        (isDefault || !account) && 'cursor-default',
                        switchingPresetId === preset.id && 'opacity-70',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-blue-500/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
                              <Cpu className="h-5 w-5" />
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-[18px] font-semibold tracking-tight text-foreground">{preset.name}</h3>
                                {isRecommended && (
                                  <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-400/10 dark:text-amber-200">
                                    推荐
                                  </span>
                                )}
                                {isDefault && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-green-500/12 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-400/10 dark:text-green-200">
                                    <CheckCircle2 className="h-3 w-3" />
                                    默认
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 text-[13px] text-muted-foreground">{preset.description}</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {(preset.capabilities ?? []).map((capability) => (
                          <span
                            key={capability}
                            className="rounded-full border border-black/8 bg-white/60 px-2.5 py-1 text-[11px] font-medium text-foreground/75 dark:border-white/8 dark:bg-white/[0.05]"
                          >
                            {capability}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          
          {/* AI Providers Section */}
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

          {/* Token Usage History Section */}
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
                        <Button
                          variant={usageGroupBy === 'model' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageGroupBy('model');
                            setUsagePage(1);
                          }}
                          className={usageGroupBy === 'model' ? "rounded-[10px] bg-black/5 dark:bg-white/10 text-foreground" : "rounded-[10px] text-muted-foreground"}
                        >
                          {t('dashboard:recentTokenHistory.groupByModel')}
                        </Button>
                        <Button
                          variant={usageGroupBy === 'day' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageGroupBy('day');
                            setUsagePage(1);
                          }}
                          className={usageGroupBy === 'day' ? "rounded-[10px] bg-black/5 dark:bg-white/10 text-foreground" : "rounded-[10px] text-muted-foreground"}
                        >
                          {t('dashboard:recentTokenHistory.groupByTime')}
                        </Button>
                      </div>
                      <div className="flex rounded-[10px] bg-transparent p-1 border border-black/10 dark:border-white/10">
                        <Button
                          variant={usageWindow === '7d' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageWindow('7d');
                            setUsagePage(1);
                          }}
                          className={usageWindow === '7d' ? "rounded-[10px] bg-black/5 dark:bg-white/10 text-foreground" : "rounded-[10px] text-muted-foreground"}
                        >
                          {t('dashboard:recentTokenHistory.last7Days')}
                        </Button>
                        <Button
                          variant={usageWindow === '30d' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageWindow('30d');
                            setUsagePage(1);
                          }}
                          className={usageWindow === '30d' ? "rounded-[10px] bg-black/5 dark:bg-white/10 text-foreground" : "rounded-[10px] text-muted-foreground"}
                        >
                          {t('dashboard:recentTokenHistory.last30Days')}
                        </Button>
                        <Button
                          variant={usageWindow === 'all' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageWindow('all');
                            setUsagePage(1);
                          }}
                          className={usageWindow === 'all' ? "rounded-[10px] bg-black/5 dark:bg-white/10 text-foreground" : "rounded-[10px] text-muted-foreground"}
                        >
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
                          <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-sky-500"></div>{t('dashboard:recentTokenHistory.input', { value: formatTokenCount(entry.inputTokens) })}</span>
                          <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-violet-500"></div>{t('dashboard:recentTokenHistory.output', { value: formatTokenCount(entry.outputTokens) })}</span>
                          {entry.cacheReadTokens > 0 && (
                            <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-500"></div>{t('dashboard:recentTokenHistory.cacheRead', { value: formatTokenCount(entry.cacheReadTokens) })}</span>
                          )}
                          {entry.cacheWriteTokens > 0 && (
                            <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-500"></div>{t('dashboard:recentTokenHistory.cacheWrite', { value: formatTokenCount(entry.cacheWriteTokens) })}</span>
                          )}
                          {typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) && (
                            <span className="ml-auto flex items-center gap-1.5 rounded-[10px] bg-black/5 px-2 py-0.5 text-foreground/80 dark:bg-white/5">{t('dashboard:recentTokenHistory.cost', { amount: entry.costUsd.toFixed(4) })}</span>
                          )}
                          {devModeUnlocked && entry.content && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 rounded-[10px] border-black/10 px-2.5 text-[11.5px] dark:border-white/10"
                              onClick={() => setSelectedUsageEntry(entry)}
                            >
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setUsagePage((page) => Math.max(1, page - 1))}
                        disabled={safeUsagePage <= 1}
                        className="h-9 rounded-[10px] border-black/10 bg-transparent px-4 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        {t('dashboard:recentTokenHistory.prev')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setUsagePage((page) => Math.min(usageTotalPages, page + 1))}
                        disabled={safeUsagePage >= usageTotalPages}
                        className="h-9 rounded-[10px] border-black/10 bg-transparent px-4 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                      >
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
                <div
                  className="h-full bg-sky-500"
                  style={{ width: `${(group.inputTokens / group.totalTokens) * 100}%` }}
                />
              )}
              {group.outputTokens > 0 && (
                <div
                  className="h-full bg-violet-500"
                  style={{ width: `${(group.outputTokens / group.totalTokens) * 100}%` }}
                />
              )}
              {group.cacheTokens > 0 && (
                <div
                  className="h-full bg-amber-500"
                  style={{ width: `${(group.cacheTokens / group.totalTokens) * 100}%` }}
                />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default Models;

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
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
          <pre className="whitespace-pre-wrap break-words text-sm text-foreground font-mono">
            {entry.content}
          </pre>
        </div>
        <div className="flex justify-end border-t border-black/10 dark:border-white/10 px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
