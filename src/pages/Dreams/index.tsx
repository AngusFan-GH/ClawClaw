import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, BookOpen, ExternalLink, Loader2, Moon, RefreshCw, Sparkles, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc, toUserMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';

type DreamPhaseName = 'light' | 'rem' | 'deep';
type DreamActionKey = 'backfill' | 'dedupe' | 'repair' | 'resetDiary' | 'resetGrounded';

interface DreamPhase {
  enabled?: boolean;
  cron?: string;
  managedCronPresent?: boolean;
  nextRunAtMs?: number;
}

interface DreamMemoryEntry {
  key?: string;
  path?: string;
  snippet?: string;
  promotedAt?: string;
  lastRecalledAt?: string;
}

interface DreamingStatus {
  enabled?: boolean;
  timezone?: string;
  storageMode?: string;
  shortTermCount?: number;
  groundedSignalCount?: number;
  totalSignalCount?: number;
  promotedToday?: number;
  storeError?: string;
  phaseSignalError?: string;
  shortTermEntries?: DreamMemoryEntry[];
  promotedEntries?: DreamMemoryEntry[];
  phases?: Partial<Record<DreamPhaseName, DreamPhase>>;
}

interface DreamDiaryResponse {
  path?: string;
  found?: boolean;
  content?: string;
}

interface DreamDiaryEntry {
  id: string;
  date: string;
  summary: string;
}

interface PendingConfirmation {
  action: DreamActionKey;
  title: string;
  message: string;
  destructive?: boolean;
}

const DIARY_START_MARKER = '<!-- openclaw:dreaming:diary:start -->';
const DIARY_END_MARKER = '<!-- openclaw:dreaming:diary:end -->';

const DREAM_ACTION_METHODS: Record<DreamActionKey, string> = {
  backfill: 'doctor.memory.backfillDreamDiary',
  dedupe: 'doctor.memory.dedupeDreamDiary',
  repair: 'doctor.memory.repairDreamingArtifacts',
  resetDiary: 'doctor.memory.resetDreamDiary',
  resetGrounded: 'doctor.memory.resetGroundedShortTerm',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeDreamingStatus(response: unknown): DreamingStatus | null {
  if (!isRecord(response)) return null;
  const dreaming = response.dreaming;
  if (isRecord(dreaming)) return dreaming as DreamingStatus;
  return response as DreamingStatus;
}

function getDiaryBody(content: string): string {
  const start = content.indexOf(DIARY_START_MARKER);
  const end = content.indexOf(DIARY_END_MARKER);
  if (start >= 0 && end > start) {
    return content.slice(start + DIARY_START_MARKER.length, end);
  }
  return content;
}

function parseDreamDiary(content?: string): DreamDiaryEntry[] {
  if (!content?.trim()) return [];
  return getDiaryBody(content)
    .split(/\n\s*---+\s*\n/g)
    .map((block, index) => {
      const lines = block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !line.startsWith('#') && !line.startsWith('<!--'))
        .filter((line) => !/^(What Happened|Reflections|Candidates|Possible Lasting Updates)$/i.test(line))
        .map((line) => line.replace(/\[[^\]]+\]/g, '').replace(/^[-*]\s+/, '').trim())
        .filter(Boolean);

      const dateLine = lines.find((line) => /^\*[^*]+\*$/.test(line));
      const date = dateLine?.replace(/^\*/, '').replace(/\*$/, '') || '';
      const summary = lines.filter((line) => line !== dateLine).slice(0, 3).join(' ');

      return { id: `${date || 'entry'}-${index}`, date, summary };
    })
    .filter((entry) => entry.summary);
}

function formatDateTime(value?: number | string): string {
  if (value == null || value === '') return '—';
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return String(value);
  return new Date(ms).toLocaleString();
}

