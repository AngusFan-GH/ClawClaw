/** Configurable panel and Settings shortcuts projected through rc.2 sidebar entries. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ComponentType, DragEvent, KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { Plus, X } from 'lucide-react'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PANEL_SETTINGS_PREFIX, registerEntryProjection, ShortcutSettingsShell, settingsMenuSectionId, settingsMenuOrder } from './shortcut-presentation.tsx'
import { DesktopFeatureIcon } from './desktop-feature-icon.tsx'

import { DESKTOP_SHORTCUTS_LOCALE_NAMESPACE, DESKTOP_SHORTCUTS_SETTINGS_ENTRY_ID, PLUGINS_PANEL_ID, AUTOMATIONS_PANEL_ID,
  MAX_SHORTCUTS, SETTINGS_TARGET_PREFIX, normalizeShortcutItems, shortcutPanelId, reorderShortcutItems } from './shortcut-menu-model.ts'
import type { DesktopShortcutSettings, ShortcutTarget } from './shortcut-menu-model.ts'
export { DESKTOP_SHORTCUTS_LOCALE_NAMESPACE, DESKTOP_SHORTCUTS_SETTINGS_ENTRY_ID, PLUGINS_PANEL_ID, AUTOMATIONS_PANEL_ID,
  normalizeShortcutItems, shortcutPanelId, reorderShortcutItems } from './shortcut-menu-model.ts'
export type { DesktopShortcutSettings, ShortcutTarget } from './shortcut-menu-model.ts'

interface ShortcutTargets { getSnapshot(): readonly ShortcutTarget[]; subscribe(listener: () => void): () => void }

interface ShortcutDragState {
  readonly id: string
  readonly over: { readonly id: string; readonly half: 'before' | 'after' } | null
}

interface SettingsNavIconMount {
  readonly id: string
  readonly targetId: string
  readonly kind: ShortcutTarget['kind']
  readonly node: HTMLSpanElement
  readonly className?: string
}

function sameShortcutTargets(left: readonly ShortcutTarget[], right: readonly ShortcutTarget[]): boolean {
  return left.length === right.length && left.every((target, index) => {
    const candidate = right[index]
    return candidate !== undefined
      && target.id === candidate.id
      && target.targetId === candidate.targetId
      && target.label === candidate.label
      && target.kind === candidate.kind
      && target.order === candidate.order
  })
}

export const zh = {
  title: '快捷入口', intro: '已固定的入口在侧栏直接打开，其余在设置弹框中显示。最多固定 4 项。', selected: '已固定', available: '可添加', add: '添加', remove: '移除', reorder: '拖拽排序', plugins: '插件', automations: '自动化任务',
} as const
export type DesktopShortcutsLocaleKey = keyof typeof zh
export const en: Record<DesktopShortcutsLocaleKey, string> = {
  title: 'Shortcuts', intro: 'Pinned entries open in the main area; other entries appear in the Settings dialog. Pin up to 4.', selected: 'Pinned', available: 'Available', add: 'Add', remove: 'Remove', reorder: 'Drag to reorder', plugins: 'Plugins', automations: 'Automations',
}

function useScope<T>(scope: ConfigForm<T>): T | undefined {
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const snapshot = useCallback(() => scope.getSnapshot(), [scope])
  return useSyncExternalStore(subscribe, snapshot, snapshot).value
}

function useTargets(targets: ShortcutTargets): readonly ShortcutTarget[] {
  return useSyncExternalStore(listener => targets.subscribe(listener), () => targets.getSnapshot(), () => targets.getSnapshot())
}

/** Match the native drag acceptance used by the session history list. */
function useNativeDragAcceptance(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const acceptDrag = (event: globalThis.DragEvent): void => {
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    }
    const acceptDrop = (event: globalThis.DragEvent): void => { event.preventDefault() }
    document.addEventListener('dragover', acceptDrag)
    document.addEventListener('drop', acceptDrop)
    return () => {
      document.removeEventListener('dragover', acceptDrag)
      document.removeEventListener('drop', acceptDrop)
    }
  }, [active])
}

