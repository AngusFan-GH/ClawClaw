import { useEffect, useId, useMemo, useRef, useState } from 'react'
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
  const inputId = useId()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const active = useMemo(() => reminders.filter(reminder => reminder.enabled).length, [reminders])
  const presets = useMemo(() => [
    { label: t('privacyLabel'), text: t('privacy') },
    { label: t('filesLabel'), text: t('files') },
    { label: t('mailLabel'), text: t('mail') },
    { label: t('approvalLabel'), text: t('approval') },
    { label: t('externalLabel'), text: t('external') },
  ], [t])
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
    {error !== undefined && <p className="dshIntegrationsError" role="alert">{error}</p>}
    {reminders.length > 0 && <section className="dshRemindersCollection">
      <div className="dshRemindersPanelHeader"><h3>{t('current')}</h3><span>{t('active', { count: active, total: reminders.length })}</span></div>
      <div className="dshRemindersList">
        {reminders.map(reminder => {
          const isEditing = editing === reminder.id
          return <article className="dshRemindersRow" data-enabled={reminder.enabled} key={reminder.id}>
            <SettingsToggle label={reminder.enabled ? t('enabled') : t('paused')} checked={reminder.enabled} disabled={busy}
              onChange={enabled => { void run(() => api.toggle(reminder.id, enabled)) }} />
            <div className="dshRemindersBody">
              {isEditing ? <><textarea className="dshRemindersInput" aria-label={t('edit')} value={editingText} disabled={busy} maxLength={4_000} onChange={event => { setEditingText(event.target.value) }} />
                <div className="dshIntegrationsRowActions"><button type="button" className="dshIntegrationsCommand" disabled={busy || editingText.trim() === ''} onClick={() => { void run(async () => { const view = await api.update(reminder.id, editingText); setEditing(undefined); return view }) }}>{t('save')}</button>
                  <button type="button" className="dshIntegrationsCommand" disabled={busy} onClick={() => { setEditing(undefined) }}>{t('cancel')}</button></div></>
                : <><span className="dshRemindersStatus">{reminder.enabled ? t('enabled') : t('paused')}</span><p>{reminder.text}</p></>}
            </div>
            {!isEditing && <div className="dshIntegrationsRowActions"><SettingsIconButton label={t('edit')} disabled={busy} onClick={() => { setEditing(reminder.id); setEditingText(reminder.text) }}><Pencil /></SettingsIconButton>
              <SettingsIconButton label={t('remove')} danger disabled={busy} onClick={() => { void run(() => api.remove(reminder.id)) }}><Trash2 /></SettingsIconButton></div>}
          </article>
        })}
      </div>
    </section>}
    <section className="dshRemindersPanel">
      <h3><label htmlFor={inputId}>{t('add')}</label></h3>
      <textarea id={inputId} ref={inputRef} className="dshRemindersInput" rows={3} value={draft} disabled={busy} placeholder={t('placeholder')} maxLength={4_000}
        onChange={event => { setDraft(event.target.value) }} />
      <div className="dshRemindersComposerActions">
        {draft !== '' && <button type="button" className="dshRemindersTextButton" disabled={busy} onClick={() => { setDraft(''); inputRef.current?.focus() }}>{t('clear')}</button>}
        <button type="button" className="dshIntegrationsCommand dshCronPrimary" disabled={busy || draft.trim() === ''} onClick={() => { add() }}><Plus aria-hidden="true" />{t('add')}</button>
      </div>
      <div className="dshRemindersSuggestions">
        <h4>{t('presets')}</h4>
        <p>{t('presetsHint')}</p>
        <div className="dshRemindersPresets">{presets.map(preset => {
          const added = reminders.some(item => item.text === preset.text)
          const next = draft.trim() === '' ? preset.text : `${draft.trimEnd()}\n${preset.text}`
          return <button key={preset.text} type="button" title={preset.text} disabled={busy || added || next.length > 4_000} onClick={() => { setDraft(next); inputRef.current?.focus() }}>
            <Plus aria-hidden="true" />{preset.label}{added && <span>{t('added')}</span>}
          </button>
        })}</div>
      </div>
    </section>
    <details className="dshManagementHelp"><summary>{t('usage')}</summary><p>{t('notice')}</p></details>
  </section>
}
