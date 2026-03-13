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
  Bot,
  History,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
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

type ScheduleBuilderMode = 'interval' | 'daily' | 'weekly' | 'monthly' | 'custom';
type IntervalUnit = 'minutes' | 'hours';

type ScheduleBuilderState = {
  mode: ScheduleBuilderMode;
  intervalCount: number;
  intervalUnit: IntervalUnit;
  dailyTime: string;
  weeklyDay: string;
  weeklyTime: string;
  monthlyDay: number;
  monthlyTime: string;
  custom: string;
};

const DEFAULT_SCHEDULE_STATE: ScheduleBuilderState = {
  mode: 'daily',
  intervalCount: 1,
  intervalUnit: 'minutes',
  dailyTime: '09:00',
  weeklyDay: '1',
  weeklyTime: '09:00',
  monthlyDay: 1,
  monthlyTime: '09:00',
  custom: '',
};

const WEEKDAY_OPTIONS = ['1', '2', '3', '4', '5', '6', '0'] as const;

function weekdayTranslationKey(day: string): 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' {
  switch (day) {
    case '1':
      return 'mon';
    case '2':
      return 'tue';
    case '3':
      return 'wed';
    case '4':
      return 'thu';
    case '5':
      return 'fri';
    case '6':
      return 'sat';
    default:
      return 'sun';
  }
}

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
  if (minute === '0' && hour.startsWith('*/')) return t('schedule.everyHours', { count: Number(hour.slice(2)) });
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toTimeParts(time: string): { hour: number; minute: number } {
  const [rawHour = '0', rawMinute = '0'] = time.split(':');
  return {
    hour: clampNumber(Number(rawHour) || 0, 0, 23),
    minute: clampNumber(Number(rawMinute) || 0, 0, 59),
  };
}

function formatTime(hour: number, minute: number): string {
  return `${String(clampNumber(hour, 0, 23)).padStart(2, '0')}:${String(clampNumber(minute, 0, 59)).padStart(2, '0')}`;
}

function isValidTimeValue(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function sanitizeTimeInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function parseScheduleBuilder(scheduleExpr: string): ScheduleBuilderState {
  const expr = scheduleExpr.trim();
  if (!expr) return DEFAULT_SCHEDULE_STATE;

  if (expr === '* * * * *') {
    return {
      ...DEFAULT_SCHEDULE_STATE,
      mode: 'interval',
      intervalCount: 1,
      intervalUnit: 'minutes',
      custom: expr,
    };
  }

  if (expr === '0 * * * *') {
    return {
      ...DEFAULT_SCHEDULE_STATE,
      mode: 'interval',
      intervalCount: 1,
      intervalUnit: 'hours',
      custom: expr,
    };
  }

  let match = expr.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (match) {
    return {
      ...DEFAULT_SCHEDULE_STATE,
      mode: 'interval',
      intervalCount: clampNumber(Number(match[1]) || 1, 1, 59),
      intervalUnit: 'minutes',
      custom: expr,
    };
  }

  match = expr.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (match) {
    return {
      ...DEFAULT_SCHEDULE_STATE,
      mode: 'interval',
      intervalCount: clampNumber(Number(match[1]) || 1, 1, 23),
      intervalUnit: 'hours',
      custom: expr,
    };
  }

  match = expr.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (match) {
    return {
      ...DEFAULT_SCHEDULE_STATE,
      mode: 'daily',
      dailyTime: formatTime(Number(match[2]), Number(match[1])),
      custom: expr,
    };
  }

  match = expr.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-7])$/);
  if (match) {
    return {
      ...DEFAULT_SCHEDULE_STATE,
      mode: 'weekly',
      weeklyTime: formatTime(Number(match[2]), Number(match[1])),
      weeklyDay: match[3] === '7' ? '0' : match[3],
      custom: expr,
    };
  }

  match = expr.match(/^(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+\*\s+\*$/);
  if (match) {
    return {
      ...DEFAULT_SCHEDULE_STATE,
      mode: 'monthly',
      monthlyTime: formatTime(Number(match[2]), Number(match[1])),
      monthlyDay: clampNumber(Number(match[3]) || 1, 1, 31),
      custom: expr,
    };
  }

  return {
    ...DEFAULT_SCHEDULE_STATE,
    mode: 'custom',
    custom: expr,
  };
}