function rowHalf(event: { readonly clientY: number; readonly currentTarget: HTMLElement }): 'before' | 'after' {
  const bounds = event.currentTarget.getBoundingClientRect()
  return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
}

function ShortcutIcon({ target, size = 16 }: { readonly target: ShortcutTarget; readonly size?: number }): JSX.Element {
  return <DesktopFeatureIcon featureId={target.targetId} kind={target.kind} size={size} />
}

type ShortcutSettingsProps = PropsRuntime<'settings.general.item'> & PropsLocale<'desktop.shortcuts'> & {
  readonly shortcutSettings: ConfigForm<DesktopShortcutSettings>
  readonly shortcutTargets: ShortcutTargets
}

function IconButton({ label, disabled, onClick, children }: {
  readonly label: string
  readonly disabled?: boolean
  readonly onClick: () => void
  readonly children: JSX.Element
}): JSX.Element {
  return <button className="dshShortcutIconButton" type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}>{children}</button>
}

export function ShortcutSettingsRow({ t, shortcutSettings, shortcutTargets }: ShortcutSettingsProps): JSX.Element {
  const settings = useScope(shortcutSettings)
  const targets = useTargets(shortcutTargets)
  const items = normalizeShortcutItems(settings?.items, targets)
  const save = (next: readonly string[]): void => { void shortcutSettings.set('items', next) }
  const definitions = useMemo(() => new Map(targets.map(item => [item.id, item])), [targets])
  const [drag, setDrag] = useState<ShortcutDragState | null>(null)
  const dropCommitted = useRef(false)
  useNativeDragAcceptance(drag !== null)
  const commitDrag = (activeDrag: ShortcutDragState, over: NonNullable<ShortcutDragState['over']>): void => {
    if (dropCommitted.current) return
    dropCommitted.current = true
    setDrag(null)
    const next = reorderShortcutItems(items, activeDrag.id, over.id, over.half)
    if (next !== items) save(next)
  }
  const shift = (id: string, offset: -1 | 1): void => {
    const index = items.indexOf(id)
    const target = index + offset
    if (index < 0 || target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    save(next)
  }
  const startDrag = (event: DragEvent<HTMLDivElement>, id: string): void => {
    dropCommitted.current = false
    setDrag({ id, over: null })
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }
  const updateDropTarget = (event: DragEvent<HTMLDivElement>, id: string): void => {
    if (drag === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const half = rowHalf(event)
    setDrag(current => current === null ? current : { ...current, over: { id, half } })
  }
  const drop = (event: DragEvent<HTMLDivElement>, id: string): void => {
    if (drag === null) return
    event.preventDefault()
    commitDrag(drag, { id, half: rowHalf(event) })
  }
  const finishDrag = (): void => {
    if (drag?.over !== null && drag?.over !== undefined) commitDrag(drag, drag.over)
    else setDrag(null)
    dropCommitted.current = false
  }
  const reorderWithKeyboard = (event: KeyboardEvent<HTMLDivElement>, id: string): void => {
    if (event.currentTarget !== event.target) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    shift(id, event.key === 'ArrowUp' ? -1 : 1)
  }
  return <section className="dshShortcutSettings">
    <header><h3>{t('title')}</h3><p>{t('intro')}</p></header>
    <div className="dshShortcutGroups">
      <div className="dshShortcutGroup"><h4>{t('available')}</h4>{targets.filter(item => !items.includes(item.id)).map(item => <div className="dshShortcutRow" key={item.id}><ShortcutIcon target={item} /><span>{item.label}</span><IconButton label={`${t('add')}: ${item.label}`} disabled={items.length >= MAX_SHORTCUTS} onClick={() => { save([...items, item.id]) }}><Plus size={14} /></IconButton></div>)}</div>
      <div className="dshShortcutGroup"><h4>{t('selected')}</h4>{items.map(id => {
        const item = definitions.get(id)!
        const placement = drag?.over?.id === id ? drag.over.half : undefined
        return <div className="dshShortcutRow dshShortcutSelectedRow" data-dragging={drag?.id === id || undefined} data-drop-position={placement} key={id} draggable tabIndex={0} title={`${t('reorder')}: ${item.label}`} aria-label={`${t('reorder')}: ${item.label}`} onDragStart={event => { startDrag(event, id) }} onDragEnd={finishDrag} onDragOver={event => { updateDropTarget(event, id) }} onDrop={event => { drop(event, id) }} onKeyDown={event => { reorderWithKeyboard(event, id) }}>
          <ShortcutIcon target={item} /><span>{item.label}</span><div className="dshShortcutActions"><IconButton label={`${t('remove')}: ${item.label}`} onClick={() => { save(items.filter(current => current !== id)) }}><X size={14} /></IconButton></div>
        </div>
      })}</div>
    </div>
  </section>
}

interface ShortcutSettingsPanelInjected {
  readonly sectionComponent: ComponentType<Record<string, unknown>>
  readonly returnToConversation: () => void
}
type ShortcutSettingsPanelProps = PropsRuntime<'main'> & InjectFace<ShortcutSettingsPanelInjected> & Record<string, unknown>

/** Render one Settings section as a real main panel while preserving its original runtime shares. */
export function ShortcutSettingsPanel({ sectionComponent: Section, returnToConversation, ...props }: ShortcutSettingsPanelProps): JSX.Element {
  return <main className="dshShortcutPage"><Section {...props} close={returnToConversation} /></main>
}

interface ShortcutPanelIconInjected { readonly target: ShortcutTarget }
type ShortcutPanelIconProps = PropsRuntime<'sidebar.panellist'> & InjectFace<ShortcutPanelIconInjected>

export function ShortcutPanelIcon({ target, size }: ShortcutPanelIconProps): JSX.Element {
  return <ShortcutIcon target={target} size={size} />
}

/** Icons follow the same visible-row projection as the Settings shell. */
export function SettingsNavIconBridge({ shortcutSettings, shortcutTargets }: {
  readonly shortcutSettings: ConfigForm<DesktopShortcutSettings>
  readonly shortcutTargets: ShortcutTargets
}): JSX.Element {
  const settings = useScope(shortcutSettings)
  const targets = useTargets(shortcutTargets)
  const visible = useMemo(() => {
    const selected = normalizeShortcutItems(settings?.items, targets)
    return targets.filter(target => !selected.includes(target.id))
      .sort((a, b) => settingsMenuOrder(a, targets) - settingsMenuOrder(b, targets))
  }, [settings?.items, targets])
  const [mounts, setMounts] = useState<readonly SettingsNavIconMount[]>([])
  useLayoutEffect(() => {
    const dialog = document.querySelector<HTMLElement>('[data-shortcut-modal="settings"]')
    const buttons = dialog === null ? [] : [...dialog.querySelectorAll<HTMLButtonElement>('nav button')]
    const cleanups: Array<() => void> = []
    setMounts(visible.flatMap((target, index): SettingsNavIconMount[] => {
      const button = buttons[index]
      const previous = button?.querySelector<SVGElement>(':scope > svg')
      if (button === undefined || previous === null || previous === undefined) return []
      const node = document.createElement('span')
      node.dataset.desktopSettingsIcon = target.targetId
      node.style.display = 'contents'
      button.insertBefore(node, previous)
      const display = previous.style.display
      previous.style.display = 'none'
      cleanups.push(() => { previous.style.display = display; node.remove() })
      const className = previous.getAttribute('class') ?? undefined
      return [{ id: target.id, targetId: target.targetId, kind: target.kind, node, ...(className === undefined ? {} : { className }) }]
    }))
    return () => { cleanups.reverse().forEach(cleanup => { cleanup() }) }
  }, [visible])
  return <>{mounts.map(mount => createPortal(<DesktopFeatureIcon featureId={mount.targetId} kind={mount.kind} size={16}
    {...(mount.className === undefined ? {} : { className: mount.className })} />, mount.node, mount.id))}</>
}

function createShortcutTargets(ctx: ClientContext): ShortcutTargets {
  let sectionsVersion = -1
  let panelsVersion = -1
  let localeRevision = -1
  let snapshot: readonly ShortcutTarget[] = []
  const targets: ShortcutTargets = {
    getSnapshot: () => {
      const nextSectionsVersion = ctx.slots.getVersion('settings.section')
      const nextPanelsVersion = ctx.slots.getVersion('main')
      const nextLocaleRevision = ctx.locale.getSnapshot().revision
      if (nextSectionsVersion !== sectionsVersion || nextPanelsVersion !== panelsVersion || nextLocaleRevision !== localeRevision) {
        sectionsVersion = nextSectionsVersion
        panelsVersion = nextPanelsVersion
        localeRevision = nextLocaleRevision
        const t = ctx.locale.bind(DESKTOP_SHORTCUTS_LOCALE_NAMESPACE)
        const mainPanels = new Set(ctx.slots.entriesOfSlot('main').map(entry => entry.options.key))
        const panelCandidates: ShortcutTarget[] = [
          { id: PLUGINS_PANEL_ID, targetId: PLUGINS_PANEL_ID, label: t('plugins'), kind: 'panel' },
          { id: AUTOMATIONS_PANEL_ID, targetId: AUTOMATIONS_PANEL_ID, label: t('automations'), kind: 'panel' },
        ]
        const panels = panelCandidates.filter(target => mainPanels.has(target.id))
        const sections = ctx.slots.entriesOfSlot('settings.section').filter(entry => !entry.options.id?.startsWith(PANEL_SETTINGS_PREFIX)).map(entry => ({
          id: entry.options.id ?? '',
          label: resolveSlotLabel(entry.options.label) ?? '',
          order: entry.options.order ?? 0,
        })).filter(section => section.id.length > 0 && section.label.length > 0)
          .sort((a, b) => a.order - b.order).map(({ id, label, order }) => ({
            id: `${SETTINGS_TARGET_PREFIX}${id}`, targetId: id, label, order, kind: 'settings' as const,
          }))
        const nextSnapshot = [...panels, ...sections]
        if (!sameShortcutTargets(snapshot, nextSnapshot)) snapshot = nextSnapshot
      }
      return snapshot
    },
    subscribe: listener => {
      let previous = targets.getSnapshot()
      const notifyWhenChanged = (): void => {
        const next = targets.getSnapshot()
        if (next === previous) return
        previous = next
        listener()
      }
      const offSlots = ctx.slots.subscribe('settings.section', notifyWhenChanged)
      const offPanels = ctx.slots.subscribe('main', notifyWhenChanged)
      const offLocale = ctx.locale.subscribe(notifyWhenChanged)
      return () => { offSlots(); offPanels(); offLocale() }
    },
  }
  return targets
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop.shortcuts': DesktopShortcutsLocaleKey }
}

export function applyShortcutMenu(ctx: ClientContext): void {
  const shortcutSettings = ctx.configForms.get<DesktopShortcutSettings>(DESKTOP_SHORTCUTS_SETTINGS_ENTRY_ID)
  const shortcutTargets = createShortcutTargets(ctx)
  ctx.effect(() => ctx.locale.register(DESKTOP_SHORTCUTS_LOCALE_NAMESPACE, { zh, en }), 'dsh-plugin-desktop: shortcut menu dictionaries')
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'desktop-shortcuts', order: 35, locale: DESKTOP_SHORTCUTS_LOCALE_NAMESPACE,
    inject: () => ({ shortcutSettings, shortcutTargets }),
  }, ShortcutSettingsRow))
  ctx.slots.inject('settings.action', () => ctx.slots.register({
    name: 'settings.action', id: 'desktop-semantic-nav-icons', order: -100,
    inject: () => ({ shortcutSettings, shortcutTargets }),
  }, SettingsNavIconBridge))

  ctx.inject(['layout'], (scope: ClientContext) => {
    scope.effect(() => {
      const projections = new Map<string, { source: StoredEntry; label: string; dispose: () => void }>()
      let sidebarDisposers: Array<() => void> = []
      let sidebarSignature = ''
      let reconciling = false
      const reconcile = (): void => {
        if (reconciling) return
        reconciling = true
        try {
          const targets = shortcutTargets.getSnapshot()
          const selected = normalizeShortcutItems(shortcutSettings.getSnapshot().value?.items, targets)
          const definitions = new Map(targets.map(target => [target.id, target]))
          const desired = new Map<string, { source: StoredEntry; label: string; install: () => () => void }>()
          const shell = scope.slots.entries('sidebar.settings').find(entry => entry.component !== ShortcutSettingsShell)
          if (shell !== undefined) desired.set('shell', { source: shell, label: '', install: () => registerEntryProjection(scope, shell,
            { name: 'sidebar.settings', priority: -100 }, ShortcutSettingsShell, () => ({ shortcutSettings, shortcutTargets })) })
          for (const target of targets) {
            if (target.kind === 'settings' && selected.includes(target.id)) {
              const source = scope.slots.entriesOfSlot('settings.section').find(entry => entry.options.id === target.targetId)
              if (source !== undefined) desired.set(target.id, { source, label: target.label, install: () => registerEntryProjection(scope, source,
                { name: 'main', key: shortcutPanelId(target.targetId) }, ShortcutSettingsPanel,
                () => ({ returnToConversation: () => { scope.layout.selectPanel(null) } })) })
            } else if (target.kind === 'panel') {
              const source = scope.slots.entriesOfSlot('main').find(entry => entry.options.key === target.targetId)
              if (source !== undefined) desired.set(target.id, { source, label: target.label, install: () => registerEntryProjection(scope, source,
                { name: 'settings.section', id: settingsMenuSectionId(target), order: settingsMenuOrder(target, targets), label: target.label }) })
            }
          }
          for (const [id, registration] of projections) {
            const next = desired.get(id)
            if (next?.source === registration.source && next.label === registration.label) continue
            registration.dispose()
            projections.delete(id)
          }
          for (const [id, next] of desired) {
            if (!projections.has(id)) projections.set(id, { source: next.source, label: next.label, dispose: next.install() })
          }
          const signature = selected.map(id => `${id}:${definitions.get(id)?.label}`).join('|')
          if (signature !== sidebarSignature) {
            sidebarSignature = signature
            sidebarDisposers.splice(0).reverse().forEach(dispose => { dispose() })
            selected.forEach((id, index) => {
              const target = definitions.get(id)!
              const panelId = target.kind === 'panel' ? target.targetId as MainPanelId : shortcutPanelId(target.targetId)
              sidebarDisposers.push(scope.slots.inject('sidebar.panellist', () => scope.slots.register({
                name: 'sidebar.panellist', id: panelId, order: 100 + index, label: target.label,
                inject: () => ({ target }),
              }, ShortcutPanelIcon)))
            })
          }
        } finally { reconciling = false }
      }
      const offSettings = shortcutSettings.subscribe(reconcile)
      const offTargets = shortcutTargets.subscribe(reconcile)
      const offSections = scope.slots.subscribe('settings.section', reconcile)
      const offPanels = scope.slots.subscribe('main', reconcile)
      const offShell = scope.slots.subscribe('sidebar.settings', reconcile)
      reconcile()
      return () => {
        offSettings(); offTargets(); offSections(); offPanels(); offShell()
        sidebarDisposers.splice(0).reverse().forEach(dispose => { dispose() })
        for (const registration of projections.values()) registration.dispose()
        projections.clear()
      }
    }, 'dsh-plugin-desktop: configurable sidebar shortcuts')
  })
}
