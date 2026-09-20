/** Desktop Settings surface dedicated to Skills. */

import { type FormEvent, useEffect, useMemo, useState } from 'react'
// @ts-expect-error package subpath has no declaration file
import FileUp from 'lucide-react/dist/esm/icons/file-up.mjs'
// @ts-expect-error package subpath has no declaration file
import Pencil from 'lucide-react/dist/esm/icons/pencil.mjs'
// @ts-expect-error package subpath has no declaration file
import Plus from 'lucide-react/dist/esm/icons/plus.mjs'
// @ts-expect-error package subpath has no declaration file
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
// @ts-expect-error package subpath has no declaration file
import Search from 'lucide-react/dist/esm/icons/search.mjs'
// @ts-expect-error package subpath has no declaration file
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.mjs'
// @ts-expect-error package subpath has no declaration file
import X from 'lucide-react/dist/esm/icons/x.mjs'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopRecycledSkill, DesktopSkillDetail, DesktopSkillInput, DesktopSkillView } from '../skills-contract.ts'
import type { DesktopSkillsApi } from './skills-api.ts'
import { SettingsIconButton, SettingsToggle } from './settings-controls.tsx'

export interface SkillsSettingsSectionInjected { readonly api: DesktopSkillsApi }
export type SkillsSettingsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'desktop.skills'> & InjectFace<SkillsSettingsSectionInjected>
type SkillDraft = DesktopSkillInput & { readonly mode: 'create' | 'edit' }

const EMPTY_DRAFT: SkillDraft = { mode: 'create', name: '', description: '', whenToUse: '', instructions: '' }
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

