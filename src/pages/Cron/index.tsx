/**
 * Cron Page
 * Manage scheduled tasks
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  History,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Timer,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { LoadingIcon, PageLoader } from '@/components/common/LoadingSpinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { useGatewayStore } from '@/stores/gateway';
import { useCronStore } from '@/stores/cron';
import { CHANNEL_ICONS, type ChannelType } from '@/types/channel';
import type { CronJob, CronJobCreateInput, ScheduleType } from '@/types/cron';
import { cn, formatRelativeTime } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

const schedulePresets: { key: string; value: string; type: ScheduleType }[] = [
  { key: 'everyMinute', value: '* * * * *', type: 'interval' },
  { key: 'every5Min', value: '*/5 * * * *', type: 'interval' },
  { key: 'every15Min', value: '*/15 * * * *', type: 'interval' },
  { key: 'everyHour', value: '0 * * * *', type: 'interval' },
  { key: 'daily9am', value: '0 9 * * *', type: 'daily' },
  { key: 'daily6pm', value: '0 18 * * *', type: 'daily' },
  { key: 'weeklyMon', value: '0 9 * * 1', type: 'weekly' },
  { key: 'monthly1st', value: '0 9 1 * *', type: 'monthly' },
];

function normalizeScheduleExpr(schedule: unknown): string {
  if (typeof schedule === 'string') return schedule;
  if (schedule && typeof schedule === 'object') {
    const s = schedule as { kind?: string; expr?: string };
    if (s.kind === 'cron' && typeof s.expr === 'string') return s.expr;
  }
  return '';
}

function parseCronExpr(cron: string, t: TFunction<'cron'>): string {
  const preset = schedulePresets.find((p) => p.value === cron);
  if (preset) return t(`presets.${preset.key}` as const);

  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

  if (minute === '*' && hour === '*') return t('presets.everyMinute');
  if (minute.startsWith('*/')) return t('schedule.everyMinutes', { count: Number(minute.slice(2)) });
  if (hour === '*' && minute === '0') return t('presets.everyHour');

  if (dayOfWeek !== '*' && dayOfMonth === '*') {
    const dayMap: Record<string, string> = {
      '0': t('schedule.days.sun'),
      '1': t('schedule.days.mon'),
      '2': t('schedule.days.tue'),
      '3': t('schedule.days.wed'),
      '4': t('schedule.days.thu'),
      '5': t('schedule.days.fri'),
      '6': t('schedule.days.sat'),
      '7': t('schedule.days.sun'),
    };
    return t('schedule.weeklyAt', {
      day: dayMap[dayOfWeek] || dayOfWeek,
      time: `${hour}:${minute.padStart(2, '0')}`,
    });
  }

  if (dayOfMonth !== '*') {
    return t('schedule.monthlyAtDay', { day: dayOfMonth, time: `${hour}:${minute.padStart(2, '0')}` });
  }

  if (hour !== '*') {
    return t('schedule.dailyAt', { time: `${hour}:${minute.padStart(2, '0')}` });
  }

  return cron;
}

function parseCronSchedule(schedule: unknown, t: TFunction<'cron'>): string {
  if (schedule && typeof schedule === 'object') {
    const s = schedule as { kind?: string; expr?: string; everyMs?: number; at?: string };
    if (s.kind === 'cron' && typeof s.expr === 'string') return parseCronExpr(s.expr, t);
    if (s.kind === 'every' && typeof s.everyMs === 'number') {
      const ms = s.everyMs;
      if (ms < 60_000) return t('schedule.everySeconds', { count: Math.round(ms / 1000) });
      if (ms < 3_600_000) return t('schedule.everyMinutes', { count: Math.round(ms / 60_000) });
      if (ms < 86_400_000) return t('schedule.everyHours', { count: Math.round(ms / 3_600_000) });
      return t('schedule.everyDays', { count: Math.round(ms / 86_400_000) });
    }
    if (s.kind === 'at' && typeof s.at === 'string') {
      try {
        return t('schedule.onceAt', { time: new Date(s.at).toLocaleString() });
      } catch {
        return t('schedule.onceAt', { time: s.at });
      }
    }
    return String(schedule);
  }

  if (typeof schedule === 'string') return parseCronExpr(schedule, t);
  return String(schedule ?? t('schedule.unknown'));
}