function firstNumber(result: unknown, keys: string[]): number | undefined {
  if (!isRecord(result)) return undefined;
  for (const key of keys) {
    const value = asNumber(result[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function isMemoryDoctorStartupError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('rpc timeout: doctor.memory.')
    || lower.includes('service not initialized')
    || lower.includes('not yet ready')
    || lower.includes('unavailable during gateway startup');
}

export default function Dreams() {
  const { t } = useTranslation(['dreams', 'common']);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const rpc = useGatewayStore((state) => state.rpc);
  const dreamingEnabled = useSettingsStore((state) => state.dreamingEnabled);

  const [dreaming, setDreaming] = useState<DreamingStatus | null>(null);
  const [diary, setDiary] = useState<DreamDiaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastActionMessage, setLastActionMessage] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [openingFullUi, setOpeningFullUi] = useState(false);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  const gatewayRunning = gatewayStatus.state === 'running';
  const gatewayReady =
    (gatewayStatus as typeof gatewayStatus & { gatewayReady?: boolean }).gatewayReady !== false;
  const dreamsReady = gatewayRunning && gatewayReady;
  const runtimeDreamingEnabled = dreaming?.enabled === true;

  const diaryEntries = useMemo(() => parseDreamDiary(diary?.content).slice(0, 4), [diary?.content]);
  const recentSignals = useMemo(() => {
    const shortTerm = dreaming?.shortTermEntries ?? [];
    const promoted = dreaming?.promotedEntries ?? [];
    return [...shortTerm, ...promoted].slice(0, 6);
  }, [dreaming?.promotedEntries, dreaming?.shortTermEntries]);

  const refreshAll = useCallback(async (force = false) => {
    if (refreshInFlightRef.current && !force) {
      return refreshInFlightRef.current;
    }
    if (!dreamsReady) {
      setLoading(false);
      setError(null);
      return;
    }

    let refreshPromise!: Promise<void>;
    refreshPromise = (async () => {
      setLoading(true);
      setError(null);
      try {
        const [statusResponse, diaryResponse] = await Promise.all([
          rpc<unknown>('doctor.memory.status', {}, 12_000),
          rpc<DreamDiaryResponse>('doctor.memory.dreamDiary', {}, 12_000),
        ]);
        setDreaming(normalizeDreamingStatus(statusResponse));
        setDiary(diaryResponse);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(isMemoryDoctorStartupError(message) ? t('errors.memoryInitializing') : message);
      } finally {
        setLoading(false);
        if (refreshInFlightRef.current === refreshPromise) {
          refreshInFlightRef.current = null;
        }
      }
    })();

    refreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }, [dreamsReady, rpc, t]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const buildActionMessage = useCallback((action: DreamActionKey, result: unknown): string => {
    if (action === 'backfill') {
      return t('actions.backfillSuccess', { count: firstNumber(result, ['written', 'created', 'count']) ?? 0 });
    }
    if (action === 'dedupe') {
      return t('actions.dedupeSuccess', {
        removed: firstNumber(result, ['removedEntries', 'removed', 'removedCount', 'duplicatesRemoved']) ?? 0,
        kept: firstNumber(result, ['keptEntries', 'kept', 'keptCount']) ?? 0,
      });
    }
    if (action === 'repair') {
      return t('actions.repairSuccess');
    }
    if (action === 'resetDiary') {
      return t('actions.resetDiarySuccess', {
        count: firstNumber(result, ['removedEntries', 'removed', 'removedCount', 'count']) ?? 0,
      });
    }
    return t('actions.resetGroundedSuccess', {
      count: firstNumber(result, ['removedShortTermEntries', 'cleared', 'removed', 'count']) ?? 0,
    });
  }, [t]);

  const runAction = useCallback(async (action: DreamActionKey) => {
    setBusy(true);
    setError(null);
    setLastActionMessage(null);
    try {
      const result = await rpc<unknown>(DREAM_ACTION_METHODS[action], {}, 120_000);
      const message = buildActionMessage(action, result);
      setLastActionMessage(message);
      toast.success(message);
      await refreshAll(true);
    } catch (err) {
      const message = toUserMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
      setPendingConfirmation(null);
    }
  }, [buildActionMessage, refreshAll, rpc]);

  const toggleDreaming = useCallback(async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    setLastActionMessage(null);
    try {
      await hostApiFetch<{ success: boolean }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ dreamingEnabled: enabled }),
      });
      useSettingsStore.setState({ dreamingEnabled: enabled });
      const message = enabled ? t('actions.enableSuccess') : t('actions.disableSuccess');
      setLastActionMessage(message);
      toast.success(message);
    } catch (err) {
      const message = toUserMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }, [t]);

  const openFullDreams = useCallback(async () => {
    setOpeningFullUi(true);
    setError(null);
    try {
      const result = await hostApiFetch<{ success: boolean; url?: string; error?: string }>('/api/gateway/control-ui?view=dreams');
      if (result.success && result.url) {
        await invokeIpc('shell:openExternal', result.url);
      } else {
        throw new Error(result.error || t('errors.openFullUi'));
      }
    } catch (err) {
      const message = toUserMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setOpeningFullUi(false);
    }
  }, [t]);

  const requestConfirmation = useCallback((action: DreamActionKey) => {
    setPendingConfirmation({
      action,
      title: t(`confirmations.${action}.title`),
      message: t(`confirmations.${action}.message`),
      destructive: action === 'resetDiary' || action === 'resetGrounded',
    });
  }, [t]);

  const metricCards = [
    { label: t('metrics.shortTerm'), value: dreaming?.shortTermCount ?? 0, icon: Archive },
    { label: t('metrics.grounded'), value: dreaming?.groundedSignalCount ?? 0, icon: Sparkles },
    { label: t('metrics.signals'), value: dreaming?.totalSignalCount ?? 0, icon: Moon },
    { label: t('metrics.promotedToday'), value: dreaming?.promotedToday ?? 0, icon: BookOpen },
  ];

  return (
    <div className="-m-6 flex min-h-0 flex-1 flex-col overflow-hidden dark:bg-background">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <PageHeader
              title={t('title')}
              description={t('subtitle')}
            />
            <div className="-mt-2 flex flex-wrap items-center gap-3">
              <Badge variant="secondary">
                {t('status.configured')}
                {` · ${dreamingEnabled ? t('common:status.enabled') : t('common:status.disabled')}`}
              </Badge>
              <Badge variant="outline">
                {t('status.runtime')}
                {` · ${
                  !dreamsReady
                    ? t('status.pending')
                    : runtimeDreamingEnabled
                      ? t('common:status.enabled')
                      : t('common:status.disabled')
                }`}
              </Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <Button
              variant="outline"
              className="rounded-[10px] border-black/10 bg-transparent dark:border-white/10 dark:hover:bg-white/5"
              onClick={() => void refreshAll(true)}
              disabled={!dreamsReady || busy || loading}
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              {t('common:actions.refresh')}
            </Button>
            <Button
              variant="outline"
              className="rounded-[10px] border-black/10 bg-transparent dark:border-white/10 dark:hover:bg-white/5"
              onClick={() => void openFullDreams()}
              disabled={openingFullUi}
            >
              {openingFullUi ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
              {t('openFullUi')}
            </Button>
          </div>
        </div>

        <div className="-mr-2 mt-6 min-h-0 flex-1 overflow-y-auto pr-2 pb-8">
          <div className="space-y-6">
            {!dreamsReady && (
              <div className="rounded-[10px] border border-black/10 bg-black/[0.03] px-4 py-3 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
                {t('gatewayNotReady')}
              </div>
            )}

            {error && (
              <div className="rounded-[10px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {lastActionMessage && (
              <div className="rounded-[10px] border border-black/10 bg-black/[0.03] px-4 py-3 text-sm text-foreground/80 dark:border-white/10 dark:bg-white/[0.03]">
                {lastActionMessage}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {metricCards.map((metric) => {
                const Icon = metric.icon;
                return (
                  <Card key={metric.label} className="rounded-[10px] border-black/10 bg-white/75 dark:border-white/10 dark:bg-white/[0.04]">
                    <CardContent className="flex items-center justify-between p-5">
                      <div className="min-w-0">
                        <p className="text-sm text-muted-foreground">{metric.label}</p>
                        <p className="mt-2 text-3xl font-semibold tracking-tight">{metric.value}</p>
                      </div>
                      <div className="rounded-[10px] border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.03]">
                        <Icon className="h-5 w-5 text-muted-foreground" />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <Card className="rounded-[10px] border-black/10 bg-white/75 dark:border-white/10 dark:bg-white/[0.04]">
                <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <CardTitle>{t('actions.title')}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('actions.controlDescription')}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {dreaming?.storageMode ? t('signals.storageMode', { mode: dreaming.storageMode }) : t('signals.noStorageMode')}
                      {dreaming?.timezone ? ` · ${dreaming.timezone}` : ''}
                    </p>
                  </div>
                  <Button className="w-full rounded-[10px] sm:w-auto" onClick={() => void toggleDreaming(!dreamingEnabled)} disabled={busy}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {dreamingEnabled ? t('actions.disable') : t('actions.enable')}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Button variant="outline" className="justify-start rounded-[10px] border-black/10 bg-transparent dark:border-white/10 dark:hover:bg-white/5" onClick={() => void runAction('backfill')} disabled={!dreamsReady || busy || loading}>
                      <BookOpen className="mr-2 h-4 w-4" />
                      {t('actions.backfill')}
                    </Button>
                    <Button variant="outline" className="justify-start rounded-[10px] border-black/10 bg-transparent dark:border-white/10 dark:hover:bg-white/5" onClick={() => requestConfirmation('dedupe')} disabled={!dreamsReady || busy || loading}>
                      <Wrench className="mr-2 h-4 w-4" />
                      {t('actions.dedupe')}
                    </Button>
                    <Button variant="outline" className="justify-start rounded-[10px] border-black/10 bg-transparent dark:border-white/10 dark:hover:bg-white/5" onClick={() => requestConfirmation('repair')} disabled={!dreamsReady || busy || loading}>
                      <Wrench className="mr-2 h-4 w-4" />
                      {t('actions.repair')}
                    </Button>
                    <Button variant="outline" className="justify-start rounded-[10px] border-black/10 bg-transparent dark:border-white/10 dark:hover:bg-white/5" onClick={() => requestConfirmation('resetGrounded')} disabled={!dreamsReady || busy || loading}>
                      <Archive className="mr-2 h-4 w-4" />
                      {t('actions.resetGrounded')}
                    </Button>
                    <Button variant="outline" className="justify-start rounded-[10px] border-black/10 bg-transparent dark:border-white/10 dark:hover:bg-white/5 sm:col-span-2" onClick={() => requestConfirmation('resetDiary')} disabled={!dreamsReady || busy || loading}>
                      <Archive className="mr-2 h-4 w-4" />
                      {t('actions.resetDiary')}
                    </Button>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-3">
                    {(['light', 'rem', 'deep'] as DreamPhaseName[]).map((phaseKey) => {
                      const phase = dreaming?.phases?.[phaseKey];
                      return (
                        <div key={phaseKey} className="rounded-[10px] border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium">{t(`phases.${phaseKey}`)}</p>
                            <Badge variant="secondary">
                              {phase?.enabled === false ? t('common:status.disabled') : t('common:status.enabled')}
                            </Badge>
                          </div>
                          <p className="mt-2 break-words text-xs text-muted-foreground">
                            {phase?.managedCronPresent ? (phase?.cron || t('phases.noSchedule')) : t('phases.noSchedule')}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(phase?.nextRunAtMs)}</p>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Card className="rounded-[10px] border-black/10 bg-white/75 dark:border-white/10 dark:bg-white/[0.04]">
                  <CardHeader>
                    <CardTitle>{t('diary.title')}</CardTitle>
                    <p className="break-all text-sm text-muted-foreground">{diary?.found ? (diary.path || 'DREAMS.md') : t('diary.notFound')}</p>
                  </CardHeader>
                  <CardContent>
                    {diaryEntries.length === 0 ? (
                      <div className="rounded-[10px] border border-dashed p-6 text-center text-sm text-muted-foreground">
                        {diary?.found ? t('diary.empty') : t('diary.notFound')}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {diaryEntries.map((entry) => (
                          <div key={entry.id} className="rounded-[10px] border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]">
                            <p className="text-sm font-medium">{entry.date || t('diary.undated')}</p>
                            <p className="mt-1 text-sm text-muted-foreground">{entry.summary}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-[10px] border-black/10 bg-white/75 dark:border-white/10 dark:bg-white/[0.04]">
                  <CardHeader>
                    <CardTitle>{t('signals.title')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {recentSignals.length === 0 ? (
                      <div className="rounded-[10px] border border-dashed p-6 text-center text-sm text-muted-foreground">
                        {t('signals.empty')}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {recentSignals.map((entry, index) => (
                          <div key={`${entry.key || entry.path || 'signal'}-${index}`} className="rounded-[10px] border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]">
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                              <p className="truncate text-sm font-medium">{entry.path || entry.key || t('signals.unknownSource')}</p>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {formatDateTime(entry.promotedAt || entry.lastRecalledAt)}
                              </span>
                            </div>
                            <p className="mt-2 break-words text-sm text-muted-foreground">{entry.snippet || t('signals.noSnippet')}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingConfirmation != null}
        title={pendingConfirmation?.title || ''}
        message={pendingConfirmation?.message || ''}
        confirmLabel={t('common:actions.confirm')}
        cancelLabel={t('common:actions.cancel')}
        confirmPending={busy}
        variant={pendingConfirmation?.destructive ? 'destructive' : 'default'}
        onCancel={() => {
          if (!busy) setPendingConfirmation(null);
        }}
        onConfirm={() => {
          if (pendingConfirmation) {
            void runAction(pendingConfirmation.action);
          }
        }}
      />
    </div>
  );
}
