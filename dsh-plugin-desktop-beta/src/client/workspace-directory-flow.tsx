import { useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from './workspace-client-contract.ts'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { ChevronRight, Folder, FolderOpen, FolderPlus } from 'lucide-react'
import type { DesktopWorkspaceSettings } from '../workspace-settings.ts'
import { DESKTOP_WORKSPACE_SETTINGS_NAMESPACE } from '../workspace-settings.ts'
import type { DesktopDirectoryPickerWindow } from './directory-picker.ts'

const NS = 'desktop.directory-picker'
const COPY = {
  en: { title: 'Select workspace directory', home: 'Home', path: 'Directory path', go: 'Go', native: 'Use system picker', create: 'New folder', name: 'Folder name', save: 'Create', cancel: 'Cancel', select: 'Select this directory', hidden: 'Show hidden folders', loading: 'Loading…', empty: 'No subfolders', truncated: 'Only part of this directory is shown.', retry: 'Retry' },
  zh: { title: '选择工作区目录', home: '主目录', path: '目录路径', go: '前往', native: '使用系统选择器', create: '新建文件夹', name: '文件夹名称', save: '创建', cancel: '取消', select: '选择此目录', hidden: '显示隐藏文件夹', loading: '加载中…', empty: '此目录中没有子文件夹', truncated: '目录较大，仅显示部分文件夹。', retry: '重试' },
}
type Key = keyof typeof COPY.en
export interface DirectoryFlowOwnerProps {
  open: boolean
  busy: boolean
  onPicked: (path: string) => void
  onCancel: () => void
  onError: (message: string) => void
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop.directory-picker': Key }
  interface SlotMap {
    'conversation.hero.workspace.directoryFlow': { kind: 'single'; scope: 'root'; owner: DirectoryFlowOwnerProps }
    'sidebar.workspaces.directoryFlow': { kind: 'single'; scope: 'root'; owner: DirectoryFlowOwnerProps }
  }
}
export interface DirectoryFlowServices {
  startPath: () => string | undefined
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
  createDirectory: (path: string, name: string) => Promise<string>
  pickNative?: (hidden: boolean) => Promise<string | null>
  t: (key: Key) => string
}

export function WorkspaceDirectoryFlow(props: DirectoryFlowOwnerProps & DirectoryFlowServices) {
  const { open, busy, onCancel, onPicked, t } = props
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [hidden, setHidden] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const request = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const services = useRef(props)
  services.current = props
  const panel = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const disabled = busy || loading || working
  const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause)

  async function load(path?: string, fallback = false) {
    const id = ++request.current
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setLoading(true)
    setError('')
    try {
      let next: DirectoryListing
      try { next = await services.current.listDirectory(path, abort.signal) }
      catch (cause) {
        if (!fallback || !path || abort.signal.aborted) throw cause
        next = await services.current.listDirectory(undefined, abort.signal)
      }
      if (id !== request.current) return
      setListing(next)
      setDraft(next.path)
      setCreating(false)
      if (body.current) body.current.scrollTop = 0
    } catch (cause) {
      if (id === request.current) setError(message(cause))
    } finally {
      if (id === request.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    setListing(null)
    setHidden(false)
    setCreating(false)
    setWorking(false)
    setDraft('')
    void load(services.current.startPath(), true)
    panel.current?.focus()
    return () => { request.current++; controller.current?.abort(); previous?.focus() }
  }, [open])

  async function native() {
    const id = request.current
    setWorking(true)
    setError('')
    try {
      const path = await props.pickNative?.(hidden)
      if (id === request.current && path) await load(path)
    } catch (cause) { if (id === request.current) setError(message(cause)) }
    finally { setWorking(false) }
  }
  async function create() {
    if (!listing || !name.trim() || disabled) return
    const id = request.current
    setWorking(true)
    setError('')
    try {
      const path = await props.createDirectory(listing.path, name.trim())
      if (id === request.current) await load(path)
    } catch (cause) { if (id === request.current) setError(message(cause)) }
    finally { setWorking(false) }
  }
  const close = () => { if (!busy && !working) onCancel() }
  const entries = listing?.entries.filter(entry => hidden || !entry.hidden) ?? []
  const homeIndex = listing?.crumbs.findIndex(crumb => crumb.path === listing.home) ?? -1
  const crumbs = homeIndex < 0 ? listing?.crumbs : listing?.crumbs.slice(homeIndex)
  return <Modal open={open} title={t('title')} headless onClose={close} className="ccWorkspaceDirectory">
    <div ref={panel} tabIndex={-1} className="ccWorkspaceDirectoryPanel" onKeyDown={event => {
      if (event.key !== 'Tab') return
      const elements = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
      const first = elements?.[0], last = elements?.[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus() }
    }}>
      <header><h2>{t('title')}</h2>
        <nav aria-label={t('path')}>{crumbs?.map((crumb, index) => <span key={crumb.path}>
          {index > 0 && <ChevronRight size={14} aria-hidden="true" />}
          <button disabled={disabled} title={crumb.path} aria-current={index === crumbs.length - 1 ? 'page' : undefined} onClick={() => void load(crumb.path)}>{crumb.path === listing?.home ? t('home') : crumb.name || crumb.path}</button>
        </span>)}</nav>
        <form className="ccDirectoryPath" onSubmit={event => { event.preventDefault(); if (!disabled && draft.trim()) void load(draft.trim()) }}>
          <div>{props.pickNative && <button type="button" disabled={disabled} title={t('native')} aria-label={t('native')} onClick={() => void native()}><FolderOpen size={18} /></button>}
            <input aria-label={t('path')} value={draft} disabled={disabled} spellCheck={false} onChange={event => { setDraft(event.target.value); setError('') }} /></div>
          <button disabled={disabled || !draft.trim()}>{t('go')}</button>
        </form>
      </header>
      <div className="ccDirectoryBody" ref={body} aria-busy={loading}>
        {loading && <p role="status">{t('loading')}</p>}
        {!loading && listing && entries.length === 0 && <p>{t('empty')}</p>}
        <ul>{entries.map(entry => <li key={entry.path}><button disabled={disabled} onClick={() => void load(entry.path)} title={entry.path}><Folder size={18} /><span>{entry.name}</span><ChevronRight size={16} /></button></li>)}</ul>
        {listing?.truncated && <p>{t('truncated')}</p>}
      </div>
      {error && <div className="ccDirectoryError" role="alert">{error} {!listing && <button disabled={disabled} onClick={() => void load(props.startPath(), true)}>{t('retry')}</button>}</div>}
      {creating && <form className="ccDirectoryCreate" onSubmit={event => { event.preventDefault(); void create() }}>
        <input autoFocus aria-label={t('name')} placeholder={t('name')} value={name} disabled={disabled} onChange={event => setName(event.target.value)} />
        <button disabled={disabled || !name.trim()}>{t('save')}</button><button type="button" disabled={disabled} onClick={() => setCreating(false)}>{t('cancel')}</button>
      </form>}
      <footer><div><button disabled={disabled || !listing} onClick={() => { setName(''); setCreating(true) }}><FolderPlus size={16} />{t('create')}</button>
        <label><input type="checkbox" checked={hidden} disabled={disabled} onChange={event => setHidden(event.target.checked)} />{t('hidden')}</label></div>
        <div><button disabled={busy || working} onClick={close}>{t('cancel')}</button><button className="ccDirectoryPrimary" disabled={disabled || creating || !listing || draft !== listing.path} onClick={() => listing && onPicked(listing.path)}>{t('select')}</button></div>
      </footer>
    </div>
  </Modal>
}

export function applyWorkspaceDirectoryFlow(ctx: Context) {
  ctx.inject(['uiWorkspace', 'workspaces', 'settingsScope', 'locale', 'slots'], scope => {
    const settings = scope.settingsScope.bind<DesktopWorkspaceSettings>({ namespace: DESKTOP_WORKSPACE_SETTINGS_NAMESPACE })
    scope.effect(() => scope.locale.register(NS, COPY))
    const injected = (): DirectoryFlowServices => ({
      startPath: () => {
        const value = settings.getSnapshot().value
        const items = scope.workspaces.list.getSnapshot().items
        return items.find(item => item.workspaceId === value?.activeWorkspaceId)?.path
          ?? items.find(item => item.workspaceId === value?.defaultWorkspaceId)?.path
      },
      listDirectory: (path, signal) => scope.uiWorkspace.listDirectory(path, signal),
      createDirectory: (path, name) => scope.uiWorkspace.createDirectory(path, name),
      ...((window as DesktopDirectoryPickerWindow).__DSH_DESKTOP_PICK_DIRECTORY__ ? {
        pickNative: (showHiddenFiles: boolean) => (window as DesktopDirectoryPickerWindow).__DSH_DESKTOP_PICK_DIRECTORY__!({ showHiddenFiles }),
      } : {}),
      t: scope.locale.bind(NS),
    })
    for (const name of ['conversation.hero.workspace.directoryFlow', 'sidebar.workspaces.directoryFlow'] as const) {
      scope.slots.inject(name, () => scope.slots.register({ name, priority: -100, inject: injected }, WorkspaceDirectoryFlow))
    }
    scope.effect(() => {
      const style = document.createElement('style')
      style.textContent = DIRECTORY_STYLES
      document.head.append(style)
      return () => style.remove()
    })
  })
}

export const DIRECTORY_STYLES = `
.ccWorkspaceDirectory { width: min(680px, 100%); padding: 0; overflow: hidden; }
.ccWorkspaceDirectoryPanel { display: flex; flex-direction: column; height: min(560px, calc(100dvh - 32px)); outline: none; color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-bg-layer-1, #fff); font-size: 14px; }
.ccWorkspaceDirectoryPanel header { padding: 20px 24px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1, #e7e7e7); }
.ccWorkspaceDirectoryPanel h2 { margin: 0 0 12px; font-size: 16px; line-height: 24px; }
.ccWorkspaceDirectoryPanel button, .ccWorkspaceDirectoryPanel input { font: inherit; color: inherit; }
.ccWorkspaceDirectoryPanel button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 12px; border: 1px solid var(--dsw-alias-border-l2, #ddd); border-radius: 6px; background: transparent; cursor: pointer; }
.ccWorkspaceDirectoryPanel button:disabled { opacity: .45; cursor: default; }
.ccWorkspaceDirectoryPanel button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f3f4f5); }
.ccWorkspaceDirectoryPanel :focus-visible { outline: 2px solid #5685c4; outline-offset: 2px; }
.ccWorkspaceDirectoryPanel nav { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; min-height: 28px; margin-bottom: 8px; color: var(--dsw-alias-label-tertiary, #8f959e); }
.ccWorkspaceDirectoryPanel nav span { display: inline-flex; align-items: center; min-width: 0; max-width: 100%; }
.ccWorkspaceDirectoryPanel nav button { max-width: 210px; min-width: 0; display: block; overflow: hidden; border: 0; padding: 3px 5px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, #646a73); text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.ccWorkspaceDirectoryPanel nav button[aria-current="page"] { color: var(--dsw-alias-label-primary, #1f2329); font-weight: 650; }
.ccWorkspaceDirectoryPanel nav button:hover:not(:disabled) { color: var(--dim-blue, #3370ff); background: var(--dim-blue-soft, #3370ff14); }
.ccDirectoryPath, .ccDirectoryCreate { display: flex; gap: 8px; }
.ccDirectoryPath > div { display: flex; flex: 1; min-width: 0; border: 1px solid var(--dsw-alias-border-l2, #ddd); border-radius: 6px; }
.ccDirectoryPath > div button { border: 0; padding: 7px; }
.ccDirectoryPath input { flex: 1; width: 0; min-width: 0; border: 0; background: transparent; padding: 8px; }
.ccDirectoryBody { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px; }
.ccDirectoryBody ul { list-style: none; padding: 0; margin: 0; }
.ccDirectoryBody li button { width: 100%; border: 0; min-height: 38px; justify-content: flex-start; }
.ccDirectoryBody li span { flex: 1; min-width: 0; overflow-wrap: anywhere; text-align: left; }
.ccDirectoryBody svg { flex-shrink: 0; color: var(--dsw-alias-label-secondary, #777); }
.ccDirectoryBody p { color: var(--dsw-alias-label-secondary, #777); padding: 0 8px; }
.ccDirectoryError { padding: 8px 24px; color: #be3838; overflow-wrap: anywhere; }
.ccDirectoryCreate { padding: 8px 24px; }
.ccDirectoryCreate input { width: 0; flex: 1; min-width: 0; border: 1px solid var(--dsw-alias-border-l2, #ddd); border-radius: 6px; background: transparent; padding: 8px; }
.ccWorkspaceDirectoryPanel footer { display: flex; justify-content: space-between; gap: 12px; padding: 16px 24px; border-top: 1px solid var(--dsw-alias-border-l1, #e7e7e7); flex-wrap: wrap; }
.ccWorkspaceDirectoryPanel footer > div { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ccWorkspaceDirectoryPanel label { display: flex; align-items: center; gap: 5px; font-size: 13px; }
.ccWorkspaceDirectoryPanel .ccDirectoryPrimary { background: var(--dsw-alias-label-primary, #222); color: var(--dsw-alias-bg-layer-1, #fff); }
.ccWorkspaceDirectoryPanel .ccDirectoryPrimary:hover:not(:disabled) { opacity: .85; background: var(--dsw-alias-label-primary, #222); }
@media(max-width: 520px) { .ccWorkspaceDirectoryPanel header { padding: 16px; } .ccWorkspaceDirectoryPanel footer { padding: 12px 16px; } .ccWorkspaceDirectoryPanel footer > div:last-child { margin-left: auto; } }
`