function estimateNextRun(scheduleExpr: string): string | null {
  const now = new Date();
  const next = new Date(now.getTime());

  if (scheduleExpr === '* * * * *') {
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + 1);
    return next.toLocaleString();
  }
  if (scheduleExpr === '*/5 * * * *') {
    const delta = 5 - (next.getMinutes() % 5 || 5);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + delta);
    return next.toLocaleString();
  }
  if (scheduleExpr === '*/15 * * * *') {
    const delta = 15 - (next.getMinutes() % 15 || 15);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + delta);
    return next.toLocaleString();
  }
  if (scheduleExpr === '0 * * * *') {
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.toLocaleString();
  }
  if (scheduleExpr === '0 9 * * *' || scheduleExpr === '0 18 * * *') {
    const targetHour = scheduleExpr === '0 9 * * *' ? 9 : 18;
    next.setSeconds(0, 0);
    next.setHours(targetHour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toLocaleString();
  }
  if (scheduleExpr === '0 9 * * 1') {
    next.setSeconds(0, 0);
    next.setHours(9, 0, 0, 0);
    const day = next.getDay();
    const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7;
    next.setDate(next.getDate() + daysUntilMonday);
    return next.toLocaleString();
  }
  if (scheduleExpr === '0 9 1 * *') {
    next.setSeconds(0, 0);
    next.setDate(1);
    next.setHours(9, 0, 0, 0);
    if (next <= now) next.setMonth(next.getMonth() + 1);
    return next.toLocaleString();
  }

  return null;
}

function validateCronExpression(expr: string): boolean {
  const value = expr.trim();
  if (!value) return false;
  const parts = value.split(/\s+/);
  if (parts.length !== 5) return false;
  const allowedToken = /^[0-9*/,-]+$/;
  return parts.every((part) => allowedToken.test(part));
}

interface TaskDialogProps {
  job?: CronJob;
  onClose: () => void;
  onSave: (input: CronJobCreateInput) => Promise<void>;
}

