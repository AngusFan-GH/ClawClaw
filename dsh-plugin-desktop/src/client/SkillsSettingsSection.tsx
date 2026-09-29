/** Desktop-owned catalog using Harness settings and dialog primitives. */
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
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
import { IconChevronDownOutlineMedium, IconSkillOutlineMedium, Menu, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopRecycledSkill, DesktopSkillDetail, DesktopSkillInput, DesktopSkillView, DesktopSkillsView, DesktopSkillsWorkspace } from '../skills-contract.ts'
import type { DesktopSkillsApi } from './skills-api.ts'
import { readSkillFile, readSkillFolder } from './skill-file.ts'
import { SkillFiles } from './SkillFiles.tsx'
import type { DesktopSkillBundleFile } from '../skills-contract.ts'
import { zh } from './skills-locales.ts'
import { SettingsIconButton, SettingsToggle } from './settings-controls.tsx'

export interface SkillsSettingsSectionInjected { readonly api: DesktopSkillsApi; readonly initialSessionId?: string }
export type SkillsSettingsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'desktop.skills'> & InjectFace<SkillsSettingsSectionInjected>
type SkillDraft = DesktopSkillInput & { readonly mode: 'create' | 'edit'; readonly revision?: string | undefined; readonly shared?: boolean }
const EMPTY_DRAFT: SkillDraft = { mode: 'create', name: '', description: '', whenToUse: '', instructions: '' }
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const canRecycle = (skill: DesktopSkillView): boolean => skill.editable && skill.source === 'user-dsh' && skill.provider === 'filesystem'

