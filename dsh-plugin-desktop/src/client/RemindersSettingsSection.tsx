import { useEffect, useMemo, useState } from 'react'
// @ts-expect-error package subpath has no declaration file
import Pencil from 'lucide-react/dist/esm/icons/pencil.mjs'
// @ts-expect-error package subpath has no declaration file
import Plus from 'lucide-react/dist/esm/icons/plus.mjs'
// @ts-expect-error package subpath has no declaration file
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
// @ts-expect-error package subpath has no declaration file
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.mjs'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopReminder } from '../reminders-contract.ts'
import type { DesktopRemindersApi } from './reminders-api.ts'
import { SettingsIconButton, SettingsToggle } from './settings-controls.tsx'

export interface RemindersSettingsSectionInjected { readonly api: DesktopRemindersApi }
export type RemindersSettingsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'desktop.reminders'> & InjectFace<RemindersSettingsSectionInjected>

export function RemindersSettingsSection({ t, api }: RemindersSettingsSectionProps) {
  const [reminders, setReminders] = useState<readonly DesktopReminder[]>([])
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string>()
  const [editingText, setEditingText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const active = useMemo(() => reminders.filter(reminder => reminder.enabled).length, [reminders])
  const presets = useMemo(() => [t('privacy'), t('files'), t('mail'), t('approval'), t('external')], [t])
  const load = async (): Promise<void> => {
    setBusy(true); setError(undefined)
    try { setReminders((await api.read()).reminders) } catch { setError(t('loadFailed')) } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, []) // Initial settings-page snapshot.
  const run = async (action: () => Promise<{ readonly reminders: readonly DesktopReminder[] }>): Promise<void> => {
    setBusy(true); setError(undefined)
    try { setReminders((await action()).reminders) } catch { setError(t('operationFailed')) } finally { setBusy(false) }
  }
  const add = (text = draft): void => {
    const next = text.trim()
    if (next === '') return
    void run(async () => {
      const view = await api.create(next)
      setDraft('')
      return view
    })
  }
  return <section className="dshIntegrations dshReminders" aria-busy={busy}>
    <header className="dshIntegrationsHeader">
      <div><h2>{t('title')}</h2><p>{t('intro')}</p></div>
      <SettingsIconButton label={t('refresh')} disabled={busy} onClick={() => { void load() }}><RefreshCw /></SettingsIconButton>
    </header>
    <p className="dshRemindersNotice">{t('notice')}</p>
    {error !== undefined && <p className="dshIntegrationsError" role="alert">{error}</p>}
    <div className="dshRemindersGrid">
      <section className="dshRemindersPanel">
        <div className="dshRemindersPanelHeader"><h3>{t('add')}</h3><span>{t('active', { count: active })}</span></div>
        <textarea className="dshRemindersInput" value={draft} disabled={busy} placeholder={t('placeholder')} maxLength={4_000}
          onChange={event => { setDraft(event.target.value) }} />
        <div className="dshIntegrationsRowActions"><button type="button" className="dshIntegrationsCommand dshCronPrimary" disabled={busy || draft.trim() === ''} onClick={() => { add() }}><Plus />{t('add')}</button>
          <button type="button" className="dshIntegrationsCommand" disabled={busy || draft === ''} onClick={() => { setDraft('') }}>{t('clear')}</button></div>
        <h4>{t('presets')}</h4>
        <div className="dshRemindersPresets">{presets.map(preset => <button key={preset} type="button" disabled={busy || reminders.some(item => item.text === preset)} onClick={() => { add(preset) }}>+ {preset}</button>)}</div>
      </section>
      <section className="dshRemindersPanel">
        <div className="dshRemindersPanelHeader"><h3>{t('current')}</h3></div>
        <div className="dshRemindersList">
          {reminders.length === 0 ? <p className="dshIntegrationsEmpty">{t('empty')}</p> : reminders.map(reminder => {
            const isEditing = editing === reminder.id
            return <article className="dshRemindersRow" data-enabled={reminder.enabled} key={reminder.id}>
              <SettingsToggle label={reminder.enabled ? t('enabled') : t('paused')} checked={reminder.enabled} disabled={busy}
                onChange={enabled => { void run(() => api.toggle(reminder.id, enabled)) }} />
              <div className="dshRemindersBody">
                {isEditing ? <><textarea className="dshRemindersInput" value={editingText} disabled={busy} maxLength={4_000} onChange={event => { setEditingText(event.target.value) }} />
                  <div className="dshIntegrationsRowActions"><button type="button" className="dshIntegrationsCommand" disabled={busy || editingText.trim() === ''} onClick={() => { void run(async () => { const view = await api.update(reminder.id, editingText); setEditing(undefined); return view }) }}>{t('save')}</button>
                    <button type="button" className="dshIntegrationsCommand" disabled={busy} onClick={() => { setEditing(undefined) }}>{t('cancel')}</button></div></>
                  : <><span className="dshRemindersStatus">{reminder.enabled ? t('enabled') : t('paused')}</span><p>{reminder.text}</p></>}
              </div>
              {!isEditing && <div className="dshIntegrationsRowActions"><SettingsIconButton label={t('edit')} disabled={busy} onClick={() => { setEditing(reminder.id); setEditingText(reminder.text) }}><Pencil /></SettingsIconButton>
                <SettingsIconButton label={t('remove')} danger disabled={busy} onClick={() => { void run(() => api.remove(reminder.id)) }}><Trash2 /></SettingsIconButton></div>}
            </article>
          })}
        </div>
      </section>
    </div>
  </section>
}