function TaskDialog({ job, onClose, onSave }: TaskDialogProps) {
  const { t } = useTranslation('cron');
  const [saving, setSaving] = useState(false);
  const readOnly = Boolean(job && job.uiManaged === false);

  const [name, setName] = useState(job?.name || '');
  const [message, setMessage] = useState(job?.message || '');
  const initialSchedule = normalizeScheduleExpr(job?.schedule) || '0 9 * * *';
  const [schedule, setSchedule] = useState(initialSchedule);
  const [customSchedule, setCustomSchedule] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [enabled, setEnabled] = useState(job?.enabled ?? true);

  const finalSchedule = useCustom ? customSchedule : schedule;
  const schedulePreview = estimateNextRun(finalSchedule);
  const cronInvalid = useCustom && !validateCronExpression(finalSchedule);

  const handleSubmit = async () => {
    if (readOnly) {
      toast.error(t('advanced.readOnlyToast'));
      return;
    }
    if (!name.trim()) {
      toast.error(t('toast.nameRequired'));
      return;
    }
    if (!message.trim()) {
      toast.error(t('toast.messageRequired'));
      return;
    }
    if (!finalSchedule.trim()) {
      toast.error(t('toast.scheduleRequired'));
      return;
    }
    if (cronInvalid) {
      toast.error(t('toast.invalidCron'));
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        message: message.trim(),
        schedule: finalSchedule,
        enabled,
      });
      onClose();
      toast.success(job ? t('toast.updated') : t('toast.created'));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-2xl font-semibold tracking-tight">{job ? t('dialog.editTitle') : t('dialog.createTitle')}</CardTitle>
            <CardDescription className="mt-1">{t('dialog.description')}</CardDescription>
          </div>
              <Button variant="ghost" size="icon" onClick={onClose} className="rounded-xl">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>

        <CardContent className="space-y-5">
          {readOnly && (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              {t('advanced.readOnlyDescription')}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="task-name">{t('dialog.taskName')}</Label>
            <Input
              id="task-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('dialog.taskNamePlaceholder')}
              disabled={readOnly}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-message">{t('dialog.message')}</Label>
            <Textarea
              id="task-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder={t('dialog.messagePlaceholder')}
              disabled={readOnly}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('dialog.schedule')}</Label>
              <Button variant="ghost" size="sm" onClick={() => setUseCustom((v) => !v)} className="rounded-xl">
                {useCustom ? t('dialog.usePresets') : t('dialog.useCustomCron')}
              </Button>
            </div>

            {!useCustom ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {schedulePresets.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    variant={schedule === preset.value ? 'default' : 'outline'}
                    className={cn(
                      "justify-start rounded-xl",
                      schedule === preset.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-card/80"
                    )}
                    onClick={() => setSchedule(preset.value)}
                    disabled={readOnly}
                  >
                    <Timer className="h-4 w-4 mr-2" />
                    {t(`presets.${preset.key}` as const)}
                  </Button>
                ))}
              </div>
            ) : (
              <Input
                value={customSchedule}
                onChange={(e) => setCustomSchedule(e.target.value)}
                placeholder={t('dialog.cronPlaceholder')}
                className={cn("rounded-xl bg-card/80", cronInvalid && 'border-destructive focus-visible:ring-destructive')}
                disabled={readOnly}
              />
            )}

            <p className="text-xs text-muted-foreground">
              {schedulePreview ? `${t('card.next')}: ${schedulePreview}` : t('dialog.cronPlaceholder')}
            </p>
            {cronInvalid && <p className="text-xs text-destructive">{t('toast.invalidCron')}</p>}
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-card/80 p-4">
            <div>
              <p className="text-sm font-medium">{t('dialog.enableImmediately')}</p>
              <p className="text-xs text-muted-foreground">{t('dialog.enableImmediatelyDesc')}</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={readOnly} />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} className="rounded-xl px-5">{t('common:actions.cancel', 'Cancel')}</Button>
            <Button onClick={handleSubmit} disabled={saving || readOnly} className="rounded-xl px-5">
              {saving ? (
                <>
                  <LoadingIcon className="h-4 w-4 mr-2" />
                  {t('common:status.saving', 'Saving...')}
                </>
              ) : job ? t('dialog.saveChanges') : t('dialog.createTitle')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface CronJobCardProps {
  job: CronJob;
  busy?: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onTrigger: () => Promise<void>;
}

function CronJobCard({ job, busy = false, onToggle, onEdit, onDelete, onTrigger }: CronJobCardProps) {
  const { t } = useTranslation('cron');
  const [triggering, setTriggering] = useState(false);

  const scheduleText = parseCronSchedule(job.schedule, t);
  const isAdvancedJob = job.uiManaged === false;

  const handleTrigger = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setTriggering(true);
    try {
      await onTrigger();
      toast.success(t('toast.triggered'));
    } catch (error) {
      toast.error(t('toast.failedTrigger', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setTriggering(false);
    }
  };

  return (
    <Card className="rounded-2xl transition-shadow">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold truncate">{job.name}</h3>
              <span className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                job.enabled
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-muted text-muted-foreground'
              )}>
                {job.enabled ? t('stats.active') : t('stats.paused')}
              </span>
              <span className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                isAdvancedJob
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  : 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
              )}>
                {isAdvancedJob ? t('advanced.badge') : t('advanced.simpleBadge')}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {scheduleText}
            </p>
          </div>
          <Switch checked={job.enabled} onCheckedChange={onToggle} disabled={busy || triggering} />
        </div>

        <button
          type="button"
          onClick={onEdit}
          className="w-full text-left rounded-2xl border border-border/70 bg-card/80 p-3 hover:bg-accent/50 transition-colors"
        >
          <p className="text-sm text-foreground/90 line-clamp-2">{job.message}</p>
        </button>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {isAdvancedJob && (
            <span className="inline-flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              {t('advanced.readOnlyInline')}
            </span>
          )}

          {job.target && (
            <span className="inline-flex items-center gap-1.5">
              {CHANNEL_ICONS[job.target.channelType as ChannelType]}
              {job.target.channelName}
            </span>
          )}

          {job.lastRun && (
            <span className="inline-flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" />
              {t('card.last')}: {formatRelativeTime(job.lastRun.time)}
              {job.lastRun.success ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-destructive" />
              )}
            </span>
          )}

          {job.nextRun && job.enabled && (
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {t('card.next')}: {new Date(job.nextRun).toLocaleString()}
            </span>
          )}
        </div>

        {job.lastRun && !job.lastRun.success && job.lastRun.error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span className="line-clamp-2">{job.lastRun.error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={handleTrigger} disabled={triggering || busy} className="rounded-xl">
            {triggering ? <LoadingIcon className="h-3.5 w-3.5 mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
            {t('card.runNow')}
          </Button>
          <Button variant="outline" size="sm" className="rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10" onClick={onDelete} disabled={busy || triggering}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            {t('common:actions.delete', 'Delete')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function Cron() {
  const { t } = useTranslation('cron');
  const { jobs, loading, error, fetchJobs, createJob, updateJob, toggleJob, deleteJob, triggerJob } = useCronStore();
  const gatewayStatus = useGatewayStore((state) => state.status);

  const [showDialog, setShowDialog] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | undefined>();
  const [jobToDelete, setJobToDelete] = useState<{ id: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused' | 'failed'>('all');
  const [busyJobIds, setBusyJobIds] = useState<Record<string, boolean>>({});

  const isGatewayRunning = gatewayStatus.state === 'running';

  useEffect(() => {
    if (isGatewayRunning) {
      void fetchJobs();
    }
  }, [fetchJobs, isGatewayRunning]);

  const safeJobs = useMemo(() => (Array.isArray(jobs) ? jobs : []), [jobs]);
  const activeJobs = useMemo(() => safeJobs.filter((j) => j.enabled), [safeJobs]);
  const pausedJobs = useMemo(() => safeJobs.filter((j) => !j.enabled), [safeJobs]);
  const failedJobs = useMemo(() => safeJobs.filter((j) => j.lastRun && !j.lastRun.success), [safeJobs]);
  const advancedJobs = useMemo(() => safeJobs.filter((j) => j.uiManaged === false), [safeJobs]);

  const orderedJobs = useMemo(() => {
    return [...safeJobs].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      const aNext = a.nextRun ? new Date(a.nextRun).getTime() : Number.MAX_SAFE_INTEGER;
      const bNext = b.nextRun ? new Date(b.nextRun).getTime() : Number.MAX_SAFE_INTEGER;
      if (aNext !== bNext) return aNext - bNext;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [safeJobs]);

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orderedJobs.filter((job) => {
      const passStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'active'
            ? job.enabled
            : statusFilter === 'paused'
              ? !job.enabled
              : Boolean(job.lastRun && !job.lastRun.success);
      if (!passStatus) return false;
      if (!q) return true;
      const scheduleText = parseCronSchedule(job.schedule, t).toLowerCase();
      return (
        job.name.toLowerCase().includes(q) ||
        job.message.toLowerCase().includes(q) ||
        scheduleText.includes(q)
      );
    });
  }, [orderedJobs, search, statusFilter, t]);

  const handleSave = useCallback(async (input: CronJobCreateInput) => {
    if (editingJob) await updateJob(editingJob.id, input);
    else await createJob(input);
  }, [createJob, editingJob, updateJob]);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    setBusyJobIds((prev) => ({ ...prev, [id]: true }));
    try {
      await toggleJob(id, enabled);
      toast.success(enabled ? t('toast.enabled') : t('toast.paused'));
    } catch {
      toast.error(t('toast.failedUpdate'));
    } finally {
      setBusyJobIds((prev) => ({ ...prev, [id]: false }));
    }
  }, [t, toggleJob]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchJobs();
    } finally {
      setRefreshing(false);
    }
  }, [fetchJobs]);

  if (loading) {
    return (
      <div className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)]">
        <PageLoader
          title={t('loadingTitle', '正在加载定时任务')}
          description={t('loadingDescription', '正在同步 OpenClaw 的任务列表，请稍候。')}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col -m-6 h-[calc(100vh-2.5rem)] overflow-hidden bg-background">
      <div className="w-full max-w-6xl mx-auto px-6 pt-5 pb-3 md:px-10 md:pt-6 md:pb-3">
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={(
            <div className="flex flex-nowrap items-center gap-2">
              <Button variant="outline" onClick={handleRefresh} disabled={!isGatewayRunning || refreshing} className="shrink-0 rounded-xl">
                {refreshing ? <LoadingIcon className="h-4 w-4 mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                {t('refresh')}
              </Button>
              <Button
                onClick={() => {
                  setEditingJob(undefined);
                  setShowDialog(true);
                }}
                disabled={!isGatewayRunning}
                className="shrink-0 rounded-xl"
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('newTask')}
              </Button>
            </div>
          )}
        />
      </div>

      <div className="min-h-0 flex-1 px-6 pb-8 md:px-10">
        <div className="flex h-full w-full max-w-6xl mx-auto flex-col space-y-4">
          {!isGatewayRunning && (
            <div className="rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-300 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {t('gatewayWarning')}
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {advancedJobs.length > 0 && (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                {t('advanced.summary', { count: advancedJobs.length })}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={<Clock className="h-4 w-4" />} label={t('stats.total')} value={safeJobs.length} />
            <StatCard icon={<Play className="h-4 w-4" />} label={t('stats.active')} value={activeJobs.length} />
            <StatCard icon={<Pause className="h-4 w-4" />} label={t('stats.paused')} value={pausedJobs.length} />
            <StatCard icon={<XCircle className="h-4 w-4" />} label={t('stats.failed')} value={failedJobs.length} />
          </div>

          <Card className="flex min-h-0 flex-1 flex-col rounded-2xl">
            <CardContent className="flex min-h-0 flex-1 flex-col p-4 md:p-6">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative w-full lg:max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('filters.searchPlaceholder')}
                    className="rounded-xl bg-card/85 pl-9"
                  />
                </div>
                <div className="inline-flex items-center gap-1 rounded-xl border border-border/70 bg-card/85 p-1">
                  {(['all', 'active', 'paused', 'failed'] as const).map((item) => (
                    <Button
                      key={item}
                      variant={statusFilter === item ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setStatusFilter(item)}
                      className={cn(
                        "rounded-xl px-4",
                        statusFilter === item
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent/70"
                      )}
                    >
                      {t(`filters.${item}`)}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="-mr-2 mt-4 min-h-0 flex-1 overflow-y-auto pr-2 pb-1">
                {safeJobs.length === 0 ? (
                  <div className="text-center py-12 rounded-2xl border border-dashed border-border/80 bg-muted/35">
                    <Clock className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                    <h3 className="text-lg font-medium">{t('empty.title')}</h3>
                    <p className="text-sm text-muted-foreground max-w-xl mx-auto mt-1">{t('empty.description')}</p>
                    <Button
                      onClick={() => {
                        setEditingJob(undefined);
                        setShowDialog(true);
                      }}
                      disabled={!isGatewayRunning}
                      className="mt-4 rounded-xl"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      {t('empty.create')}
                    </Button>
                  </div>
                ) : filteredJobs.length === 0 ? (
                  <div className="text-center py-10 rounded-2xl border border-dashed border-border/80 bg-muted/35">
                    <Search className="h-7 w-7 mx-auto text-muted-foreground mb-2" />
                    <h3 className="text-base font-medium">{t('empty.noMatchTitle')}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{t('empty.noMatchDescription')}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {filteredJobs.map((job) => (
                      <CronJobCard
                        key={job.id}
                        job={job}
                        busy={Boolean(busyJobIds[job.id])}
                        onToggle={(enabled) => handleToggle(job.id, enabled)}
                        onEdit={() => {
                          setEditingJob(job);
                          setShowDialog(true);
                        }}
                        onDelete={() => setJobToDelete({ id: job.id })}
                        onTrigger={() => triggerJob(job.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {showDialog && (
        <TaskDialog
          job={editingJob}
          onClose={() => {
            setShowDialog(false);
            setEditingJob(undefined);
          }}
          onSave={handleSave}
        />
      )}

      <ConfirmDialog
        open={!!jobToDelete}
        title={t('common:actions.confirm', 'Confirm')}
        message={t('card.deleteConfirm')}
        confirmLabel={t('common:actions.delete', 'Delete')}
        cancelLabel={t('common:actions.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!jobToDelete) return;
          await deleteJob(jobToDelete.id);
          setJobToDelete(null);
          toast.success(t('toast.deleted'));
        }}
        onCancel={() => setJobToDelete(null)}
      />
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/88 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)] backdrop-blur-xl">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em]">{label}</span>
        <span>{icon}</span>
      </div>
      <p className="mt-2 text-3xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

export default Cron;