export function SkillsSettingsSection({ t, api: baseApi, initialSessionId }: SkillsSettingsSectionProps) {
  const id = useId()
  const [preset, setPreset] = useState<string>()
  const [presets, setPresets] = useState<readonly { id: string, name: string }[]>([])
  const [presetMenuOpen, setPresetMenuOpen] = useState(false)
  const [scope, setScope] = useState(initialSessionId === undefined ? 'global' : `session:${initialSessionId}`)
  const [workspaces, setWorkspaces] = useState<readonly DesktopSkillsWorkspace[]>([])
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false)
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false)
  const [sourceFilter, setSourceFilter] = useState('')
  const [detailTab, setDetailTab] = useState<'overview' | 'files'>('overview')
  const scopedApi = (selection: string, selectedPreset?: string): DesktopSkillsApi => selection.startsWith('session:')
    ? baseApi.forScope({ sessionId: selection.slice(8) }).forPreset()
    : baseApi.forScope(selection.startsWith('workspace:') ? { workspaceId: selection.slice(10) } : {}).forPreset(selectedPreset)
  const api = useMemo(() => scopedApi(scope, preset), [baseApi, scope, preset])
  const [skills, setSkills] = useState<readonly DesktopSkillView[]>([])
  const [recycled, setRecycled] = useState<readonly DesktopRecycledSkill[]>([])
  const [locations, setLocations] = useState<DesktopSkillsView['locations']>()
  const [installed, setInstalled] = useState<DesktopSkillsView['installed']>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [refreshPending, setRefreshPending] = useState(false)
  const [busy, setBusy] = useState<string>()
  const [view, setView] = useState<'library' | 'recycle'>('library')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<DesktopSkillDetail>()
  const [draft, setDraft] = useState<SkillDraft>()
  const [conflictDetail, setConflictDetail] = useState<DesktopSkillDetail>()
  const [importText, setImportText] = useState('')
  const [bundle, setBundle] = useState<readonly DesktopSkillBundleFile[]>()
  const [importOpen, setImportOpen] = useState(false)
  const [fileName, setFileName] = useState('')
  const [discard, setDiscard] = useState(false)
  const [recycleConfirm, setRecycleConfirm] = useState(false)
  const [purgeTarget, setPurgeTarget] = useState<readonly DesktopRecycledSkill[]>()
  const inFlight = useRef(false)
  const readEpoch = useRef(0)
  const refreshing = useRef(false)
  const initialDraft = useRef('')
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const section = useRef<HTMLElement>(null)
  const modalBody = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const modalOpen = detail !== undefined || draft !== undefined || importOpen || purgeTarget !== undefined
  const disabled = loading || busy !== undefined

  const applyView = (next: Awaited<ReturnType<DesktopSkillsApi['readView']>>): void => {
    setRefreshPending(next.refreshPending === true)
    if (next.refreshPending) return
    setSkills(next.skills); setRecycled(next.recycled); setLocations(next.locations); setInstalled(next.installed)
  }
  const sourceLabel = (source: string): string => {
    if (source === 'user-dsh') return t('sourceUserDsh')
    if (source === 'user-agents') return t('sourceUserAgents')
    if (source === 'project-dsh') return t('sourceProjectDsh')
    if (source === 'project-agents') return t('sourceProjectAgents')
    if (source === 'custom') return t('sourceCustom')
    if (source === 'bundled' || source === 'global') return t('sourceBundled')
    if (source.startsWith('plugin')) return t('sourcePlugin')
    return t('sourceOther')
  }
  const load = async (background = false): Promise<void> => {
    if (inFlight.current || (background && refreshing.current)) return
    const epoch = ++readEpoch.current
    if (background) refreshing.current = true
    else { inFlight.current = true; setLoading(true); setError(undefined) }
    try {
      const nextPresets = background ? undefined : await baseApi.presets()
      const nextWorkspaces = background ? undefined : await baseApi.workspaces()
      const next = await api.readView()
      if (epoch !== readEpoch.current) return
      if (nextPresets !== undefined) setPresets(nextPresets)
      if (nextWorkspaces !== undefined) setWorkspaces(nextWorkspaces)
      applyView(next); setError(undefined)
    } catch (cause) { if (epoch === readEpoch.current) setError(cause instanceof Error ? cause.message : t('unavailable')) }
    finally { if (background) refreshing.current = false; else { inFlight.current = false; setLoading(false) } }
  }
  useEffect(() => { void load(); return () => { readEpoch.current++ } }, [])
  useEffect(() => {
    if (modalOpen) return
    // No spinner or draft replacement while Agent installs change the catalog.
    const refresh = () => { if (document.visibilityState !== 'hidden') void load(true) }
    const timer = window.setInterval(refresh, 5000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer); window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh); readEpoch.current++
    }
  }, [api, modalOpen])
  useEffect(() => {
    if (!modalOpen) return
    const dialog = modalBody.current?.closest<HTMLElement>('[role="dialog"]')
    const background = section.current
    if (dialog === undefined || dialog === null) return
    if (background !== null) background.inert = true
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = (): HTMLElement[] => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), summary, [tabindex="0"]')]
      .filter(element => !element.hidden && element.getClientRects().length > 0)
    focusable()[0]?.focus()
    const trapFocus = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const items = focusable(); const first = items[0]; const last = items.at(-1)
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trapFocus, true)
    return () => {
      if (background !== null) background.inert = false
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', trapFocus, true)
      if (returnFocus.current?.isConnected) returnFocus.current.focus()
      else tabs.current[0]?.focus()
    }
  }, [modalOpen])
  useEffect(() => {
    if (draft !== undefined) modalBody.current?.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled)')?.focus()
  }, [draft?.mode])
  const run = async (key: string, operation: () => Promise<void>): Promise<void> => {
    if (inFlight.current) return
    readEpoch.current++
    inFlight.current = true; setBusy(key); setError(undefined)
    try { await operation() } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      if (message === 'skillSavedRefreshPending') setRefreshPending(true)
      else setError(Object.hasOwn(zh, message) ? t(message as keyof typeof zh) : message || t('operationFailed'))
    }
    finally { inFlight.current = false; setBusy(undefined) }
  }
  const close = (): void => {
    if (inFlight.current) return
    setDetail(undefined); setDraft(undefined); setImportOpen(false); setImportText(''); setFileName('')
    setConflictDetail(undefined)
    setBundle(undefined)
    setPurgeTarget(undefined)
    setDiscard(false); setRecycleConfirm(false); setError(undefined)
  }
  const requestClose = (): void => {
    if (inFlight.current) return
    if ((draft !== undefined && JSON.stringify(draft) !== initialDraft.current) || (importOpen && (importText !== '' || bundle !== undefined))) setDiscard(true)
    else close()
  }
  useEffect(() => {
    if (!modalOpen) return
    // The parent Settings dialog must not consume the same Escape key.
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopImmediatePropagation(); requestClose()
    }
    document.addEventListener('keydown', onEscape, true)
    return () => { document.removeEventListener('keydown', onEscape, true) }
  }, [modalOpen, draft, importOpen, importText, bundle])
  const beginDraft = (next: SkillDraft): void => {
    setConflictDetail(undefined)
    initialDraft.current = JSON.stringify(next); setDraft(next); setDetail(undefined); setError(undefined); setRecycleConfirm(false)
  }
  const saveDraft = (event: FormEvent): void => {
    event.preventDefault()
    if (draft === undefined) return
    void run('save', async () => {
      const whenToUse = draft.whenToUse?.trim()
      const input: DesktopSkillInput = { name: draft.name.trim(), description: draft.description.trim(),
        ...(whenToUse === undefined || whenToUse === '' ? {} : { whenToUse }), instructions: draft.instructions.trim() }
      applyView(draft.mode === 'create' ? await api.create(input) : await api.update(draft.name, input, draft.revision))
      if (draft.mode === 'create') { setView('library'); setSearch(''); setSourceFilter('') }
      setDraft(undefined); setDiscard(false)
    })
  }
  const query = search.trim().toLocaleLowerCase()
  const filtered = useMemo(() => skills.filter(skill => (sourceFilter === '' || skill.source === sourceFilter) && `${skill.name}\n${skill.description}\n${skill.whenToUse ?? ''}\n${sourceLabel(skill.source)}`.toLocaleLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name)), [query, sourceFilter, skills, t])
  const sources = [...new Set(skills.map(skill => skill.source))].sort()
  const filteredRecycled = recycled.filter(skill => skill.name.toLocaleLowerCase().includes(query))
  const draftValid = draft !== undefined && SKILL_NAME.test(draft.name.trim()) && draft.description.trim() !== '' && draft.instructions.trim() !== ''
  const errorMessage = error === undefined ? null : <div className="dshIntegrationsError" role="alert">{error}</div>
  const title = purgeTarget !== undefined ? t('permanentlyDelete') : draft !== undefined ? t(draft.mode === 'create' ? 'newSkill' : 'editSkill') : importOpen ? t('importSkill') : detail?.name ?? ''
  const recycleReason = (skill: DesktopSkillView): string => t(skill.source.startsWith('project-') ? 'recycleProjectRestricted' : skill.source === 'user-agents' ? 'recycleSharedRestricted' : 'recycleManagedRestricted')
  const openSkill = (skill: DesktopSkillView, trigger: HTMLElement, confirmRecycle = false): void => {
    returnFocus.current = trigger
    void run(`detail:${skill.name}`, async () => {
      const next = await api.detail(skill.name)
      setDetail(next); setDetailTab('overview'); setRecycleConfirm(confirmRecycle && canRecycle(next))
    })
  }

  return <>
    <section ref={section} className="dshIntegrations dshSkillsPage" aria-label={t('title')}>
      <header className="dshIntegrationsHeader"><h2>{t('title')}</h2>
        <div className="dshIntegrationsRowActions">
          <button type="button" className="dshIntegrationsCommand" disabled={disabled} onClick={event => { returnFocus.current = event.currentTarget; setError(undefined); setImportOpen(true) }}><FileUp />{t('importRaw')}</button>
          <button type="button" className="dshIntegrationsCommand dshCronPrimary" disabled={disabled} onClick={event => { returnFocus.current = event.currentTarget; beginDraft({ ...EMPTY_DRAFT }) }}><Plus />{t('newSkill')}</button>
        </div>
      </header>
      <div className="dshSkillsTabs" role="tablist" aria-label={t('title')}>
        {(['library', 'recycle'] as const).map((value, index) => <button key={value} ref={element => { tabs.current[index] = element }} type="button" role="tab" id={`${id}-${value}`} aria-controls={`${id}-panel`} aria-selected={view === value} tabIndex={view === value ? 0 : -1}
          onClick={() => { setView(value) }} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index
            setView(next === 0 ? 'library' : 'recycle'); tabs.current[next]?.focus()
          }}>{t(value === 'library' ? 'library' : 'recycleBin')}<span>{value === 'library' ? skills.length : recycled.length}</span></button>)}
      </div>
      {!modalOpen && errorMessage}
      {!modalOpen && refreshPending && <p role="status" className="dshSkillsNote">{t('skillSavedRefreshPending')}</p>}
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${view}`} className="dshSkillsCatalog" aria-busy={disabled}>
        <div className="dshSkillsToolbar">
          <label className="dshIntegrationsSearch"><Search aria-hidden="true" /><input aria-label={t('searchSkills')} value={search} onChange={event => { setSearch(event.target.value) }} placeholder={t('searchSkills')} /></label>
          {view === 'library' && <Menu className="dshSkillsPresetMenu" open={sourceMenuOpen} onClose={() => { setSourceMenuOpen(false) }} compact portal selectedId={sourceFilter}
            items={[{ id: '', label: `${t('allSources')} · ${skills.length}` }, ...sources.map(source => ({ id: source, label: `${sourceLabel(source)} · ${skills.filter(skill => skill.source === source).length}` }))]}
            onSelect={next => { setSourceFilter(next); setSourceMenuOpen(false) }} anchor={<button type="button" className="dshIntegrationsCommand" disabled={disabled} aria-label={t('filterSource')} aria-haspopup="menu" aria-expanded={sourceMenuOpen} onClick={() => { setSourceMenuOpen(open => !open) }}><span>{sourceFilter ? sourceLabel(sourceFilter) : t('allSources')}</span><IconChevronDownOutlineMedium /></button>} />}
          {view === 'library' && <Menu className="dshSkillsPresetMenu" open={scopeMenuOpen} onClose={() => { setScopeMenuOpen(false) }} compact portal selectedId={scope}
            items={[{ id: 'global', label: t('scopeGlobal') }, ...(initialSessionId === undefined ? [] : [{ id: `session:${initialSessionId}`, label: t('scopeSession') }]),
              ...(workspaces.length === 0 ? [] : [{ type: 'separator' as const, id: 'workspace-separator' }, { type: 'label' as const, id: 'workspace-label', text: t('scopeWorkspaces') }]),
              ...workspaces.map(workspace => ({ id: `workspace:${workspace.id}`, label: `${workspace.title} · ${workspace.path}` }))]}
            onSelect={next => {
              setScopeMenuOpen(false)
              void run('scope', async () => { const result = await scopedApi(next, preset).readView(); setScope(next); applyView(result) })
            }} anchor={<button type="button" className="dshIntegrationsCommand" disabled={disabled} aria-label={t('skillScope')} aria-haspopup="menu" aria-expanded={scopeMenuOpen} onClick={() => { setScopeMenuOpen(open => !open) }}>
              <span>{scope.startsWith('session:') ? t('scopeSession') : workspaces.find(workspace => `workspace:${workspace.id}` === scope)?.title ?? t('scopeGlobal')}</span><IconChevronDownOutlineMedium />
            </button>} />}
          {view === 'library' && !scope.startsWith('session:') && presets.length > 0 && <Menu className="dshSkillsPresetMenu" open={presetMenuOpen} onClose={() => { setPresetMenuOpen(false) }} compact portal selectedId={preset ?? ''}
            items={[{ id: '', label: t('defaultPreset') }, ...presets.map(item => ({ id: item.id, label: item.name }))]}
            onSelect={next => {
              setPresetMenuOpen(false)
              void run('preset', async () => { const selection = next || undefined; const result = await api.forPreset(selection).readView(); setPreset(selection); applyView(result) })
            }} anchor={<button type="button" className="dshIntegrationsCommand" disabled={disabled} aria-label={t('agentPreset')} aria-haspopup="menu" aria-expanded={presetMenuOpen} onClick={() => { setPresetMenuOpen(open => !open) }}>
              <span>{presets.find(item => item.id === preset)?.name ?? t('defaultPreset')}</span><IconChevronDownOutlineMedium />
            </button>} />}
          <SettingsIconButton label={t('refresh')} disabled={disabled} onClick={() => { void load() }}><RefreshCw /></SettingsIconButton>
          {view === 'recycle' && api.purge && <button type="button" className="dshIntegrationsDanger" disabled={disabled || recycled.length === 0} onClick={event => { returnFocus.current = event.currentTarget; setError(undefined); setPurgeTarget([...recycled]) }}><Trash2 />{t('emptyRecycleBin')}</button>}
        </div>
        {locations !== undefined && <details className="dshSkillsContext" key={view}>
          <summary><span>{t('skillLocations')}</span>{view === 'library' && locations.preset !== undefined && <span className="dshSkillsContextPreset">{t('agentPreset')} · {presets.find(item => item.id === locations.preset)?.name ?? locations.preset}</span>}</summary>
          <dl className="dshSkillsFacts" aria-label={t('skillLocations')}>
          <div><dt>{t(view === 'recycle' ? 'recycleBin' : 'userLibraryPath')}</dt><dd><code>{view === 'recycle' ? locations.recycleBin : locations.userLibrary}</code></dd></div>
          {view === 'library' && locations.cwd !== undefined && <div><dt>{t('workingDirectory')}</dt><dd><code>{locations.cwd}</code></dd></div>}
          </dl>
        </details>}
        {loading ? <p className="dshIntegrationsEmpty" role="status">{t('loading')}</p> : view === 'library' ? <>
          {installed !== undefined && installed.some(item => item.status !== 'effective') && <details className="dshSkillsDiagnostics">
            <summary>{t('installationIssues')} · {installed.filter(item => item.status !== 'effective').length}</summary>
            <dl className="dshSkillsFacts">{installed.filter(item => item.status !== 'effective').map(item => <div key={item.path}>
              <dt>{t(item.status === 'overridden' ? 'installationOverridden' : item.status === 'invalid' ? 'installationInvalid' : item.status === 'unavailable' ? 'unavailable' : 'installationNotDiscovered')}</dt>
              <dd><strong>{item.name}</strong><br /><code>{item.path}</code>
                {item.reason !== undefined && <p>{t(item.reason === 'missing-file' ? 'diagnosticMissingFile' : item.reason === 'unreadable-file' ? 'diagnosticUnreadable' : item.reason === 'inspection-limit' ? 'diagnosticLimit' : 'diagnosticInvalid')}</p>}
                {item.status === 'not-discovered' && <p>{t('diagnosticNotDiscovered')}</p>}
                {item.status === 'overridden' && <>
                  <p>{t('effectiveSkill')}{item.effectiveSource === undefined ? '' : ` · ${sourceLabel(item.effectiveSource)}`}</p>
                  {item.effectivePath !== undefined && <code>{item.effectivePath}</code>}
                  {skills.some(skill => skill.name === item.name) && <div><button type="button" className="dshIntegrationsCommand" disabled={disabled} onClick={event => {
                    const skill = skills.find(skill => skill.name === item.name)
                    if (skill !== undefined) openSkill(skill, event.currentTarget)
                  }}>{t('viewDetails')}: {item.name}</button></div>}
                </>}
              </dd>
            </div>)}</dl>
          </details>}
            <ul className="dshSkillsGrid" aria-label={t('library')}>{filtered.map(skill => <li key={skill.name} data-recyclable={canRecycle(skill)}>
              <button type="button" className="dshSkillsCard" title={skill.name} disabled={disabled} aria-label={`${t('viewDetails')}: ${skill.name}`} onClick={event => { openSkill(skill, event.currentTarget) }}>
                <span className="dshSkillsCardHeading"><IconSkillOutlineMedium /><strong>{skill.name}</strong>{!skill.editable && <span className="dshSkillsReadOnly">{t('readOnly')}</span>}</span>
                {sourceFilter === '' && <span className="dshSkillsCardSource">{sourceLabel(skill.source)}</span>}
                <span className="dshSkillsSummary">{skill.description}</span>
                <span className="dshSkillsBadges"><span data-enabled={skill.modelInvocable}>{t(skill.modelInvocable ? 'modelVisible' : 'modelHidden')}</span><span data-enabled={skill.userInvocable}>{t(skill.userInvocable ? 'userVisible' : 'userHidden')}</span></span>
              </button>
              {canRecycle(skill) && <span className="dshSkillsCardDelete"><Tooltip side="top" delayMs={350} maxWidth={240} label={t('recycle')}><span>
                <button type="button" className="dshIntegrationsIconButton" data-danger aria-label={`${t('recycle')}: ${skill.name}`} disabled={disabled} onClick={event => { openSkill(skill, event.currentTarget, true) }}><Trash2 aria-hidden="true" /></button>
              </span></Tooltip></span>}
            </li>)}</ul>
          {filtered.length === 0 && <p className="dshIntegrationsEmpty">{t(skills.length === 0 ? 'noSkills' : 'noMatches')}{(query !== '' || sourceFilter !== '') && <button type="button" className="dshIntegrationsCommand" onClick={() => { setSearch(''); setSourceFilter('') }}>{t('clearFilters')}</button>}</p>}
        </> : <ul className="dshSkillsRecycleList">{filteredRecycled.map(skill => <li key={skill.id}>
          <Trash2 aria-hidden="true" /><div><strong>{skill.name}</strong><span>{t('deletedAt')}: <time dateTime={skill.deletedAt}>{Number.isNaN(Date.parse(skill.deletedAt)) ? '-' : new Date(skill.deletedAt).toLocaleString(t('dateLocale'))}</time></span></div>
          <button type="button" className="dshIntegrationsCommand" disabled={disabled} onClick={() => { void run(`restore:${skill.id}`, async () => { applyView(await api.restore(skill.id)) }) }}>{t('restore')}</button>
          {api.purge && <Tooltip label={`${t('permanentlyDelete')}: ${skill.name}`}><button type="button" className="dshIntegrationsIconButton" data-danger aria-label={`${t('permanentlyDelete')}: ${skill.name}`} disabled={disabled} onClick={event => { returnFocus.current = event.currentTarget; setError(undefined); setPurgeTarget([skill]) }}><Trash2 /></button></Tooltip>}
        </li>)}{filteredRecycled.length === 0 && <li className="dshSkillsEmpty">{t(recycled.length === 0 ? 'recycleEmpty' : 'noMatches')}</li>}</ul>}
      </div>
    </section>

    <Modal open={modalOpen} title={title} closeLabel={t('close')} onClose={requestClose} className={`dshSkillsDialog${detail !== undefined && detailTab === 'files' ? ' dshSkillsFileDialog' : ''}`} contentClassName="dshSkillsDialogContent"
      footer={<div className="dshSkillsDialogFooter">
        {purgeTarget !== undefined ? <div className="dshIntegrationsRowActions">
          <button type="button" className="dshIntegrationsCommand" disabled={disabled} onClick={close}>{t('cancel')}</button>
          <button type="button" className="dshIntegrationsDanger" disabled={disabled} onClick={() => { void run('purge', async () => {
            if (!api.purge) return
            const result = await api.purge(purgeTarget.map(item => item.id))
            setRecycled(current => current.filter(item => !result.deleted.includes(item.id)))
            if (result.failed.length > 0) { setPurgeTarget(purgeTarget.filter(item => result.failed.includes(item.id))); setError(t('purgeFailed')) }
            else setPurgeTarget(undefined)
          }) }}><Trash2 />{t('permanentlyDelete')}</button>
        </div> : discard ? <div className="dshSkillsConfirmation" role="alert"><span>{t('discardChanges')}</span><div className="dshIntegrationsRowActions"><button type="button" className="dshIntegrationsCommand" onClick={() => { setDiscard(false) }}>{t('keepEditing')}</button><button type="button" className="dshIntegrationsDanger" onClick={close}>{t('discard')}</button></div></div>
          : recycleConfirm && detail !== undefined ? <div className="dshSkillsConfirmation" role="alert"><span>{t('confirmRecycle')}</span><div className="dshIntegrationsRowActions"><button type="button" className="dshIntegrationsCommand" disabled={disabled} onClick={() => { setRecycleConfirm(false) }}>{t('cancel')}</button><button type="button" className="dshIntegrationsDanger" disabled={disabled} onClick={() => { void run('recycle', async () => { applyView(await api.recycle(detail.name)); setDetail(undefined); setRecycleConfirm(false) }) }}>{t('recycle')}</button></div></div>
          : <>
            {detail !== undefined && <div className="dshSkillsDeleteAction">
              {canRecycle(detail) && <button type="button" className="dshIntegrationsDanger" disabled={disabled} onClick={() => { setRecycleConfirm(true) }}><Trash2 aria-hidden="true" />{t('recycle')}</button>}
              {!canRecycle(detail) && <p id={`${id}-recycle-reason`} className="dshSkillsNote">{recycleReason(detail)}</p>}
            </div>}
            <div className="dshIntegrationsRowActions">
              <button type="button" className="dshIntegrationsCommand" disabled={disabled} onClick={requestClose}>{t(detail === undefined ? 'cancel' : 'close')}</button>
              {detail?.editable && <button type="button" className="dshIntegrationsCommand" disabled={disabled} onClick={() => { beginDraft({ mode: 'edit', revision: detail.revision, shared: detail.source === 'user-agents', name: detail.name, description: detail.description, whenToUse: detail.whenToUse ?? '', instructions: detail.content }) }}><Pencil />{t('edit')}</button>}
              {draft !== undefined && <button type="submit" form={`${id}-form`} className="dshIntegrationsCommand dshCronPrimary" disabled={disabled || !draftValid}>{busy === 'save' ? t('saving') : t(draft.mode === 'create' ? 'create' : 'save')}</button>}
              {importOpen && <button type="button" className="dshIntegrationsCommand dshCronPrimary" disabled={disabled || (bundle === undefined && importText.trim() === '')} onClick={() => { void run('import', async () => {
                applyView(bundle !== undefined && api.importBundle ? await api.importBundle(bundle) : await api.importDocument(importText))
                setBundle(undefined); setImportText(''); setFileName(''); setImportOpen(false); setView('library'); setSearch(''); setSourceFilter('')
              }) }}>{busy === 'import' ? t('importing') : t('import')}</button>}
            </div>
          </>}
      </div>}>
      <div ref={modalBody} className="dshSkillsDialogBody" aria-busy={disabled}>
        {modalOpen && errorMessage}
        {draft?.shared && <p className="dshSkillsNote">{t('sharedSkillEditImpact')}</p>}
        {purgeTarget !== undefined && <><p className="dshSkillsDescription">{t('purgeWarning')}</p><p className="dshSkillsNote">{t('purgeCount')}: {purgeTarget.length}</p><ul className="dshSkillBundleList">{purgeTarget.map(item => <li key={item.id}>{item.name}</li>)}</ul></>}
        {draft?.mode === 'edit' && error === t('skillEditConflict') && <button type="button" className="dshIntegrationsCommand" disabled={disabled} onClick={() => {
          void run('compare', async () => { setConflictDetail(await api.detail(draft.name)) })
        }}>{t('reviewLatest')}</button>}
        {draft?.mode === 'edit' && conflictDetail !== undefined && <section className="dshSkillsInstructions">
          <h3>{t('latestVersion')}</h3><p className="dshSkillsDescription">{conflictDetail.description}</p>
          {conflictDetail.whenToUse && <p className="dshSkillsNote">{conflictDetail.whenToUse}</p>}<pre>{conflictDetail.content}</pre>
          <button type="button" className="dshIntegrationsCommand" disabled={disabled || conflictDetail.revision === undefined} onClick={() => {
            setDraft({ ...draft, revision: conflictDetail.revision }); setConflictDetail(undefined)
          }}>{t('confirmDraftVersion')}</button>
        </section>}
        {modalOpen && refreshPending && <p role="status" className="dshSkillsNote">{t('skillSavedRefreshPending')}</p>}
        {locations !== undefined && (draft?.mode === 'create' || importOpen) && <dl className="dshSkillsFacts dshSkillsDestination">
          <div><dt>{t('installDestination')}</dt><dd><code>{locations.userLibrary}</code></dd></div>
        </dl>}
        {draft !== undefined && <form id={`${id}-form`} className="dshSkillsForm" onSubmit={saveDraft}>
          <label>{t('name')}<input required maxLength={128} disabled={disabled || draft.mode === 'edit'} value={draft.name} placeholder={t('namePlaceholder')} onChange={event => { setDraft({ ...draft, name: event.target.value }) }} /></label>
          <label>{t('description')}<textarea required maxLength={4000} disabled={disabled} rows={2} value={draft.description} placeholder={t('descriptionPlaceholder')} onChange={event => { setDraft({ ...draft, description: event.target.value }) }} /></label>
          <label>{t('whenToUse')}<textarea maxLength={4000} disabled={disabled} rows={2} value={draft.whenToUse ?? ''} placeholder={t('whenToUsePlaceholder')} onChange={event => { setDraft({ ...draft, whenToUse: event.target.value }) }} /></label>
          <label>{t('instructions')}<textarea required className="dshSkillsCode" maxLength={240000} disabled={disabled} rows={10} value={draft.instructions} placeholder={t('instructionsPlaceholder')} onChange={event => { setDraft({ ...draft, instructions: event.target.value }) }} /></label>
        </form>}
        {importOpen && <div className="dshSkillsForm">
          <input ref={fileInput} type="file" accept=".md,text/markdown" hidden onChange={event => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''
            if (file === undefined) return
            void run('read-file', async () => {
              try { const content = await readSkillFile(file); setBundle(undefined); setImportText(content); setFileName(file.name) }
              catch (cause) { const code = cause instanceof Error ? cause.message : ''; throw new Error(t(code === 'fileType' || code === 'fileTooLarge' || code === 'fileEmpty' ? code : 'fileReadFailed')) }
            })
          }} />
          <input ref={folderInput} type="file" multiple hidden {...{ webkitdirectory: '' }} onChange={event => {
            const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''
            if (files.length === 0) return
            void run('read-folder', async () => { const filesRead = await readSkillFolder(files); setBundle(filesRead); setImportText(''); setFileName(files[0]!.webkitRelativePath.split('/')[0] ?? '') })
          }} />
          <div className="dshSkillsFileRow"><button type="button" className="dshIntegrationsCommand" disabled={disabled} onClick={() => { fileInput.current?.click() }}><FileUp />{t('chooseFile')}</button>
            {api.importBundle && <button type="button" className="dshIntegrationsCommand" disabled={disabled} onClick={() => { folderInput.current?.click() }}><FileUp />{t('chooseFolder')}</button>}<span>{fileName || t('fileLimit')}</span></div>
          {bundle === undefined ? <><label>{t('rawDocument')}<textarea className="dshSkillsCode" rows={12} disabled={disabled} value={importText} onChange={event => { setImportText(event.target.value) }} placeholder={t('importPlaceholder')} /></label><p className="dshSkillsNote">{t('importHint')}</p></>
            : <><p className="dshSkillsNote">{t('skillBundleHint')}</p><ul className="dshSkillBundleList">{bundle.map(file => <li key={file.path}><code>{file.path}</code></li>)}</ul></>}
        </div>}
        {detail !== undefined && <>
          {detail.provider === 'filesystem' && detail.path !== undefined && api.files && api.file && <div className="dshSkillsTabs" role="tablist" aria-label={t('viewDetails')}>
            {(['overview', 'files'] as const).map(tab => <button key={tab} type="button" role="tab" id={`${id}-detail-${tab}`} aria-controls={`${id}-detail-panel`} aria-selected={detailTab === tab} tabIndex={detailTab === tab ? 0 : -1} onClick={() => { setDetailTab(tab) }} onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const next = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'files' : tab === 'files' ? 'overview' : 'files'
              setDetailTab(next); document.getElementById(`${id}-detail-${next}`)?.focus()
            }}>{t(tab === 'overview' ? 'skillOverview' : 'skillFiles')}</button>)}
          </div>}
          <div id={`${id}-detail-panel`} className="dshSkillsDetailPanel" role={api.files && api.file && detail.path !== undefined && detail.provider === 'filesystem' ? 'tabpanel' : undefined} aria-label={t(detailTab === 'overview' ? 'skillOverview' : 'skillFiles')}>
          {detailTab === 'overview' ? <>
          <p className="dshSkillsDescription">{detail.description}</p>
          <dl className="dshSkillsFacts"><div><dt>{t('source')}</dt><dd>{sourceLabel(detail.source)}
            {detail.source === 'user-dsh' && <p className="dshSkillsNote">{t('clawclawSkillOrigin')}</p>}
            {detail.source === 'user-agents' && <p className="dshSkillsNote">{t('sharedSkillOrigin')}</p>}
          </dd></div><div><dt>{t('provider')}</dt><dd>{detail.provider}</dd></div>
            {detail.path !== undefined && <div><dt>{t('path')}</dt><dd><code>{detail.path}</code></dd></div>}
            {detail.whenToUse !== undefined && <div><dt>{t('whenToUse')}</dt><dd>{detail.whenToUse}</dd></div>}
          </dl>
          {detail.source === 'user-agents' && detail.editable && <p className="dshSkillsNote">{t('sharedSkillEditImpact')}</p>}
          <div className="dshSkillsInvocation">
            <div><span>{t('modelInvocation')}</span><SettingsToggle label={t('modelInvocation')} checked={detail.modelInvocable} disabled={disabled || !detail.editable} onChange={enabled => { void run('model-toggle', async () => { setSkills(await api.setModelInvocable(detail.name, enabled)); setDetail({ ...detail, modelInvocable: enabled }) }) }} /></div>
            <div><span>{t('userInvocation')}</span><SettingsToggle label={t('userInvocation')} checked={detail.userInvocable} disabled={disabled || !detail.editable} onChange={enabled => { void run('user-toggle', async () => { setSkills(await api.setUserInvocable(detail.name, enabled)); setDetail({ ...detail, userInvocable: enabled }) }) }} /></div>
          </div>
          <section className="dshSkillsInstructions"><h3>{t('skillContent')}</h3><pre>{detail.content}</pre></section>
          </> : <SkillFiles key={detail.name} name={detail.name} api={api} t={t} />}
          </div>
        </>}
      </div>
    </Modal>
  </>
}
