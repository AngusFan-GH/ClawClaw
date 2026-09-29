/** Scheduled task management page in the standard Settings shell. */

import { useEffect, useMemo, useState, type FormEvent } from 'react'
// @ts-expect-error package subpath has no declaration file
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.mjs'
// @ts-expect-error package subpath has no declaration file
import Check from 'lucide-react/dist/esm/icons/check.mjs'
// @ts-expect-error package subpath has no declaration file
import Clock3 from 'lucide-react/dist/esm/icons/clock-3.mjs'
// @ts-expect-error package subpath has no declaration file
import Minus from 'lucide-react/dist/esm/icons/minus.mjs'
// @ts-expect-error package subpath has no declaration file
import MoreHorizontal from 'lucide-react/dist/esm/icons/ellipsis.mjs'
// @ts-expect-error package subpath has no declaration file
import MessageSquare from 'lucide-react/dist/esm/icons/message-square.mjs'
// @ts-expect-error package subpath has no declaration file
import Plus from 'lucide-react/dist/esm/icons/plus.mjs'
// @ts-expect-error package subpath has no declaration file
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
// @ts-expect-error package subpath has no declaration file
import Search from 'lucide-react/dist/esm/icons/search.mjs'
// @ts-expect-error package subpath has no declaration file
import X from 'lucide-react/dist/esm/icons/x.mjs'
import { IconChevronDownOutlineMedium, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CronTaskInputView, CronTaskPolicyView, CronTaskRunView, CronTaskView, CronTasksApi, CronTaskWorkspaceView } from './cron-tasks-api.ts'
import { friendlyCronExpression, localDateTimeInput, parseFriendlyCronSchedule,
  type CronIntervalUnit, type CronScheduleMode } from './cron-form-schedule.ts'
import { SettingsIconButton } from './settings-controls.tsx'

export interface CronTasksSettingsInjected {
  readonly api: CronTasksApi
  readonly localeId: () => string
  readonly openSession: (taskId: string, sessionId: string) => Promise<void>
}
export type CronTasksSettingsProps = PropsRuntime<'settings.section'> & PropsLocale<'desktop.cron-tasks'> & InjectFace<CronTasksSettingsInjected>
interface Draft extends CronTaskInputView {
  readonly id?: string
  enabled: boolean
  scheduleMode: CronScheduleMode
  time: string
  weekdays: readonly string[]
  interval: number
  intervalUnit: CronIntervalUnit
  oneTimeLocal: string
}
const WEEKDAYS = ['1', '2', '3', '4', '5', '6', '0'] as const
const SCHEDULE_MODES = ['once', 'daily', 'weekdays', 'weekends', 'weekly', 'interval', 'custom'] as const
const HOURS = Array.from({ length: 24 }, (_, value) => String(value).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, value) => String(value).padStart(2, '0'))

function emptyDraft(): Draft {
  return { name: '', prompt: '', expression: '0 9 * * 1-5', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    workspaceId: '', enabled: true, scheduleMode: 'weekdays', time: '09:00', weekdays: ['1'], interval: 30,
    intervalUnit: 'minutes', oneTimeLocal: localDateTimeInput() }
}
function intlLocale(localeId: string): string { return localeId === 'zh' ? 'zh-CN' : localeId }
function localDate(value: string | null | undefined, localeId: string): string {
  return value === null || value === undefined ? '—' : new Date(value).toLocaleString(intlLocale(localeId), { dateStyle: 'medium', timeStyle: 'short' })
}
function duration(start: string, finish: string, t: CronTasksSettingsProps['t']): string {
  const seconds = Math.max(0, Math.round((Date.parse(finish) - Date.parse(start)) / 1000))
  return seconds < 60
    ? t('durationSeconds').replace('{seconds}', String(seconds))
    : t('durationMinutes').replace('{minutes}', String(Math.floor(seconds / 60))).replace('{seconds}', String(seconds % 60))
}
function draftInput(draft: Draft): CronTaskInputView {
  return { name: draft.name || 'Preview', prompt: draft.prompt || 'Preview', expression: draft.expression,
    timeZone: draft.timeZone, ...(draft.workspaceId?.trim() ? { workspaceId: draft.workspaceId.trim() } : {}),
    ...(draft.scheduleMode === 'once' && draft.oneTimeLocal ? { oneTimeAt: new Date(draft.oneTimeLocal).toISOString() } : {}),
    enabled: draft.enabled }
}

