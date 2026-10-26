/** Desktop-owned catalog using Harness settings and dialog primitives. */
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
// @ts-expect-error package subpath has no declaration file
import FileUp from 'lucide-react/dist/esm/icons/file-up.mjs'
// @ts-expect-error package subpath has no declaration file
import FolderPlus from 'lucide-react/dist/esm/icons/folder-plus.mjs'
// @ts-expect-error package subpath has no declaration file
import Pencil from 'lucide-react/dist/esm/icons/pencil.mjs'
// @ts-expect-error package subpath has no declaration file
import Plus from 'lucide-react/dist/esm/icons/plus.mjs'
// @ts-expect-error package subpath has no declaration file
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
// @ts-expect-error package subpath has no declaration file
import Search from 'lucide-react/dist/esm/icons/search.mjs'
// @ts-expect-error package subpath has no declaration file
import ArrowUpRight from 'lucide-react/dist/esm/icons/arrow-up-right.mjs'
// @ts-expect-error package subpath has no declaration file
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.mjs'
import { IconChevronDownOutlineMedium, Menu, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopRecycledSkill, DesktopSkillDetail, DesktopSkillInput, DesktopSkillView, DesktopSkillsView, DesktopSkillsWorkspace } from '../skills-contract.ts'
import type { DesktopSkillsApi } from './skills-api.ts'
import { readSkillFile, readSkillFolder } from './skill-file.ts'
import { SkillFiles } from './SkillFiles.tsx'
import { SkillCategoryIcon } from './SkillCategoryIcon.tsx'
import { presentSkill, skillDisplayOrder } from './skill-labels.ts'
import { SKILL_CATEGORIES, skillCategory, skillCategoryKey, type SkillCategory } from './skill-presentation.ts'
import type { DesktopSkillBundleFile } from '../skills-contract.ts'
import { zh } from './skills-locales.ts'
import { internalSkillEntry } from '../skill-invocation-policy.ts'
import { SettingsTabs, SettingsEmptyState, SettingsButton, SettingsIconButton, SettingsToggle } from './settings-controls.tsx'
import { requestDesktopDirectory } from './directory-picker.ts'
import { DirectoryPickerDialog, type DirectoryPickerLocaleKey, type DirectoryPickerServices } from './workspace-directory-flow.tsx'

export interface SkillsSettingsSectionInjected {
  readonly api: DesktopSkillsApi
  readonly embedded?: boolean
  readonly initialSessionId?: string
  readonly onSummary?: (summary: { total: number; available: number }) => void
  readonly onCatalogChange?: () => void
  readonly onScopeApiChange?: (api: DesktopSkillsApi) => void
  readonly expertUsage?: ReadonlyMap<string, number>
  readonly directoryPicker?: DirectoryPickerServices
  readonly directoryT?: (key: DirectoryPickerLocaleKey) => string
}
export type SkillsSettingsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'desktop.skills'> & InjectFace<SkillsSettingsSectionInjected>
type SkillDraft = DesktopSkillInput & { readonly mode: 'create' | 'edit'; readonly revision?: string | undefined; readonly shared?: boolean }
const EMPTY_DRAFT: SkillDraft = { mode: 'create', name: '', description: '', whenToUse: '', instructions: '' }
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const canRecycle = (skill: DesktopSkillView): boolean => skill.editable
  && (skill.source === 'user-dsh' || skill.source === 'custom') && skill.provider === 'filesystem'
const canBrowseFiles = (skill: DesktopSkillView): boolean => ['filesystem', 'clawclaw-project-filesystem'].includes(skill.provider)

