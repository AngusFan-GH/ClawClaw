/** Desktop Settings surface dedicated to Skills. */

import { useEffect, useMemo, useState } from 'react'
// @ts-expect-error package subpath has no declaration file
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
// @ts-expect-error package subpath has no declaration file
import Plus from 'lucide-react/dist/esm/icons/plus.mjs'
// @ts-expect-error package subpath has no declaration file
import Search from 'lucide-react/dist/esm/icons/search.mjs'
// @ts-expect-error package subpath has no declaration file
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.mjs'
// @ts-expect-error package subpath has no declaration file
import X from 'lucide-react/dist/esm/icons/x.mjs'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopRecycledSkill, DesktopSkillDetail, DesktopSkillView } from '../skills-contract.ts'
import type { DesktopSkillsApi } from './skills-api.ts'
import { SettingsIconButton, SettingsToggle } from './settings-controls.tsx'

export interface SkillsSettingsSectionInjected { readonly api: DesktopSkillsApi }
export type SkillsSettingsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'desktop.skills'> & InjectFace<SkillsSettingsSectionInjected>

export function SkillsSettingsSection({ t, api }: SkillsSettingsSectionProps) {
  const [skills, setSkills] = useState<readonly DesktopSkillView[]>([])
  const [recycled, setRecycled] = useState<readonly DesktopRecycledSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<DesktopSkillDetail>()
  const [expandedName, setExpandedName] = useState<string>()
  const [importText, setImportText] = useState('')
  const [importOpen, setImportOpen] = useState(false)

  const applyView = (view: Awaited<ReturnType<DesktopSkillsApi['readView']>>): void => { setSkills(view.skills); setRecycled(view.recycled) }

  const load = async (): Promise<void> => {
    setLoading(true); setError(undefined)
    try { applyView(await api.readView()) } catch (cause) { setError(cause instanceof Error ? cause.message : t('unavailable')) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (detail === undefined) return
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setDetail(undefined) }
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('keydown', closeOnEscape) }
  }, [detail])

  const run = async (key: string, operation: () => Promise<void>): Promise<void> => {
    setBusy(key); setError(undefined)
    try { await operation() } catch (cause) { setError(cause instanceof Error ? cause.message : t('operationFailed')) }
    finally { setBusy(undefined) }
  }
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return query === '' ? skills : skills.filter(skill => `${skill.name}\n${skill.description}\n${skill.source}`.toLocaleLowerCase().includes(query))
  }, [search, skills])
  const grouped = useMemo(() => {
    const groups = new Map<string, DesktopSkillView[]>()
    for (const skill of filtered) groups.set(skill.source, [...(groups.get(skill.source) ?? []), skill])
    return [...groups.entries()]
  }, [filtered])

  return <section className="dshIntegrations" aria-label={t('title')}>
    <header className="dshIntegrationsHeader"><div><h2>{t('title')}</h2><p>{t('intro')}</p></div>
      <div className="dshIntegrationsRowActions"><button type="button" className="dshIntegrationsCommand" disabled={busy !== undefined} onClick={() => { setImportOpen(!importOpen) }}><Plus />{t('import')}</button>
        <SettingsIconButton label={t('refresh')} disabled={loading || busy !== undefined} onClick={() => { void load() }}><RefreshCw /></SettingsIconButton></div></header>
    {error !== undefined && <div className="dshIntegrationsError" role="alert">{error}</div>}
    {loading && skills.length === 0 ? <p className="dshIntegrationsEmpty">{t('loading')}</p> : <div className="dshIntegrationsBody">
      <label className="dshIntegrationsSearch"><Search aria-hidden="true" /><input value={search}
        onChange={event => { setSearch(event.target.value) }} placeholder={t('searchSkills')} /></label>
      {importOpen && <div className="dshIntegrationsImport"><label>{t('importSkill')}<textarea value={importText} onChange={event => { setImportText(event.target.value) }} placeholder={t('importPlaceholder')} /></label>
        <div className="dshIntegrationsEditorFooter"><button type="button" className="dshIntegrationsCommand" disabled={busy !== undefined || importText.trim() === ''} onClick={() => { void run('skill-import', async () => { applyView(await api.importDocument(importText)); setImportText(''); setImportOpen(false) }) }}>{t('import')}</button>
          <button type="button" className="dshIntegrationsCommand" disabled={busy !== undefined} onClick={() => { setImportOpen(false); setImportText('') }}>{t('closeDetails')}</button></div></div>}
      <div className="dshIntegrationsList">{grouped.map(([source, sourceSkills]) => <div className="dshIntegrationsSkillGroup" key={source}><h3>{t('sourceGroup')} · {source}</h3>{sourceSkills.map(skill => <div className="dshIntegrationsRow dshIntegrationsSkillRow" key={skill.name} onClick={event => {
        const target = event.target as HTMLElement
        if (target.closest('button') === null && target.closest('.dshIntegrationsSkillInlineDetail') === null) {
          if (detail?.name === skill.name) setDetail(undefined)
          else void run(`skill-detail:${skill.name}`, async () => { setDetail(await api.detail(skill.name)) })
        }
      }}>
        <div className="dshIntegrationsRowMain"><span className="dshIntegrationsSkillName">{skill.name}</span>
          <span className="dshIntegrationsRowDescription" data-expanded={expandedName === skill.name || undefined}>{skill.description}</span>
          <button type="button" className="dshIntegrationsTextButton" aria-expanded={expandedName === skill.name} onClick={() => { setExpandedName(expandedName === skill.name ? undefined : skill.name) }}>{expandedName === skill.name ? t('collapse') : t('expand')}</button>
        </div><div className="dshIntegrationsSkillAside"><span className="dshIntegrationsMeta"><span>{skill.source}</span>{!skill.editable && <span>{t('readOnly')}</span>}</span>
          <div className="dshIntegrationsSkillActions"><div className="dshIntegrationsSkillControl"><span>{skill.modelInvocable ? t('modelVisible') : t('modelHidden')}</span><SettingsToggle label={skill.modelInvocable ? t('modelVisible') : t('modelHidden')} checked={skill.modelInvocable} disabled={!skill.editable || busy !== undefined} onChange={enabled => { void run(`skill-toggle:${skill.name}`, async () => { setSkills(await api.setModelInvocable(skill.name, enabled)); if (detail?.name === skill.name) setDetail({ ...detail, modelInvocable: enabled }) }) }} /></div>
            <div className="dshIntegrationsSkillControl"><span>{skill.userInvocable ? t('userVisible') : t('userHidden')}</span><SettingsToggle label={skill.userInvocable ? t('userVisible') : t('userHidden')} checked={skill.userInvocable} disabled={!skill.editable || busy !== undefined} onChange={enabled => { void run(`skill-user-toggle:${skill.name}`, async () => { setSkills(await api.setUserInvocable(skill.name, enabled)); if (detail?.name === skill.name) setDetail({ ...detail, userInvocable: enabled }) }) }} /></div></div></div>
      {detail?.name === skill.name && <section className="dshIntegrationsSkillInlineDetail" aria-label={detail.name}>
        <div className="dshIntegrationsDetailHeader"><div><h4>{t('manage')} · {detail.name}</h4><p>{detail.description}</p></div>
          <SettingsIconButton label={t('closeDetails')} onClick={() => { setDetail(undefined) }}><X /></SettingsIconButton></div>
        <dl><div><dt>{t('source')}</dt><dd>{detail.source}</dd></div><div><dt>{t('provider')}</dt><dd>{detail.provider}</dd></div>
          {detail.path !== undefined && <div><dt>{t('path')}</dt><dd><code>{detail.path}</code></dd></div>}</dl>
        {detail.source === 'user-dsh' && <section className="dshIntegrationsDetailManagement" aria-label={t('recycle')}><button type="button" className="dshIntegrationsDanger" disabled={busy !== undefined} onClick={() => {
            if (window.confirm(`${t('confirmRecycle')} ${detail.name}`)) void run(`skill-recycle:${detail.name}`, async () => { applyView(await api.recycle(detail.name)); setDetail(undefined) })
          }}><Trash2 />{t('recycle')}</button></section>}
        <h4>{t('skillContent')}</h4><pre>{detail.content}</pre>
      </section>}</div>)}</div>)}{filtered.length === 0 && <p className="dshIntegrationsEmpty">{t(skills.length === 0 ? 'noSkills' : 'noMatches')}</p>}</div>
      {recycled.length > 0 && <div className="dshIntegrationsRecycle"><h3>{t('recycleBin')}</h3>{recycled.map(skill => <div key={skill.id} className="dshIntegrationsRow"><div className="dshIntegrationsRowMain"><span className="dshIntegrationsRowTitle">{skill.name}</span></div><button type="button" disabled={busy !== undefined} onClick={() => { void run(`skill-restore:${skill.id}`, async () => { applyView(await api.restore(skill.id)) }) }}>{t('restore')}</button></div>)}</div>}
    </div>}
  </section>
}