function buildCronFromBuilder(state: ScheduleBuilderState): string {
  if (state.mode === 'custom') return state.custom.trim();

  if (state.mode === 'interval') {
    const count = clampNumber(Math.round(state.intervalCount) || 1, 1, state.intervalUnit === 'minutes' ? 59 : 23);
    if (state.intervalUnit === 'minutes') {
      return count === 1 ? '* * * * *' : `*/${count} * * * *`;
    }
    return count === 1 ? '0 * * * *' : `0 */${count} * * *`;
  }

  if (state.mode === 'daily') {
    const { hour, minute } = toTimeParts(state.dailyTime);
    return `${minute} ${hour} * * *`;
  }

  if (state.mode === 'weekly') {
    const { hour, minute } = toTimeParts(state.weeklyTime);
    return `${minute} ${hour} * * ${state.weeklyDay}`;
  }

  const { hour, minute } = toTimeParts(state.monthlyTime);
  const day = clampNumber(Math.round(state.monthlyDay) || 1, 1, 31);
  return `${minute} ${hour} ${day} * *`;
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
  const intervalMinuteMatch = scheduleExpr.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (intervalMinuteMatch) {
    const count = clampNumber(Number(intervalMinuteMatch[1]) || 1, 1, 59);
    next.setSeconds(0, 0);
    const remainder = next.getMinutes() % count;
    next.setMinutes(next.getMinutes() + (remainder === 0 ? count : count - remainder));
    return next.toLocaleString();
  }
  if (scheduleExpr === '0 * * * *') {
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.toLocaleString();
  }
  const intervalHourMatch = scheduleExpr.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (intervalHourMatch) {
    const count = clampNumber(Number(intervalHourMatch[1]) || 1, 1, 23);
    next.setMinutes(0, 0, 0);
    const remainder = next.getHours() % count;
    next.setHours(next.getHours() + (remainder === 0 ? count : count - remainder));
    return next.toLocaleString();
  }
  if (scheduleExpr === '0 9 * * *' || scheduleExpr === '0 18 * * *') {
    const targetHour = scheduleExpr === '0 9 * * *' ? 9 : 18;
    next.setSeconds(0, 0);
    next.setHours(targetHour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toLocaleString();
  }
  const dailyMatch = scheduleExpr.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (dailyMatch) {
    next.setSeconds(0, 0);
    next.setHours(Number(dailyMatch[2]), Number(dailyMatch[1]), 0, 0);
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
  const weeklyMatch = scheduleExpr.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-7])$/);
  if (weeklyMatch) {
    const targetDay = weeklyMatch[3] === '7' ? 0 : Number(weeklyMatch[3]);
    next.setSeconds(0, 0);
    next.setHours(Number(weeklyMatch[2]), Number(weeklyMatch[1]), 0, 0);
    const day = next.getDay();
    let delta = targetDay - day;
    if (delta < 0 || (delta === 0 && next <= now)) delta += 7;
    if (delta === 0 && next > now) {
      return next.toLocaleString();
    }
    next.setDate(next.getDate() + delta);
    return next.toLocaleString();
  }
  if (scheduleExpr === '0 9 1 * *') {
    next.setSeconds(0, 0);
    next.setDate(1);
    next.setHours(9, 0, 0, 0);
    if (next <= now) next.setMonth(next.getMonth() + 1);
    return next.toLocaleString();
  }
  const monthlyMatch = scheduleExpr.match(/^(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+\*\s+\*$/);
  if (monthlyMatch) {
    next.setSeconds(0, 0);
    next.setHours(Number(monthlyMatch[2]), Number(monthlyMatch[1]), 0, 0);
    next.setDate(clampNumber(Number(monthlyMatch[3]) || 1, 1, 31));
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
  const initialBuilderState = parseScheduleBuilder(initialSchedule);
  const [scheduleMode, setScheduleMode] = useState<ScheduleBuilderMode>(initialBuilderState.mode);
  const [intervalCount, setIntervalCount] = useState(initialBuilderState.intervalCount);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(initialBuilderState.intervalUnit);
  const [dailyTime, setDailyTime] = useState(initialBuilderState.dailyTime);
  const [weeklyDay, setWeeklyDay] = useState(initialBuilderState.weeklyDay);
  const [weeklyTime, setWeeklyTime] = useState(initialBuilderState.weeklyTime);
  const [monthlyDay, setMonthlyDay] = useState(initialBuilderState.monthlyDay);
  const [monthlyTime, setMonthlyTime] = useState(initialBuilderState.monthlyTime);
  const [customSchedule, setCustomSchedule] = useState(initialBuilderState.custom || initialSchedule);
  const [enabled, setEnabled] = useState(job?.enabled ?? true);

  const finalSchedule = buildCronFromBuilder({
    mode: scheduleMode,
    intervalCount,
    intervalUnit,
    dailyTime,
    weeklyDay,
    weeklyTime,
    monthlyDay,
    monthlyTime,
    custom: customSchedule,
  });
  const schedulePreview = estimateNextRun(finalSchedule);
  const cronInvalid = !validateCronExpression(finalSchedule);
  const timeInvalid = (
    (scheduleMode === 'daily' && !isValidTimeValue(dailyTime)) ||
    (scheduleMode === 'weekly' && !isValidTimeValue(weeklyTime)) ||
    (scheduleMode === 'monthly' && !isValidTimeValue(monthlyTime))
  );

  const applyScheduleTemplate = (scheduleExpr: string) => {
    const nextState = parseScheduleBuilder(scheduleExpr);
    setScheduleMode(nextState.mode);
    setIntervalCount(nextState.intervalCount);
    setIntervalUnit(nextState.intervalUnit);
    setDailyTime(nextState.dailyTime);
    setWeeklyDay(nextState.weeklyDay);
    setWeeklyTime(nextState.weeklyTime);
    setMonthlyDay(nextState.monthlyDay);
    setMonthlyTime(nextState.monthlyTime);
    setCustomSchedule(scheduleExpr);
  };

  const visiblePresets = schedulePresets.filter((preset) =>
    scheduleMode === 'custom' ? true : preset.type === scheduleMode
  );
  const selectedPresetValue = visiblePresets.some((preset) => preset.value === finalSchedule) ? finalSchedule : '__none';

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
    if (timeInvalid) {
      toast.error(t('toast.invalidTime'));
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

          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <Label>{t('dialog.schedule')}</Label>
                <p className="mt-1 text-xs text-muted-foreground">{t('dialog.scheduleHint')}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card/70 p-4 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="schedule-mode">{t('dialog.schedule')}</Label>
                  <Select
                    id="schedule-mode"
                    value={scheduleMode}
                    onChange={(e) => setScheduleMode(e.target.value as ScheduleBuilderMode)}
                    disabled={readOnly}
                  >
                    {(['interval', 'daily', 'weekly', 'monthly', 'custom'] as const).map((mode) => (
                      <option key={mode} value={mode}>
                        {t(`dialog.scheduleModes.${mode}` as const)}
                      </option>
                    ))}
                  </Select>
                </div>

                {visiblePresets.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="schedule-template">{t('dialog.commonTemplates')}</Label>
                    <Select
                      id="schedule-template"
                      value={selectedPresetValue}
                      onChange={(e) => {
                        if (e.target.value !== '__none') {
                          applyScheduleTemplate(e.target.value);
                        }
                      }}
                      disabled={readOnly}
                    >
                      <option value="__none">{t('dialog.noTemplate')}</option>
                      {visiblePresets.map((preset) => (
                        <option key={preset.value} value={preset.value}>
                          {t(`presets.${preset.key}` as const)}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>

              {scheduleMode === 'interval' && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
                <div className="space-y-2">
                  <Label htmlFor="interval-count">{t('dialog.intervalValue')}</Label>
                  <Input
                    id="interval-count"
                    type="number"
                    min={1}
                    max={intervalUnit === 'minutes' ? 59 : 23}
                    value={String(intervalCount)}
                    onChange={(e) => setIntervalCount(clampNumber(Number(e.target.value) || 1, 1, intervalUnit === 'minutes' ? 59 : 23))}
                    disabled={readOnly}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="interval-unit">{t('dialog.intervalUnit')}</Label>
                  <Select
                    id="interval-unit"
                    value={intervalUnit}
                    onChange={(e) => setIntervalUnit(e.target.value as IntervalUnit)}
                    disabled={readOnly}
                  >
                    <option value="minutes">{t('dialog.intervalUnits.minutes')}</option>
                    <option value="hours">{t('dialog.intervalUnits.hours')}</option>
                  </Select>
                </div>
              </div>
              )}

              {scheduleMode === 'daily' && (
                <div className="space-y-2">
                <Label htmlFor="daily-time">{t('dialog.time')}</Label>
                <Input
                  id="daily-time"
                  type="text"
                  inputMode="numeric"
                  placeholder={t('dialog.timePlaceholder')}
                  value={dailyTime}
                  onChange={(e) => setDailyTime(sanitizeTimeInput(e.target.value))}
                  className={cn(timeInvalid && scheduleMode === 'daily' && 'border-destructive focus-visible:ring-destructive')}
                  disabled={readOnly}
                />
              </div>
              )}

              {scheduleMode === 'weekly' && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="weekly-day">{t('dialog.weekday')}</Label>
                  <Select
                    id="weekly-day"
                    value={weeklyDay}
                    onChange={(e) => setWeeklyDay(e.target.value)}
                    disabled={readOnly}
                  >
                    {WEEKDAY_OPTIONS.map((day) => (
                      <option key={day} value={day}>
                        {t(`schedule.days.${weekdayTranslationKey(day)}` as const)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="weekly-time">{t('dialog.time')}</Label>
                  <Input
                    id="weekly-time"
                    type="text"
                    inputMode="numeric"
                    placeholder={t('dialog.timePlaceholder')}
                    value={weeklyTime}
                    onChange={(e) => setWeeklyTime(sanitizeTimeInput(e.target.value))}
                    className={cn(timeInvalid && scheduleMode === 'weekly' && 'border-destructive focus-visible:ring-destructive')}
                    disabled={readOnly}
                  />
                </div>
              </div>
              )}

              {scheduleMode === 'monthly' && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="monthly-day">{t('dialog.monthDay')}</Label>
                  <Input
                    id="monthly-day"
                    type="number"
                    min={1}
                    max={31}
                    value={String(monthlyDay)}
                    onChange={(e) => setMonthlyDay(clampNumber(Number(e.target.value) || 1, 1, 31))}
                    disabled={readOnly}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="monthly-time">{t('dialog.time')}</Label>
                  <Input
                    id="monthly-time"
                    type="text"
                    inputMode="numeric"
                    placeholder={t('dialog.timePlaceholder')}
                    value={monthlyTime}
                    onChange={(e) => setMonthlyTime(sanitizeTimeInput(e.target.value))}
                    className={cn(timeInvalid && scheduleMode === 'monthly' && 'border-destructive focus-visible:ring-destructive')}
                    disabled={readOnly}
                  />
                </div>
              </div>
              )}

              {scheduleMode === 'custom' && (
                <div className="space-y-2">
                <Label htmlFor="custom-cron">{t('dialog.useCustomCron')}</Label>
                <Input
                  id="custom-cron"
                  value={customSchedule}
                  onChange={(e) => setCustomSchedule(e.target.value)}
                  placeholder={t('dialog.cronPlaceholder')}
                  className={cn("rounded-xl bg-card/80", cronInvalid && 'border-destructive focus-visible:ring-destructive')}
                  disabled={readOnly}
                />
                <p className="text-xs text-muted-foreground">{t('dialog.customCronHelp')}</p>
              </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {schedulePreview ? `${t('card.next')}: ${schedulePreview}` : t('dialog.cronPlaceholder')}
            </p>
            {cronInvalid && <p className="text-xs text-destructive">{t('toast.invalidCron')}</p>}
            {timeInvalid && <p className="text-xs text-destructive">{t('toast.invalidTime')}</p>}
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
  const [errorExpanded, setErrorExpanded] = useState(false);

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
    <Card className="rounded-[28px] border border-border/70 bg-card/92 shadow-[0_12px_40px_rgba(15,23,42,0.06)] transition-shadow">
      <CardContent className="space-y-4 p-5 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="truncate text-[28px] font-semibold tracking-[-0.03em] text-foreground">
                  {job.name}
                </h3>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className={cn(
                    'inline-flex items-center rounded-full px-3 py-1 text-[12px] font-semibold',
                    job.enabled
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-muted text-muted-foreground'
                  )}>
                    {job.enabled ? t('stats.active') : t('stats.paused')}
                  </span>
                  <span className={cn(
                    'inline-flex items-center rounded-full px-3 py-1 text-[12px] font-semibold',
                    isAdvancedJob
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      : 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                  )}>
                    {isAdvancedJob ? t('advanced.badge') : t('advanced.simpleBadge')}
                  </span>
                  {job.agentName && (
                    <span className="inline-flex items-center rounded-full bg-violet-500/15 px-3 py-1 text-[12px] font-semibold text-violet-700 dark:text-violet-300">
                      <Bot className="mr-1.5 h-3.5 w-3.5" />
                      {job.agentName}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex justify-end sm:justify-start">
                <Switch checked={job.enabled} onCheckedChange={onToggle} disabled={busy || triggering} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                {scheduleText}
              </span>
              {job.lastRun && (
                <span className="inline-flex items-center gap-1.5">
                  <History className="h-4 w-4" />
                  {t('card.last')}: {formatRelativeTime(job.lastRun.time)}
                  {job.lastRun.success ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                </span>
              )}
              {job.nextRun && job.enabled && (
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  {t('card.next')}: {new Date(job.nextRun).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onEdit}
          className="w-full rounded-[24px] border border-border/70 bg-muted/20 px-5 py-4 text-left transition-colors hover:bg-accent/40"
        >
          <p className="text-[15px] leading-7 text-foreground/88 line-clamp-2">{job.message}</p>
        </button>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {isAdvancedJob && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1">
              <AlertCircle className="h-3.5 w-3.5" />
              {t('advanced.readOnlyInline')}
            </span>
          )}

          {job.target && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/40 px-3 py-1">
              {CHANNEL_ICONS[job.target.channelType as ChannelType]}
              {job.target.channelName}
            </span>
          )}
        </div>

        {job.lastRun && !job.lastRun.success && job.lastRun.error && (
          <div className="flex items-start gap-3 rounded-[20px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className={cn('leading-6 whitespace-pre-wrap break-words', !errorExpanded && 'line-clamp-2')}>
                {job.lastRun.error}
              </p>
              <button
                type="button"
                className="mt-2 text-xs font-semibold text-destructive/90 underline-offset-4 hover:underline"
                onClick={() => setErrorExpanded((value) => !value)}
              >
                {errorExpanded ? t('card.collapseError', 'Collapse') : t('card.expandError', 'Expand')}
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-3 pt-1">
          <Button variant="outline" size="sm" onClick={handleTrigger} disabled={triggering || busy} className="h-12 rounded-[18px] px-5 text-sm">
            {triggering ? <LoadingIcon className="h-3.5 w-3.5 mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
            {t('card.runNow')}
          </Button>
          <Button variant="outline" size="sm" className="h-12 rounded-[18px] border-destructive/30 px-5 text-sm text-destructive hover:bg-destructive/10" onClick={onDelete} disabled={busy || triggering}>
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