export function SkillsSettingsSection({ t, api: baseApi, embedded = false, initialSessionId, onSummary, onCatalogChange, onScopeApiChange, expertUsage, directoryPicker, directoryT }: SkillsSettingsSectionProps) {
  const locale = t('dateLocale').startsWith('zh') ? 'zh' : 'en'
  const id = useId()
  const [preset, setPreset] = useState<string>()
  const [presets, setPresets] = useState<readonly { id: string, name: string }[]>([])
  const [presetMenuOpen, setPresetMenuOpen] = useState(false)
  const [scope, setScope] = useState(initialSessionId === undefined ? 'global' : `session:${initialSessionId}`)
  const [workspaces, setWorkspaces] = useState<readonly DesktopSkillsWorkspace[]>([])
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false)
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false)
  const [sourceFilter, setSourceFilter] = useState('')
  const [groupExpansion, setGroupExpansion] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const [directoriesOpen, setDirectoriesOpen] = useState(false)
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false)
  const [detailTab, setDetailTab] = useState<'overview' | 'files'>('overview')
  const scopedApi = (selection: string, selectedPreset?: string): DesktopSkillsApi => selection.startsWith('session:')
    ? baseApi.forScope({ sessionId: selection.slice(8) }).forPreset()
    : baseApi.forScope(selection.startsWith('workspace:') ? { workspaceId: selection.slice(10) } : {}).forPreset(selectedPreset)
  const api = useMemo(() => scopedApi(scope, preset), [baseApi, scope, preset])
  useEffect(() => { onScopeApiChange?.(api) }, [api, onScopeApiChange])
  const [skills, setSkills] = useState<readonly DesktopSkillView[]>([])
  const [recycled, setRecycled] = useState<readonly DesktopRecycledSkill[]>([])
  const [locations, setLocations] = useState<DesktopSkillsView['locations']>()
  const [installed, setInstalled] = useState<DesktopSkillsView['installed']>()
  const [scanPaths, setScanPaths] = useState<readonly string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [refreshPending, setRefreshPending] = useState(false)
  const [busy, setBusy] = useState<string>()
  const [view, setView] = useState<'library' | 'recycle'>('library')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<SkillCategory>('all')
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
  const modalOpen = detail !== undefined || draft !== undefined || importOpen || purgeTarget !== undefined
  const anyModalOpen = modalOpen || directoryPickerOpen
  const disabled = loading || busy !== undefined
  useEffect(() => { onSummary?.({ total: skills.length, available: skills.filter(skill => skill.modelInvocable || skill.userInvocable).length }) }, [onSummary, skills])

  const applyView = (next: Awaited<ReturnType<DesktopSkillsApi['readView']>>): void => {
    setRefreshPending(next.refreshPending === true)
    if (next.refreshPending) return
    setSkills(next.skills); setRecycled(next.recycled); setLocations(next.locations); setInstalled(next.installed)
    setScanPaths(next.scanPaths ?? [])
    onCatalogChange?.()
  }
  const sourceLabel = (source: string): string => {
    if (source === 'user-dsh') return t('sourceUserDsh')
    if (source === 'user-agents') return t('sourceUserAgents')
    if (source === 'project-dsh') return t('sourceProjectDsh')
    if (source === 'project-agents') return t('sourceProjectAgents')
    if (source === 'custom') return t('sourceCustom')
    if (source === 'project-clawclaw') return t('sourceProjectClawClaw')
    if (source === 'external-clawclaw') return t('sourceExternalClawClaw')
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
    if (anyModalOpen) return
    // No spinner or draft replacement while Agent installs change the catalog.
    const refresh = () => { if (document.visibilityState !== 'hidden') void load(true) }
    const timer = window.setInterval(refresh, 5000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer); window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh); readEpoch.current++
    }
  }, [api, anyModalOpen])
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
      else section.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus()
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
      if (draft.mode === 'create') { setView('library'); setSearch(''); setSourceFilter(''); setCategory('all') }
      setDraft(undefined); setDiscard(false)
    })
  }
  const query = search.trim().toLocaleLowerCase()
  const filtered = useMemo(() => skills.filter(skill => (category === 'all' || skillCategory(skill.name) === category) && (sourceFilter === '' || skill.source === sourceFilter) && `${presentSkill(skill, locale).name}\n${presentSkill(skill, locale).description}\n${skill.name}\n${skill.description}\n${skill.whenToUse ?? ''}\n${sourceLabel(skill.source)}`.toLocaleLowerCase().includes(query)).sort((a, b) => skillDisplayOrder(a.name) - skillDisplayOrder(b.name) || presentSkill(a, locale).name.localeCompare(presentSkill(b, locale).name, locale)), [query, sourceFilter, category, skills, t, locale])
  const sourceOrder = ['project-clawclaw', 'project-agents', 'project-dsh', 'custom', 'external-clawclaw', 'user-dsh', 'user-agents', 'bundled', 'global']
  const sources = [...new Set(skills.map(skill => skill.source))].sort((left, right) => {
    const priority = (source: string): number => { const index = sourceOrder.indexOf(source); return index < 0 ? sourceOrder.length : index }
    return priority(left) - priority(right) || sourceLabel(left).localeCompare(sourceLabel(right))
  })
  const groupedSkills = SKILL_CATEGORIES.filter(value => value !== 'all')
    .map(category => ({ category, skills: filtered.filter(skill => skillCategory(skill.name) === category) }))
    .filter(group => group.skills.length > 0)
  const toggleGroup = (source: string, expanded: boolean): void => {
    setGroupExpansion(current => {
      const next = new Map(current)
      next.set(source, !expanded)
      return next
    })
  }
  useEffect(() => {
    if (sourceFilter !== '' && !skills.some(skill => skill.source === sourceFilter)) setSourceFilter('')
  }, [skills, sourceFilter])
  const effectivePresetLabel = locations?.preset === undefined ? undefined : presets.find(item => item.id === locations.preset)?.name ?? locations.preset
  const scopeLabel = scope.startsWith('session:')
    ? `${t('scopeSession')}${effectivePresetLabel === undefined ? '' : ` · ${effectivePresetLabel}`}`
    : workspaces.find(workspace => `workspace:${workspace.id}` === scope)?.title ?? t('scopeGlobal')
  const directoryCount = view === 'recycle' ? Number(locations !== undefined) : Number(locations !== undefined) + Number(locations?.projectLibrary !== undefined) + scanPaths.length
  const filteredRecycled = recycled.filter(skill => skill.name.toLocaleLowerCase().includes(query))
  const draftValid = draft !== undefined && SKILL_NAME.test(draft.name.trim()) && draft.description.trim() !== '' && draft.instructions.trim() !== ''
  const errorMessage = error === undefined ? null : <div className="dshIntegrationsError" role="alert">{error}</div>
  const internalEntry = detail === undefined ? undefined : internalSkillEntry(detail)
  const entrySkill = skills.find(skill => skill.name === internalEntry && (skill.modelInvocable || skill.userInvocable))
  const title = purgeTarget !== undefined ? t('permanentlyDelete') : draft !== undefined ? t(draft.mode === 'create' ? 'newSkill' : 'editSkill') : importOpen ? t('importSkill') : detail === undefined ? '' : presentSkill(detail, locale).name
  const recycleReason = (skill: DesktopSkillView): string => t(skill.source.startsWith('project-') ? 'recycleProjectRestricted' : skill.source === 'user-agents' ? 'recycleSharedRestricted' : 'recycleManagedRestricted')
  const openSkill = (skill: DesktopSkillView, trigger: HTMLElement, confirmRecycle = false): void => {
    returnFocus.current = trigger
    void run(`detail:${skill.name}`, async () => {
      const next = await api.detail(skill.name)
      setDetail(next); setDetailTab('overview'); setRecycleConfirm(confirmRecycle && canRecycle(next))
    })
  }
  const catalogActions = <div className="dshIntegrationsRowActions dshSkillsCatalogActions">
    <SettingsButton type="button" disabled={disabled} onClick={event => { returnFocus.current = event.currentTarget; setError(undefined); setImportOpen(true) }}><FileUp />{t('importRaw')}</SettingsButton>
    <SettingsButton type="button" variant="primary" disabled={disabled} onClick={event => { returnFocus.current = event.currentTarget; beginDraft({ ...EMPTY_DRAFT }) }}><Plus />{t('newSkill')}</SettingsButton>
  </div>

  return <>
    <section ref={section} className={`dshIntegrations dshSkillsPage${embedded ? ' dshIntegrationsEmbedded' : ''}`} aria-label={t('title')}>
      {!embedded && <header className="dshIntegrationsHeader"><h2>{t('title')}</h2>{catalogActions}</header>}
      <SettingsTabs id={id} label={t('title')} value={view} onChange={setView} items={[
        { value: 'library', label: <>{t('library')}<span>{skills.length}</span></> },
        { value: 'recycle', label: <>{t('recycleBin')}<span>{recycled.length}</span></> },
      ]} />
      {!modalOpen && errorMessage}
      {!modalOpen && refreshPending && <p role="status" className="dshSkillsNote">{t('skillSavedRefreshPending')}</p>}
      <section className="dshSkillsDirectories" data-open={directoriesOpen} aria-label={t('skillLocations')}>
        <header><div><button type="button" className="dshSkillsDirectoryToggle" aria-label={t('skillLocations')} aria-expanded={directoriesOpen} onClick={() => { setDirectoriesOpen(open => !open) }}><IconChevronDownOutlineMedium /><span>{t('skillLocations')}</span><small>{directoryCount}</small></button>
          {directoriesOpen && <p>{t(view === 'library' ? 'directoriesHint' : 'recycleDirectoryHint')}</p>}</div>
          {view === 'library' && <SettingsButton type="button" disabled={disabled || scanPaths.length >= 32} onClick={event => {
            if (directoryPicker !== undefined && directoryT !== undefined) {
              returnFocus.current = event.currentTarget
              setDirectoryPickerOpen(true)
              return
            }
            void run('add-scan-path', async () => {
              const path = await requestDesktopDirectory()
              if (path !== null) { await baseApi.addScanPath(path); applyView(await api.readView()); setDirectoriesOpen(true) }
            })
          }}><FolderPlus aria-hidden="true" />{t('addScanPath')}</SettingsButton>}</header>
        {directoriesOpen && <ul>
          {locations !== undefined && <li><div><span className="dshSkillsDirectoryName">{t(view === 'recycle' ? 'recycleBin' : 'userLibraryPath')}</span><small>{t('directoryManaged')}</small><code title={view === 'recycle' ? locations.recycleBin : locations.userLibrary}>{view === 'recycle' ? locations.recycleBin : locations.userLibrary}</code></div></li>}
          {view === 'library' && locations?.projectLibrary !== undefined && <li><div><span className="dshSkillsDirectoryName">{t('projectSkillDirectory')}</span><small>{t('directoryAutomatic')}</small><code title={locations.projectLibrary}>{locations.projectLibrary}</code></div></li>}
          {view === 'library' && scanPaths.map(path => <li key={path}><div><span className="dshSkillsDirectoryName">{t('externalSkillDirectory')}</span><small>{t('directoryReadOnly')}</small><code title={path}>{path}</code></div>
          <SettingsIconButton label={`${t('removeScanPath')}: ${path}`} disabled={disabled} onClick={() => {
            void run(`remove-scan-path:${path}`, async () => { await baseApi.removeScanPath(path); applyView(await api.readView()) })
          }}><Trash2 /></SettingsIconButton>
          </li>)}
        </ul>}
        {directoriesOpen && view === 'library' && scanPaths.length === 0 && <p className="dshSkillsNote">{t('noScanPaths')}</p>}
      </section>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${view}`} className="dshSkillsCatalog" aria-busy={disabled}>
        <div className="dshSkillsToolbar">
          <label className="dshIntegrationsSearch"><Search aria-hidden="true" /><input aria-label={t('searchSkills')} value={search} onChange={event => { setSearch(event.target.value) }} placeholder={t('searchSkills')} /></label>
          {view === 'library' && <Menu className="dshSkillsPresetMenu" open={sourceMenuOpen} onClose={() => { setSourceMenuOpen(false) }} compact portal selectedId={sourceFilter}
            items={[{ id: '', label: `${t('allSources')} · ${skills.length}` }, ...sources.map(source => ({ id: source, label: `${sourceLabel(source)} · ${skills.filter(skill => skill.source === source).length}` }))]}
            onSelect={next => { setSourceFilter(next); setSourceMenuOpen(false) }} anchor={<SettingsButton type="button" disabled={disabled} aria-label={t('filterSource')} aria-haspopup="menu" aria-expanded={sourceMenuOpen} onClick={() => { setSourceMenuOpen(open => !open) }}><span>{t('source')} · {sourceFilter ? sourceLabel(sourceFilter) : t('allSources')}</span><IconChevronDownOutlineMedium /></SettingsButton>} />}
          {view === 'library' && <Menu className="dshSkillsPresetMenu" open={scopeMenuOpen} onClose={() => { setScopeMenuOpen(false) }} compact portal selectedId={scope}
            items={[{ id: 'global', label: t('scopeGlobal') }, ...(initialSessionId === undefined ? [] : [{ id: `session:${initialSessionId}`, label: t('scopeSession') }]),
              ...(workspaces.length === 0 ? [] : [{ type: 'separator' as const, id: 'workspace-separator' }, { type: 'label' as const, id: 'workspace-label', text: t('scopeWorkspaces') }]),
              ...workspaces.map(workspace => ({ id: `workspace:${workspace.id}`, label: `${workspace.title} · ${workspace.path}` }))]}
            onSelect={next => {
              setScopeMenuOpen(false)
              void run('scope', async () => { const nextApi = scopedApi(next, preset); const result = await nextApi.readView(); setScope(next); applyView(result) })
            }} anchor={<SettingsButton type="button" disabled={disabled} aria-label={t('skillScope')} aria-haspopup="menu" aria-expanded={scopeMenuOpen} onClick={() => { setScopeMenuOpen(open => !open) }}>
              <span>{t('scope')} · {scopeLabel}</span><IconChevronDownOutlineMedium />
            </SettingsButton>} />}
          {view === 'library' && !scope.startsWith('session:') && (presets.length > 0 || effectivePresetLabel !== undefined) && <Menu className="dshSkillsPresetMenu" open={presetMenuOpen} onClose={() => { setPresetMenuOpen(false) }} compact portal selectedId={preset ?? locations?.preset ?? ''}
            items={[{ id: '', label: t('defaultPreset') }, ...presets.map(item => ({ id: item.id, label: item.name }))]}
            onSelect={next => {
              setPresetMenuOpen(false)
              void run('preset', async () => { const selection = next || undefined; const nextApi = api.forPreset(selection); const result = await nextApi.readView(); setPreset(selection); applyView(result) })
            }} anchor={<SettingsButton type="button" disabled={disabled} aria-label={t('agentPreset')} aria-haspopup="menu" aria-expanded={presetMenuOpen} onClick={() => { setPresetMenuOpen(open => !open) }}>
              <span>{t('agentPreset')} · {presets.find(item => item.id === preset)?.name ?? effectivePresetLabel ?? t('defaultPreset')}</span><IconChevronDownOutlineMedium />
            </SettingsButton>} />}
          <SettingsIconButton label={t('refresh')} busy={loading} disabled={disabled} onClick={() => { void load() }}><RefreshCw /></SettingsIconButton>
          {embedded && catalogActions}
          {view === 'recycle' && api.purge && <SettingsButton type="button" variant="danger" disabled={disabled || recycled.length === 0} onClick={event => { returnFocus.current = event.currentTarget; setError(undefined); setPurgeTarget([...recycled]) }}><Trash2 />{t('emptyRecycleBin')}</SettingsButton>}
        </div>
        {view === 'library' && <div className="dshSkillsCategories" role="group" aria-label={t('filterCategory')}>
          {SKILL_CATEGORIES.filter(value => value === 'all' || value === category || skills.some(skill => skillCategory(skill.name) === value)).map(value => <button key={value} type="button" aria-label={t(skillCategoryKey(value))} aria-pressed={category === value} onClick={() => { setCategory(value) }}>{t(skillCategoryKey(value))}<small aria-hidden="true">{value === 'all' ? skills.length : skills.filter(skill => skillCategory(skill.name) === value).length}</small></button>)}
        </div>}
        {loading && skills.length === 0 ? <SettingsEmptyState loading>{t('loading')}</SettingsEmptyState> : view === 'library' ? <>
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
                  {skills.some(skill => skill.name === item.name) && <div><SettingsButton type="button" disabled={disabled} onClick={event => {
                    const skill = skills.find(skill => skill.name === item.name)
                    if (skill !== undefined) openSkill(skill, event.currentTarget)
                  }}>{t('viewDetails')}: {item.name}</SettingsButton></div>}
                </>}
              </dd>
            </div>)}</dl>
          </details>}
          <div className="dshSkillsGroups">{groupedSkills.map(group => {
            const expanded = query !== '' || sourceFilter !== '' || category !== 'all' || (groupExpansion.get(group.category) ?? true)
            const collapsed = !expanded
            const groupId = `${id}-skills-${group.category}`
            return <section className="dshSkillsGroup" key={group.category} aria-label={t(skillCategoryKey(group.category))} data-collapsed={collapsed}><h3><button type="button" aria-expanded={expanded} aria-controls={groupId} onClick={() => toggleGroup(group.category, expanded)}><IconChevronDownOutlineMedium /><span>{t(skillCategoryKey(group.category))}</span><small>{group.skills.length}</small></button></h3>
            {!collapsed && <ul className="dshSkillsGrid" id={groupId}>{group.skills.map(skill => { const display = presentSkill(skill, locale); const internal = internalSkillEntry(skill); return <li key={skill.name} data-recyclable={canRecycle(skill)}>
              <button type="button" className="dshSkillsCard" title={`${display.name} · ${skill.name}`} disabled={disabled} aria-label={`${t('viewDetails')}: ${display.name}`} onClick={event => { openSkill(skill, event.currentTarget) }}>
                <SkillCategoryIcon category={skillCategory(skill.name)} />
                <span className="dshSkillsCardHeading"><strong>{display.name}</strong>{display.name !== skill.name && <small>{skill.name}</small>}</span>
                <span className="dshSkillsSummary" title={display.description}>{display.description}</span>
                <span className="dshSkillsCardOpen" aria-hidden="true"><ArrowUpRight /></span>
                <span className="dshSkillsBadges"><span className="dshSkillsCategoryBadge">{t(skillCategoryKey(skillCategory(skill.name)))}</span><span className="dshSkillsSource">{sourceLabel(skill.source)}</span>{internal !== undefined ? <span>{t('internalReference')}</span> : <><span data-enabled={skill.modelInvocable}>{t(skill.modelInvocable ? 'modelVisible' : 'modelHidden')}</span><span data-enabled={skill.userInvocable}>{t(skill.userInvocable ? 'userVisible' : 'userHidden')}</span></>}{!skill.editable && <span className="dshSkillsReadOnly">{t('readOnly')}</span>}{(expertUsage?.get(skill.name) ?? 0) > 0 && <span>{t('usedByExperts').replace('{count}', String(expertUsage?.get(skill.name) ?? 0))}</span>}</span>
              </button>
              {canRecycle(skill) && <span className="dshSkillsCardDelete"><Tooltip side="top" delayMs={350} maxWidth={240} label={t('recycle')}><span>
                <button type="button" className="dshIntegrationsIconButton" data-danger aria-label={`${t('recycle')}: ${skill.name}`} disabled={disabled} onClick={event => { openSkill(skill, event.currentTarget, true) }}><Trash2 aria-hidden="true" /></button>
              </span></Tooltip></span>}
            </li>})}</ul>}</section>
          })}</div>
          {filtered.length === 0 && <SettingsEmptyState action={(query !== '' || sourceFilter !== '' || category !== 'all') && <SettingsButton onClick={() => { setSearch(''); setSourceFilter(''); setCategory('all') }}>{t('clearFilters')}</SettingsButton>}>{t(skills.length === 0 ? 'noSkills' : 'noMatches')}</SettingsEmptyState>}
        </> : <ul className="dshSkillsRecycleList">{filteredRecycled.map(skill => <li key={skill.id}>
          <Trash2 aria-hidden="true" /><div><strong>{skill.name}</strong><span>{t('deletedAt')}: <time dateTime={skill.deletedAt}>{Number.isNaN(Date.parse(skill.deletedAt)) ? '-' : new Date(skill.deletedAt).toLocaleString(t('dateLocale'))}</time></span></div>
          <SettingsButton type="button" disabled={disabled} onClick={() => { void run(`restore:${skill.id}`, async () => { applyView(await api.restore(skill.id)) }) }}>{t('restore')}</SettingsButton>
          {api.purge && <Tooltip label={`${t('permanentlyDelete')}: ${skill.name}`}><button type="button" className="dshIntegrationsIconButton" data-danger aria-label={`${t('permanentlyDelete')}: ${skill.name}`} disabled={disabled} onClick={event => { returnFocus.current = event.currentTarget; setError(undefined); setPurgeTarget([skill]) }}><Trash2 /></button></Tooltip>}
        </li>)}{filteredRecycled.length === 0 && <li className="dshSkillsEmpty"><SettingsEmptyState>{t(recycled.length === 0 ? 'recycleEmpty' : 'noMatches')}</SettingsEmptyState></li>}</ul>}
      </div>
    </section>

    {directoryPicker !== undefined && directoryT !== undefined && <DirectoryPickerDialog
      open={directoryPickerOpen}
      busy={busy === 'add-scan-path'}
      title={t('addScanPath')}
      startPath={() => locations?.cwd}
      t={directoryT}
      {...directoryPicker}
      onCancel={() => { setDirectoryPickerOpen(false) }}
      onError={message => { setError(message) }}
      onPicked={path => {
        setDirectoryPickerOpen(false)
        void run('add-scan-path', async () => {
          await baseApi.addScanPath(path)
          applyView(await api.readView())
          setDirectoriesOpen(true)
        })
      }}
    />}

    <Modal open={modalOpen} title={title} closeLabel={t('close')} onClose={requestClose} className={`dshSkillsDialog${detail !== undefined && detailTab === 'files' ? ' dshSkillsFileDialog' : ''}`} contentClassName="dshSkillsDialogContent"
      footer={<div className="dshSkillsDialogFooter">
        {purgeTarget !== undefined ? <div className="dshIntegrationsRowActions">
          <SettingsButton type="button" disabled={disabled} onClick={close}>{t('cancel')}</SettingsButton>
          <SettingsButton type="button" variant="danger" disabled={disabled} onClick={() => { void run('purge', async () => {
            if (!api.purge) return
            const result = await api.purge(purgeTarget.map(item => item.id))
            setRecycled(current => current.filter(item => !result.deleted.includes(item.id)))
            if (result.failed.length > 0) { setPurgeTarget(purgeTarget.filter(item => result.failed.includes(item.id))); setError(t('purgeFailed')) }
            else setPurgeTarget(undefined)
          }) }}><Trash2 />{t('permanentlyDelete')}</SettingsButton>
        </div> : discard ? <div className="dshSkillsConfirmation" role="alert"><span>{t('discardChanges')}</span><div className="dshIntegrationsRowActions"><SettingsButton type="button" onClick={() => { setDiscard(false) }}>{t('keepEditing')}</SettingsButton><SettingsButton type="button" variant="danger" onClick={close}>{t('discard')}</SettingsButton></div></div>
          : recycleConfirm && detail !== undefined ? <div className="dshSkillsConfirmation" role="alert"><span>{t('confirmRecycle')}</span><div className="dshIntegrationsRowActions"><SettingsButton type="button" disabled={disabled} onClick={() => { setRecycleConfirm(false) }}>{t('cancel')}</SettingsButton><SettingsButton type="button" variant="danger" disabled={disabled} onClick={() => { void run('recycle', async () => { applyView(await api.recycle(detail.name)); setDetail(undefined); setRecycleConfirm(false) }) }}>{t('recycle')}</SettingsButton></div></div>
          : <>
            {detail !== undefined && <div className="dshSkillsDeleteAction">
              {canRecycle(detail) && <SettingsButton type="button" variant="danger" disabled={disabled} onClick={() => { setRecycleConfirm(true) }}><Trash2 aria-hidden="true" />{t('recycle')}</SettingsButton>}
              {!canRecycle(detail) && <p id={`${id}-recycle-reason`} className="dshSkillsNote">{recycleReason(detail)}</p>}
            </div>}
            <div className="dshIntegrationsRowActions">
              <SettingsButton type="button" disabled={disabled} onClick={requestClose}>{t(detail === undefined ? 'cancel' : 'close')}</SettingsButton>
              {detail?.editable && <SettingsButton type="button" disabled={disabled} onClick={() => { beginDraft({ mode: 'edit', revision: detail.revision, shared: detail.source === 'user-agents', name: detail.name, description: detail.description, whenToUse: detail.whenToUse ?? '', instructions: detail.content }) }}><Pencil />{t('edit')}</SettingsButton>}
              {draft !== undefined && <SettingsButton type="submit" form={`${id}-form`} variant="primary" disabled={disabled || !draftValid}>{busy === 'save' ? t('saving') : t(draft.mode === 'create' ? 'create' : 'save')}</SettingsButton>}
              {importOpen && <SettingsButton type="button" variant="primary" disabled={disabled || (bundle === undefined && importText.trim() === '')} onClick={() => { void run('import', async () => {
                applyView(bundle !== undefined && api.importBundle ? await api.importBundle(bundle) : await api.importDocument(importText))
                setBundle(undefined); setImportText(''); setFileName(''); setImportOpen(false); setView('library'); setSearch(''); setSourceFilter('')
              }) }}>{busy === 'import' ? t('importing') : t('import')}</SettingsButton>}
            </div>
          </>}
      </div>}>
      <div ref={modalBody} className="dshSkillsDialogBody" aria-busy={disabled}>
        {modalOpen && errorMessage}
        {draft?.shared && <p className="dshSkillsNote">{t('sharedSkillEditImpact')}</p>}
        {purgeTarget !== undefined && <><p className="dshSkillsDescription">{t('purgeWarning')}</p><p className="dshSkillsNote">{t('purgeCount')}: {purgeTarget.length}</p><ul className="dshSkillBundleList">{purgeTarget.map(item => <li key={item.id}>{item.name}</li>)}</ul></>}
        {draft?.mode === 'edit' && error === t('skillEditConflict') && <SettingsButton type="button" disabled={disabled} onClick={() => {
          void run('compare', async () => { setConflictDetail(await api.detail(draft.name)) })
        }}>{t('reviewLatest')}</SettingsButton>}
        {draft?.mode === 'edit' && conflictDetail !== undefined && <section className="dshSkillsInstructions">
          <h3>{t('latestVersion')}</h3><p className="dshSkillsDescription">{conflictDetail.description}</p>
          {conflictDetail.whenToUse && <p className="dshSkillsNote">{conflictDetail.whenToUse}</p>}<pre>{conflictDetail.content}</pre>
          <SettingsButton type="button" disabled={disabled || conflictDetail.revision === undefined} onClick={() => {
            setDraft({ ...draft, revision: conflictDetail.revision }); setConflictDetail(undefined)
          }}>{t('confirmDraftVersion')}</SettingsButton>
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
          <div className="dshSkillsFileRow"><SettingsButton type="button" disabled={disabled} onClick={() => { fileInput.current?.click() }}><FileUp />{t('chooseFile')}</SettingsButton>
            {api.importBundle && <SettingsButton type="button" disabled={disabled} onClick={() => { folderInput.current?.click() }}><FileUp />{t('chooseFolder')}</SettingsButton>}<span>{fileName || t('fileLimit')}</span></div>
          {bundle === undefined ? <><label>{t('rawDocument')}<textarea className="dshSkillsCode" rows={12} disabled={disabled} value={importText} onChange={event => { setImportText(event.target.value) }} placeholder={t('importPlaceholder')} /></label><p className="dshSkillsNote">{t('importHint')}</p></>
            : <><p className="dshSkillsNote">{t('skillBundleHint')}</p><ul className="dshSkillBundleList">{bundle.map(file => <li key={file.path}><code>{file.path}</code></li>)}</ul></>}
        </div>}
        {detail !== undefined && <>
          {canBrowseFiles(detail) && detail.path !== undefined && api.files && api.file && <SettingsTabs id={`${id}-detail`} label={t('viewDetails')} value={detailTab} onChange={setDetailTab}
            items={[{ value: 'overview', label: t('skillOverview') }, { value: 'files', label: t('skillFiles') }]} />}
          <div id={`${id}-detail-panel`} className="dshSkillsDetailPanel" role={api.files && api.file && detail.path !== undefined && canBrowseFiles(detail) ? 'tabpanel' : undefined} aria-label={t(detailTab === 'overview' ? 'skillOverview' : 'skillFiles')}>
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
          {internalEntry !== undefined ? <div className="dshSkillsNote">
            <p>{t('internalReferenceHint')}</p>
            <p>{t('entrySkill')}: {skills.find(skill => skill.name === internalEntry) === undefined ? internalEntry : presentSkill(skills.find(skill => skill.name === internalEntry)!, locale).name}</p>
            {entrySkill === undefined ? <p>{t('entryUnavailable')}</p> : <SettingsButton type="button" disabled={disabled} onClick={() => {
              void run(`detail:${entrySkill.name}`, async () => { setDetail(await api.detail(entrySkill.name)); setDetailTab('overview') })
            }}>{t('viewEntrySkill')}</SettingsButton>}
          </div> : <>
          {!detail.modelInvocable && !detail.userInvocable && <p className="dshSkillsNote">{t(detail.editable ? 'invocationOffHint' : 'managedInvocationOffHint')}</p>}
          <div className="dshSkillsInvocation">
            <div><span>{t('modelInvocation')}</span><SettingsToggle label={t('modelInvocation')} checked={detail.modelInvocable} disabled={disabled || !detail.editable} onChange={enabled => { void run('model-toggle', async () => { setSkills(await api.setModelInvocable(detail.name, enabled)); setDetail({ ...detail, modelInvocable: enabled }) }) }} /></div>
            <div><span>{t('userInvocation')}</span><SettingsToggle label={t('userInvocation')} checked={detail.userInvocable} disabled={disabled || !detail.editable} onChange={enabled => { void run('user-toggle', async () => { setSkills(await api.setUserInvocable(detail.name, enabled)); setDetail({ ...detail, userInvocable: enabled }) }) }} /></div>
          </div>
          </>}
          <section className="dshSkillsInstructions"><h3>{t('skillContent')}</h3><pre>{detail.content}</pre></section>
          </> : <SkillFiles key={detail.name} name={detail.name} api={api} t={t} />}
          </div>
        </>}
      </div>
    </Modal>
  </>
}