export function SkillsSettingsSection({ t, api }: SkillsSettingsSectionProps) {
  const [skills, setSkills] = useState<readonly DesktopSkillView[]>([])
  const [recycled, setRecycled] = useState<readonly DesktopRecycledSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<DesktopSkillDetail>()
  const [expandedName, setExpandedName] = useState<string>()
  const [draft, setDraft] = useState<SkillDraft>()
  const [importText, setImportText] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [recycleConfirmName, setRecycleConfirmName] = useState<string>()

  const applyView = (view: Awaited<ReturnType<DesktopSkillsApi['readView']>>): void => { setSkills(view.skills); setRecycled(view.recycled) }
  const sourceLabel = (source: string): string => {
    if (source === 'user-dsh') return t('sourceUserDsh')
    if (source === 'user-agents') return t('sourceUserAgents')
    if (source === 'bundled' || source === 'global') return t('sourceBundled')
    if (source.startsWith('plugin')) return t('sourcePlugin')
    return t('sourceOther')
  }
  const load = async (): Promise<void> => {
    setLoading(true); setError(undefined)
    try { applyView(await api.readView()) } catch (cause) { setError(cause instanceof Error ? cause.message : t('unavailable')) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (detail === undefined && draft === undefined) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (draft !== undefined) setDraft(undefined)
      else setDetail(undefined)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('keydown', closeOnEscape) }
  }, [detail, draft])

  const run = async (key: string, operation: () => Promise<void>): Promise<void> => {
    setBusy(key); setError(undefined)
    try { await operation() } catch (cause) { setError(cause instanceof Error ? cause.message : t('operationFailed')) }
    finally { setBusy(undefined) }
  }
  const saveDraft = (event: FormEvent): void => {
    event.preventDefault()
    if (draft === undefined) return
    void run(`skill-${draft.mode}:${draft.name}`, async () => {
      const whenToUse = draft.whenToUse?.trim()
      const input: DesktopSkillInput = { name: draft.name.trim(), description: draft.description.trim(),
        ...(whenToUse === undefined || whenToUse === '' ? {} : { whenToUse }), instructions: draft.instructions.trim() }
      applyView(draft.mode === 'create' ? await api.create(input) : await api.update(draft.name, input))
      setDraft(undefined); setDetail(undefined)
    })
  }
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return query === '' ? skills : skills.filter(skill => `${skill.name}\n${skill.description}\n${skill.whenToUse ?? ''}\n${sourceLabel(skill.source)}`.toLocaleLowerCase().includes(query))
  }, [search, skills])
  const grouped = useMemo(() => {
    const groups = new Map<string, DesktopSkillView[]>()
    for (const skill of filtered) groups.set(skill.source, [...(groups.get(skill.source) ?? []), skill])
    return [...groups.entries()]
  }, [filtered])
  const draftValid = draft !== undefined && SKILL_NAME.test(draft.name.trim()) && draft.description.trim() !== '' && draft.instructions.trim() !== ''

  return <section className="dshIntegrations" aria-label={t('title')}>
    <header className="dshIntegrationsHeader"><div><h2>{t('title')}</h2><p>{t('intro')}</p></div>
      <div className="dshIntegrationsRowActions"><button type="button" className="dshIntegrationsCommand dshCronPrimary" disabled={busy !== undefined} onClick={() => { setDraft({ ...EMPTY_DRAFT }); setImportOpen(false); setDetail(undefined) }}><Plus />{t('newSkill')}</button>
        <button type="button" className="dshIntegrationsCommand" disabled={busy !== undefined} onClick={() => { setImportOpen(!importOpen); setDraft(undefined) }}><FileUp />{t('importRaw')}</button>
        <SettingsIconButton label={t('refresh')} disabled={loading || busy !== undefined} onClick={() => { void load() }}><RefreshCw /></SettingsIconButton></div></header>
    {error !== undefined && <div className="dshIntegrationsError" role="alert">{error}</div>}
    {draft !== undefined && <form className="dshIntegrationsEditor dshSkillsEditor" onSubmit={saveDraft}>
      <div className="dshIntegrationsEditorHeader"><div><h3>{t(draft.mode === 'create' ? 'newSkill' : 'editSkill')}</h3><p>{t(draft.mode === 'create' ? 'createHint' : 'editHint')}</p></div>
        <SettingsIconButton label={t('cancel')} onClick={() => { setDraft(undefined) }}><X /></SettingsIconButton></div>
      <label>{t('name')}<input required maxLength={128} disabled={draft.mode === 'edit'} value={draft.name} placeholder={t('namePlaceholder')} onChange={event => { setDraft({ ...draft, name: event.target.value }) }} />
        <span className="dshSkillsFieldHint">{t('nameHint')}</span></label>
      <label>{t('description')}<textarea required maxLength={4000} rows={2} value={draft.description} placeholder={t('descriptionPlaceholder')} onChange={event => { setDraft({ ...draft, description: event.target.value }) }} /></label>
      <label>{t('whenToUse')}<textarea maxLength={4000} rows={2} value={draft.whenToUse ?? ''} placeholder={t('whenToUsePlaceholder')} onChange={event => { setDraft({ ...draft, whenToUse: event.target.value }) }} /></label>
      <label>{t('instructions')}<textarea required maxLength={240000} rows={10} value={draft.instructions} placeholder={t('instructionsPlaceholder')} onChange={event => { setDraft({ ...draft, instructions: event.target.value }) }} /></label>
      <div className="dshIntegrationsEditorFooter"><span /><div className="dshIntegrationsRowActions"><button type="button" className="dshIntegrationsCommand" disabled={busy !== undefined} onClick={() => { setDraft(undefined) }}>{t('cancel')}</button>
        <button type="submit" className="dshIntegrationsCommand dshCronPrimary" disabled={busy !== undefined || !draftValid}>{t(draft.mode === 'create' ? 'create' : 'save')}</button></div></div>
    </form>}
    {importOpen && <div className="dshIntegrationsImport"><div className="dshIntegrationsEditorHeader"><div><h3>{t('importSkill')}</h3><p>{t('importHint')}</p></div><SettingsIconButton label={t('cancel')} onClick={() => { setImportOpen(false); setImportText('') }}><X /></SettingsIconButton></div>
      <label>{t('rawDocument')}<textarea rows={10} value={importText} onChange={event => { setImportText(event.target.value) }} placeholder={t('importPlaceholder')} /></label>
      <div className="dshIntegrationsEditorFooter"><span /><button type="button" className="dshIntegrationsCommand dshCronPrimary" disabled={busy !== undefined || importText.trim() === ''} onClick={() => { void run('skill-import', async () => { applyView(await api.importDocument(importText)); setImportText(''); setImportOpen(false) }) }}>{t('import')}</button></div></div>}
    {loading && skills.length === 0 ? <p className="dshIntegrationsEmpty">{t('loading')}</p> : <div className="dshIntegrationsBody">
      <label className="dshIntegrationsSearch"><Search aria-hidden="true" /><input value={search}
        onChange={event => { setSearch(event.target.value) }} placeholder={t('searchSkills')} /></label>
      <div className="dshIntegrationsList">{grouped.map(([source, sourceSkills]) => <div className="dshIntegrationsSkillGroup" key={source}><h3>{sourceLabel(source)}</h3>{sourceSkills.map(skill => <div className="dshIntegrationsRow dshIntegrationsSkillRow" key={skill.name} onClick={event => {
        const target = event.target as HTMLElement
        if (target.closest('button') === null && target.closest('.dshIntegrationsSkillInlineDetail') === null) {
          if (detail?.name === skill.name) setDetail(undefined)
          else void run(`skill-detail:${skill.name}`, async () => { setDetail(await api.detail(skill.name)); setRecycleConfirmName(undefined) })
        }
      }}>
        <div className="dshIntegrationsRowMain"><span className="dshIntegrationsSkillName">{skill.name}</span>
          <span className="dshIntegrationsRowDescription" data-expanded={expandedName === skill.name || undefined}>{skill.description}</span>
          {skill.whenToUse !== undefined && <span className="dshSkillsWhen"><strong>{t('whenToUse')}:</strong> {skill.whenToUse}</span>}
          <button type="button" className="dshIntegrationsTextButton" aria-expanded={expandedName === skill.name} onClick={() => { setExpandedName(expandedName === skill.name ? undefined : skill.name) }}>{expandedName === skill.name ? t('collapse') : t('expand')}</button>
        </div><div className="dshIntegrationsSkillAside"><span className="dshIntegrationsMeta"><span>{sourceLabel(skill.source)}</span>{!skill.editable && <span>{t('readOnly')}</span>}</span>
          <div className="dshIntegrationsSkillActions"><div className="dshIntegrationsSkillControl"><span>{skill.modelInvocable ? t('modelVisible') : t('modelHidden')}</span><SettingsToggle label={skill.modelInvocable ? t('modelVisible') : t('modelHidden')} checked={skill.modelInvocable} disabled={!skill.editable || busy !== undefined} onChange={enabled => { void run(`skill-toggle:${skill.name}`, async () => { setSkills(await api.setModelInvocable(skill.name, enabled)); if (detail?.name === skill.name) setDetail({ ...detail, modelInvocable: enabled }) }) }} /></div>
            <div className="dshIntegrationsSkillControl"><span>{skill.userInvocable ? t('userVisible') : t('userHidden')}</span><SettingsToggle label={skill.userInvocable ? t('userVisible') : t('userHidden')} checked={skill.userInvocable} disabled={!skill.editable || busy !== undefined} onChange={enabled => { void run(`skill-user-toggle:${skill.name}`, async () => { setSkills(await api.setUserInvocable(skill.name, enabled)); if (detail?.name === skill.name) setDetail({ ...detail, userInvocable: enabled }) }) }} /></div></div></div>
      {detail?.name === skill.name && <section className="dshIntegrationsSkillInlineDetail" aria-label={detail.name}>
        <div className="dshIntegrationsDetailHeader"><div><h4>{t('manage')} · {detail.name}</h4><p>{detail.description}</p></div>
          <div className="dshIntegrationsRowActions">{detail.editable && <button type="button" className="dshIntegrationsCommand" onClick={() => { setDraft({ mode: 'edit', name: detail.name, description: detail.description, whenToUse: detail.whenToUse ?? '', instructions: detail.content }); setDetail(undefined); setImportOpen(false) }}><Pencil />{t('edit')}</button>}
            <SettingsIconButton label={t('closeDetails')} onClick={() => { setDetail(undefined) }}><X /></SettingsIconButton></div></div>
        <dl><div><dt>{t('source')}</dt><dd>{sourceLabel(detail.source)}</dd></div><div><dt>{t('provider')}</dt><dd>{detail.provider}</dd></div>
          {detail.whenToUse !== undefined && <div><dt>{t('whenToUse')}</dt><dd>{detail.whenToUse}</dd></div>}
          {detail.path !== undefined && <div><dt>{t('path')}</dt><dd><code>{detail.path}</code></dd></div>}</dl>
        {detail.source === 'user-dsh' && <section className="dshIntegrationsDetailManagement" aria-label={t('recycle')}>{recycleConfirmName === detail.name
          ? <div className="dshSkillsConfirm"><p>{t('confirmRecycle')} <strong>{detail.name}</strong></p><div className="dshIntegrationsRowActions"><button type="button" className="dshIntegrationsCommand" onClick={() => { setRecycleConfirmName(undefined) }}>{t('cancel')}</button><button type="button" className="dshIntegrationsDanger" disabled={busy !== undefined} onClick={() => { void run(`skill-recycle:${detail.name}`, async () => { applyView(await api.recycle(detail.name)); setDetail(undefined); setRecycleConfirmName(undefined) }) }}><Trash2 />{t('recycle')}</button></div></div>
          : <button type="button" className="dshIntegrationsDanger" disabled={busy !== undefined} onClick={() => { setRecycleConfirmName(detail.name) }}><Trash2 />{t('recycle')}</button>}</section>}
        <h4>{t('skillContent')}</h4><pre>{detail.content}</pre>
      </section>}</div>)}</div>)}{filtered.length === 0 && <p className="dshIntegrationsEmpty">{t(skills.length === 0 ? 'noSkills' : 'noMatches')}</p>}</div>
      {recycled.length > 0 && <div className="dshIntegrationsRecycle"><h3>{t('recycleBin')}</h3>{recycled.map(skill => <div key={skill.id} className="dshIntegrationsRow"><div className="dshIntegrationsRowMain"><span className="dshIntegrationsRowTitle">{skill.name}</span></div><button type="button" disabled={busy !== undefined} onClick={() => { void run(`skill-restore:${skill.id}`, async () => { applyView(await api.restore(skill.id)) }) }}>{t('restore')}</button></div>)}</div>}
    </div>}
  </section>
}