function TimeSegment({ label, value, options, onChange }: {
  readonly label: string
  readonly value: string
  readonly options: readonly string[]
  readonly onChange: (value: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  return <Menu className="dshCronTimeSegmentRoot" open={open} onClose={() => { setOpen(false) }} side="top" compact selectedId={value}
    items={options.map(option => ({ id: option, label: option }))}
    onSelect={next => { onChange(next); setOpen(false) }}
    anchor={<button className="dshCronTimeSegment" type="button" aria-label={label} aria-haspopup="menu"
      aria-expanded={open} onClick={() => { setOpen(current => !current) }}><span>{value}</span><IconChevronDownOutlineMedium /></button>} />
}

export function CronTimePicker({ value, label, hourLabel, minuteLabel, onChange }: {
  readonly value: string
  readonly label: string
  readonly hourLabel: string
  readonly minuteLabel: string
  readonly onChange: (value: string) => void
}): JSX.Element {
  const [hour = '00', minute = '00'] = value.split(':')
  return <div className="dshCronTimePicker" role="group" aria-label={label}>
    <TimeSegment label={hourLabel} value={hour} options={HOURS} onChange={next => { onChange(`${next}:${minute}`) }} />
    <span aria-hidden="true">:</span>
    <TimeSegment label={minuteLabel} value={minute} options={MINUTES} onChange={next => { onChange(`${hour}:${next}`) }} />
    <Clock3 aria-hidden="true" />
  </div>
}

export async function openCronRunSession(
  openSession: CronTasksSettingsInjected['openSession'],
  close: () => void,
  taskId: string,
  sessionId: string,
): Promise<void> {
  await openSession(taskId, sessionId)
  close()
}

export function CronTasksSettingsSection({ t, api, localeId, openSession, close }: CronTasksSettingsProps): JSX.Element {
  const activeLocale = localeId()
  const [jobs, setJobs] = useState<readonly CronTaskView[]>([])
  const [running, setRunning] = useState<readonly string[]>([])
  const [archivedSessionIds, setArchivedSessionIds] = useState<readonly string[]>([])
  const [workspaces, setWorkspaces] = useState<readonly CronTaskWorkspaceView[]>([])
  const [defaultWorkspaceId, setDefaultWorkspaceId] = useState<string | null>(null)
  const [policy, setPolicy] = useState<CronTaskPolicyView>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [draft, setDraft] = useState<Draft>()
  const [detailId, setDetailId] = useState<string>()
  const [openMenuId, setOpenMenuId] = useState<string>()
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<readonly string[]>([])
  const [previewError, setPreviewError] = useState<string>()

  const refresh = async (): Promise<void> => {
    setLoading(true); setError(undefined)
    try { const view = await api.read(); setJobs(view.jobs); setRunning(view.running); setArchivedSessionIds(view.archivedSessionIds); setWorkspaces(view.workspaces); setDefaultWorkspaceId(view.defaultWorkspaceId); setPolicy(view.policy) }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('operationFailed')) }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    const timer = window.setInterval(() => {
      void api.read().then(view => {
        setJobs(view.jobs); setRunning(view.running); setArchivedSessionIds(view.archivedSessionIds); setWorkspaces(view.workspaces)
        setDefaultWorkspaceId(view.defaultWorkspaceId); setPolicy(view.policy)
      }).catch(() => {})
    }, 5_000)
    return () => { window.clearInterval(timer) }
  }, [api])
  useEffect(() => {
    if (openMenuId === undefined) return
    const closeOnOutsideClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element) || target.closest('.dshCronMore') === null) setOpenMenuId(undefined)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenMenuId(undefined)
    }
    document.addEventListener('click', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('click', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openMenuId])
  useEffect(() => {
    if (draft === undefined) { setPreview([]); setPreviewError(undefined); return }
    let current = true
    const timer = window.setTimeout(() => {
      try {
        void api.action({ action: 'preview', input: draftInput(draft) }).then(value => {
          if (!current) return
          const occurrences = typeof value === 'object' && value !== null && 'occurrences' in value
            && Array.isArray(value.occurrences) ? value.occurrences.filter(item => typeof item === 'string') : []
          setPreview(occurrences); setPreviewError(undefined)
        }, cause => { if (current) { setPreview([]); setPreviewError(cause instanceof Error ? cause.message : t('invalidSchedule')) } })
      } catch (cause) { setPreview([]); setPreviewError(cause instanceof Error ? cause.message : t('invalidSchedule')) }
    }, 250)
    return () => { current = false; window.clearTimeout(timer) }
  }, [draft?.expression, draft?.oneTimeLocal, draft?.scheduleMode, draft?.timeZone])

  const perform = async (key: string, action: () => Promise<void>): Promise<void> => {
    setBusy(key); setError(undefined)
    try { await action(); const view = await api.read(); setJobs(view.jobs); setRunning(view.running); setArchivedSessionIds(view.archivedSessionIds); setWorkspaces(view.workspaces); setDefaultWorkspaceId(view.defaultWorkspaceId); setPolicy(view.policy) }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('operationFailed')) }
    finally { setBusy(undefined) }
  }
  const openRunSession = async (taskId: string, sessionId: string): Promise<void> => {
    setBusy(`open:${sessionId}`); setError(undefined)
    try {
      await openCronRunSession(openSession, close, taskId, sessionId)
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('operationFailed')) }
    finally { setBusy(undefined) }
  }
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (draft === undefined || previewError !== undefined) return
    const input = draftInput(draft)
    void perform('save', async () => {
      await api.action(draft.id === undefined ? { action: 'create', input } : { action: 'update', id: draft.id, input })
      setDraft(undefined)
    })
  }
  const openEdit = (job: CronTaskView): void => {
    const schedule = parseFriendlyCronSchedule(job.expression)
    setDetailId(undefined)
    setDraft({ id: job.id, name: job.name, prompt: job.prompt, expression: job.expression,
      ...(job.oneTimeAt === undefined ? {} : { oneTimeAt: job.oneTimeAt }),
      timeZone: job.timeZone, workspaceId: job.workspaceId ?? '', enabled: job.enabled,
      scheduleMode: job.oneTimeAt === undefined ? schedule.mode : 'once', time: schedule.time, weekdays: schedule.weekdays,
      interval: schedule.interval, intervalUnit: schedule.intervalUnit,
      oneTimeLocal: job.oneTimeAt === undefined ? localDateTimeInput() : localDateTimeInput(new Date(job.oneTimeAt)) })
  }
  const setFriendlySchedule = (patch: Partial<Pick<Draft, 'scheduleMode' | 'time' | 'weekdays' | 'interval' | 'intervalUnit'>>): void => {
    if (draft === undefined) return
    const next = { ...draft, ...patch }
    if (next.scheduleMode === 'custom' || next.scheduleMode === 'once') { setDraft(next); return }
    try { setDraft({ ...next, expression: friendlyCronExpression({ mode: next.scheduleMode, time: next.time,
      weekdays: next.weekdays, interval: next.interval, intervalUnit: next.intervalUnit }) }) } catch { setDraft(next) }
  }
  const toggleWeekday = (weekday: string): void => {
    if (draft === undefined) return
    const weekdays = draft.weekdays.includes(weekday) ? draft.weekdays.filter(value => value !== weekday) : [...draft.weekdays, weekday]
    setFriendlySchedule({ weekdays })
  }
  const scheduleLabel = (job: Pick<CronTaskView, 'expression' | 'oneTimeAt'>): string => {
    if (job.oneTimeAt !== undefined) return `${t('once')} · ${localDate(job.oneTimeAt, activeLocale)}`
    const schedule = parseFriendlyCronSchedule(job.expression)
    if (schedule.mode === 'custom') return job.expression
    if (schedule.mode === 'interval') return `${t('every')} ${schedule.interval} ${t(schedule.intervalUnit)}`
    const days = schedule.mode === 'weekly'
      ? ` · ${new Intl.ListFormat(intlLocale(activeLocale), { style: 'short', type: 'conjunction' }).format(schedule.weekdays.map(day => t(`weekday${day}` as 'weekday0')))}`
      : ''
    return `${t(schedule.mode)}${days} · ${schedule.time}`
  }
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return normalized ? jobs.filter(job => `${job.name}\n${job.prompt}`.toLocaleLowerCase().includes(normalized)) : jobs
  }, [jobs, query])
  const detail = detailId === undefined ? undefined : jobs.find(job => job.id === detailId)
  const defaultWorkspace = workspaces.find(workspace => workspace.id === defaultWorkspaceId)
  const workspaceLabel = (job: Pick<CronTaskView, 'workspaceId'>): string => {
    const id = job.workspaceId ?? defaultWorkspaceId
    const workspace = workspaces.find(item => item.id === id)
    return workspace === undefined ? t('missingWorkspace') : `${workspace.title} · ${workspace.path}`
  }
  const runStatusLabel = (run: CronTaskRunView): string => t(run.status)
  const sessionArchived = (sessionId: string | undefined): boolean => sessionId !== undefined && archivedSessionIds.includes(sessionId)

  if (draft !== undefined) return <section className="dshIntegrations dshCronTasks" aria-label={t('title')}>
    <header className="dshCronSubHeader"><button className="dshCronBack" type="button" onClick={() => { setDraft(undefined) }}><ArrowLeft />{t('backToList')}</button><h2>{draft.id === undefined ? t('add') : t('editTask')}</h2></header>
    {error !== undefined && <div className="dshIntegrationsError" role="alert">{error}</div>}
    <form className="dshCronEditor" onSubmit={submit}>
      <div className="dshCronFormSection"><h3>{t('basicInfo')}</h3>
        <label>{t('name')}<input required maxLength={120} autoFocus value={draft.name} onChange={event => { setDraft({ ...draft, name: event.target.value }) }} /></label>
        <label>{t('prompt')}<textarea required maxLength={16000} rows={5} placeholder={t('promptPlaceholder')} value={draft.prompt} onChange={event => { setDraft({ ...draft, prompt: event.target.value }) }} /></label>
      </div>
      <fieldset className="dshCronScheduleBuilder"><legend>{t('schedule')}</legend>
        <div className="dshCronScheduleChoices" role="group" aria-label={t('frequency')}>
          {SCHEDULE_MODES.map(mode => <button key={mode} type="button" aria-pressed={draft.scheduleMode === mode} onClick={() => { setFriendlySchedule({ scheduleMode: mode }) }}>{t(mode)}</button>)}
        </div>
        {draft.scheduleMode === 'once' && <div className="dshCronField dshCronNarrowField"><span>{t('runDateTime')}</span><div className="dshCronDateTimeFields"><input type="date" aria-label={t('date')} required value={draft.oneTimeLocal.slice(0, 10)} min={localDateTimeInput(new Date()).slice(0, 10)} onChange={event => { setDraft({ ...draft, oneTimeLocal: `${event.target.value}T${draft.oneTimeLocal.slice(11, 16) || '09:00'}` }) }} /><CronTimePicker value={draft.oneTimeLocal.slice(11, 16) || '09:00'} label={t('runAt')} hourLabel={t('hour')} minuteLabel={t('minute')} onChange={time => { setDraft({ ...draft, oneTimeLocal: `${draft.oneTimeLocal.slice(0, 10)}T${time}` }) }} /></div></div>}
        {['daily', 'weekdays', 'weekends', 'weekly'].includes(draft.scheduleMode) && <div className="dshCronFriendlyFields">
          <div className="dshCronField"><span>{t('runAt')}</span><CronTimePicker value={draft.time} label={t('runAt')} hourLabel={t('hour')} minuteLabel={t('minute')} onChange={time => { setFriendlySchedule({ time }) }} /></div>
        </div>}
        {draft.scheduleMode === 'weekly' && <div><span className="dshCronFieldLabel">{t('chooseWeekdays')}</span><div className="dshCronWeekdays" role="group" aria-label={t('chooseWeekdays')}>
          {WEEKDAYS.map(day => <button key={day} type="button" aria-pressed={draft.weekdays.includes(day)} onClick={() => { toggleWeekday(day) }}>{t(`weekdayShort${day}` as 'weekdayShort0')}</button>)}
        </div></div>}
        {draft.scheduleMode === 'interval' && <div className="dshCronInterval"><span>{t('every')}</span><input type="number" min={1} max={draft.intervalUnit === 'minutes' ? 59 : 23} value={draft.interval} onChange={event => { setFriendlySchedule({ interval: Number(event.target.value) }) }} /><select value={draft.intervalUnit} onChange={event => { setFriendlySchedule({ intervalUnit: event.target.value as CronIntervalUnit }) }}><option value="minutes">{t('minutes')}</option><option value="hours">{t('hours')}</option></select></div>}
        <div className="dshCronPreview" data-error={previewError !== undefined}><strong>{t('nextRunPreview')}</strong>{previewError !== undefined
          ? <span>{t('invalidSchedule')}</span>
          : preview.length === 0 ? <span>{t('calculating')}</span> : <span>{preview.map(value => localDate(value, activeLocale)).join(' · ')}</span>}</div>
      </fieldset>
      <details className="dshCronAdvanced" open={draft.scheduleMode === 'custom'}><summary>{t('advanced')}</summary>
        <div className="dshCronFields"><label>{t('expression')}<input required maxLength={256} disabled={draft.scheduleMode === 'once'} placeholder="0 9 * * 1-5" value={draft.expression} onChange={event => { setDraft({ ...draft, expression: event.target.value, scheduleMode: 'custom' }) }} /></label>
          <label>{t('timeZone')}<input required list="dsh-cron-timezones" value={draft.timeZone} onChange={event => { setDraft({ ...draft, timeZone: event.target.value }) }} /><datalist id="dsh-cron-timezones"><option value="Asia/Shanghai" /><option value="UTC" /><option value="America/New_York" /><option value="Europe/London" /><option value="Asia/Tokyo" /></datalist></label>
          <label>{t('workspace')}<select value={draft.workspaceId ?? ''} onChange={event => { setDraft({ ...draft, workspaceId: event.target.value }) }}><option value="">{defaultWorkspace === undefined ? t('defaultWorkspace') : `${t('defaultWorkspace')} · ${defaultWorkspace.title}`}</option>{draft.workspaceId && !workspaces.some(workspace => workspace.id === draft.workspaceId) ? <option value={draft.workspaceId}>{t('missingWorkspace')}</option> : null}{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.title} · {workspace.path}</option>)}</select></label></div>
        {draft.scheduleMode === 'custom' && <p className="dshCronHelp">{t('scheduleHelp')}</p>}
      </details>
      <div className="dshCronEditorFooter"><label className="dshCronEnabled"><input type="checkbox" checked={draft.enabled} onChange={event => { setDraft({ ...draft, enabled: event.target.checked }) }} />{t('enabledAfterSave')}</label><div className="dshIntegrationsRowActions"><button className="dshIntegrationsCommand" disabled={busy !== undefined || previewError !== undefined} type="submit">{busy === 'save' ? t('saving') : t('save')}</button><button className="dshIntegrationsCommand" disabled={busy !== undefined} type="button" onClick={() => { setDraft(undefined) }}>{t('cancel')}</button></div></div>
    </form>
  </section>

  if (detail !== undefined) return <section className="dshIntegrations dshCronTasks" aria-label={t('title')}>
    <header className="dshCronSubHeader"><button className="dshCronBack" type="button" onClick={() => { setDetailId(undefined) }}><ArrowLeft />{t('backToList')}</button><div className="dshIntegrationsRowActions">{detail.activeSessionId !== undefined && !sessionArchived(detail.activeSessionId) && <button className="dshIntegrationsCommand" type="button" disabled={busy !== undefined} onClick={() => { void openRunSession(detail.id, detail.activeSessionId as string) }}><MessageSquare />{t('openTaskSession')}</button>}{running.includes(detail.id) && <button className="dshIntegrationsCommand dshCronDanger" type="button" disabled={busy !== undefined} onClick={() => { if (window.confirm(t('confirmCancel'))) void perform(`cancel:${detail.id}`, async () => { await api.action({ action: 'cancel', id: detail.id }) }) }}>{busy === `cancel:${detail.id}` ? t('cancelling') : t('cancelRun')}</button>}<button className="dshIntegrationsCommand" type="button" disabled={running.includes(detail.id)} onClick={() => { openEdit(detail) }}>{t('edit')}</button></div></header>
    <article className="dshCronDetail"><div className="dshCronDetailTitle"><span className="dshCronStatusDot" data-enabled={detail.enabled} /><div><h2>{detail.name}</h2><p>{detail.enabled ? t('enabled') : t('disabled')}</p></div></div>
      <dl><div><dt>{t('schedule')}</dt><dd>{scheduleLabel(detail)}</dd></div><div><dt>{t('nextRun')}</dt><dd>{localDate(detail.nextRunAt, activeLocale)}</dd></div><div><dt>{t('timeZone')}</dt><dd>{detail.timeZone}</dd></div><div><dt>{t('workspace')}</dt><dd>{workspaceLabel(detail)}</dd></div><div><dt>{t('taskSession')}</dt><dd>{detail.activeSessionId === undefined ? t('sessionPending') : sessionArchived(detail.activeSessionId) ? t('sessionArchivedNextRun') : t('sessionContinuous')}</dd></div><div><dt>{t('executionPolicy')}</dt><dd>{policy === undefined ? '—' : t('policySummary').replace('{minutes}', String(policy.timeoutMinutes))}</dd></div><div><dt>{t('prompt')}</dt><dd className="dshCronDetailPrompt">{detail.prompt}</dd></div></dl>
      <section className="dshCronHistoryPanel"><h3>{t('history')}</h3>{detail.history.length === 0 ? <p className="dshCronMuted">{t('noRun')}</p> : <ol>{detail.history.map((run, index) => <li key={`${run.startedAt}-${String(index)}`}><span className="dshCronRunStatus" data-status={run.status}>{run.status === 'completed' ? <Check /> : run.status === 'skipped' ? <Minus /> : <X />}</span><div><strong>{runStatusLabel(run)}</strong><p>{localDate(run.finishedAt, activeLocale)} · {duration(run.startedAt, run.finishedAt, t)}</p>{run.error !== undefined && <p className="dshCronHistoryError">{run.error}</p>}{run.sessionId !== undefined && (sessionArchived(run.sessionId) ? <span className="dshCronArchivedSession">{t('archivedSession')}</span> : <button className="dshCronOpenSession" type="button" disabled={busy !== undefined} onClick={() => { void openRunSession(detail.id, run.sessionId as string) }}>{t('openSession')}</button>)}</div></li>)}</ol>}</section>
    </article>
  </section>

  const enabledCount = jobs.filter(job => job.enabled).length
  return <section className="dshIntegrations dshCronTasks" aria-label={t('title')}>
    <header className="dshIntegrationsHeader"><div><h2>{t('title')}</h2><p>{t('intro')}</p></div><button className="dshIntegrationsCommand dshCronPrimary" type="button" disabled={busy !== undefined} onClick={() => { setDraft(emptyDraft()) }}><Plus />{t('add')}</button></header>
    <div className="dshCronPolicyNotice">{t('hostRequired')}</div>
    {error !== undefined && <div className="dshIntegrationsError" role="alert">{error}</div>}
    {jobs.length > 0 && <div className="dshCronToolbar"><div className="dshIntegrationsSearch"><Search aria-hidden="true" /><input aria-label={t('search')} placeholder={t('searchPlaceholder')} value={query} onChange={event => { setQuery(event.target.value) }} /></div><p>{t('taskCount').replace('{total}', String(jobs.length)).replace('{enabled}', String(enabledCount))}</p><SettingsIconButton label={t('refresh')} disabled={loading || busy !== undefined} onClick={() => { void refresh() }}><RefreshCw /></SettingsIconButton></div>}
    {loading && jobs.length === 0 ? <p className="dshIntegrationsEmpty">{t('loading')}</p> : jobs.length === 0
      ? <div className="dshCronEmpty"><Clock3 aria-hidden="true" /><h3>{t('empty')}</h3><p>{t('emptyHint')}</p><button className="dshIntegrationsCommand" type="button" onClick={() => { setDraft(emptyDraft()) }}><Plus />{t('addFirst')}</button></div>
      : filtered.length === 0 ? <p className="dshIntegrationsEmpty">{t('noSearchResults')}</p>
      : <div className="dshCronList">{filtered.map(job => <article className="dshCronRow" key={job.id}>
        <span className="dshCronStatusDot" data-enabled={job.enabled} /><button className="dshCronMain" type="button" onClick={() => { setDetailId(job.id) }}><span className="dshCronTitle"><strong>{job.name}</strong>{running.includes(job.id) && <em>{t('running')}</em>}</span><span className="dshCronSchedule">{scheduleLabel(job)}</span><span className="dshCronNext"><b>{t('nextRun')}</b> {localDate(job.nextRunAt, activeLocale)}</span></button>
        <div className="dshIntegrationsRowActions">{running.includes(job.id) ? <button className="dshIntegrationsCommand dshCronDanger" type="button" disabled={busy !== undefined} onClick={() => { if (window.confirm(t('confirmCancel'))) void perform(`cancel:${job.id}`, async () => { await api.action({ action: 'cancel', id: job.id }) }) }}>{busy === `cancel:${job.id}` ? t('cancelling') : t('cancelRun')}</button> : <button className="dshIntegrationsCommand" type="button" disabled={busy !== undefined || !job.enabled} onClick={() => { void perform(`run:${job.id}`, async () => { await api.action({ action: 'run', id: job.id }) }) }}>{busy === `run:${job.id}` ? t('running') : t('run')}</button>}<button className="dshIntegrationsCommand" type="button" disabled={busy !== undefined || running.includes(job.id)} onClick={() => { openEdit(job) }}>{t('edit')}</button><div className="dshCronMore"><button className="dshCronMoreTrigger" type="button" aria-label={t('more')} title={t('more')} aria-haspopup="menu" aria-expanded={openMenuId === job.id} onClick={() => { setOpenMenuId(current => current === job.id ? undefined : job.id) }}><MoreHorizontal aria-hidden="true" /></button>{openMenuId === job.id && <div className="dshCronMoreMenu" role="menu"><button role="menuitem" type="button" disabled={busy !== undefined || running.includes(job.id)} onClick={() => { setOpenMenuId(undefined); void perform(`toggle:${job.id}`, async () => { await api.action({ action: 'toggle', id: job.id, enabled: !job.enabled }) }) }}>{job.enabled ? t('disable') : t('enable')}</button><button className="dshCronDanger" role="menuitem" type="button" disabled={busy !== undefined || running.includes(job.id)} onClick={() => { setOpenMenuId(undefined); if (window.confirm(t('confirmDelete'))) void perform(`delete:${job.id}`, async () => { await api.action({ action: 'delete', id: job.id }) }) }}>{t('delete')}</button></div>}</div></div>
      </article>)}</div>}
  </section>
}
