/** Configurable panel and Settings shortcuts projected through rc.2 sidebar entries. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DesktopFeatureIcon } from './desktop-feature-icon.tsx'

export const DESKTOP_SHORTCUTS_LOCALE_NAMESPACE = 'desktop.shortcuts'
export const DESKTOP_SHORTCUTS_SETTINGS_ENTRY_ID = 'desktop-shortcuts'
export const PLUGINS_PANEL_ID = 'plugins' as MainPanelId
export const AUTOMATIONS_PANEL_ID = 'desktop-automations' as MainPanelId
const MAX_SHORTCUTS = 4
const SETTINGS_TARGET_PREFIX = 'settings:'
const DEFAULT_ITEMS: readonly string[] = [PLUGINS_PANEL_ID, AUTOMATIONS_PANEL_ID, 'settings:desktop-skills', 'settings:desktop-reminders']
const LEGACY_DEFAULT_ITEMS: readonly string[] = ['desktop-skills', 'desktop-cron-tasks', 'desktop-reminders']
const INTERIM_DEFAULT_ITEMS: readonly string[] = ['desktop-skills', 'desktop-reminders', 'desktop']

export interface DesktopShortcutSettings { readonly items?: readonly string[] }
export interface ShortcutTarget {
  readonly id: string
  readonly targetId: string
  readonly label: string
  readonly kind: 'panel' | 'settings'
}
interface ShortcutTargets { getSnapshot(): readonly ShortcutTarget[]; subscribe(listener: () => void): () => void }

interface SettingsNavIconMount {
  readonly id: string
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
  })
}

export const zh = {
  title: '快捷入口', intro: '将常用功能和设置固定到侧栏，最多显示 4 项。', selected: '已固定', available: '可添加', add: '添加', remove: '移除', moveUp: '上移', moveDown: '下移', plugins: '插件', automations: '自动化任务', unavailableTitle: '无法打开设置', unavailableHint: '设置外壳尚未就绪，请稍后重试。',
} as const
export type DesktopShortcutsLocaleKey = keyof typeof zh
export const en: Record<DesktopShortcutsLocaleKey, string> = {
  title: 'Shortcuts', intro: 'Pin frequently used features and settings to the sidebar. You can show up to 4.', selected: 'Pinned', available: 'Available', add: 'Add', remove: 'Remove', moveUp: 'Move up', moveDown: 'Move down', plugins: 'Plugins', automations: 'Automations', unavailableTitle: 'Settings unavailable', unavailableHint: 'The Settings shell is not ready yet. Try again shortly.',
}

export function normalizeShortcutItems(
  items: readonly string[] | undefined,
  targets: readonly ShortcutTarget[],
): readonly string[] {
  const legacyDefault = items !== undefined && (
    items.length === LEGACY_DEFAULT_ITEMS.length && items.every((item, index) => item === LEGACY_DEFAULT_ITEMS[index])
    || items.length === INTERIM_DEFAULT_ITEMS.length && items.every((item, index) => item === INTERIM_DEFAULT_ITEMS[index])
  )
  const input = items === undefined || legacyDefault
    ? DEFAULT_ITEMS
    : items.map(item => item === 'desktop-cron-tasks' ? AUTOMATIONS_PANEL_ID : item)
  const known = new Set(targets.map(target => target.id))
  const settingsIds = new Map(targets.filter(target => target.kind === 'settings')
    .map(target => [target.targetId, target.id]))
  const migrated = input.map(item => known.has(item) ? item : settingsIds.get(item) ?? item)
  return migrated.filter((item, index) => known.has(item) && migrated.indexOf(item) === index).slice(0, MAX_SHORTCUTS)
}

export function shortcutPanelId(sectionId: string): MainPanelId {
  return `desktop-shortcut:${sectionId}` as MainPanelId
}

function useScope<T>(scope: ConfigForm<T>): T | undefined {
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const snapshot = useCallback(() => scope.getSnapshot(), [scope])
  return useSyncExternalStore(subscribe, snapshot, snapshot).value
}

function useTargets(targets: ShortcutTargets): readonly ShortcutTarget[] {
  return useSyncExternalStore(listener => targets.subscribe(listener), () => targets.getSnapshot(), () => targets.getSnapshot())
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
  const shift = (id: string, offset: -1 | 1): void => {
    const index = items.indexOf(id)
    const target = index + offset
    if (index < 0 || target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    save(next)
  }
  return <section className="dshShortcutSettings">
    <header><h3>{t('title')}</h3><p>{t('intro')}</p></header>
    <div className="dshShortcutGroups">
      <div className="dshShortcutGroup"><h4>{t('available')}</h4>{targets.filter(item => !items.includes(item.id)).map(item => <div className="dshShortcutRow" key={item.id}><ShortcutIcon target={item} /><span>{item.label}</span><IconButton label={`${t('add')}: ${item.label}`} disabled={items.length >= MAX_SHORTCUTS} onClick={() => { save([...items, item.id]) }}><Plus size={14} /></IconButton></div>)}</div>
      <div className="dshShortcutGroup"><h4>{t('selected')}</h4>{items.map((id, index) => {
        const item = definitions.get(id)!
        return <div className="dshShortcutRow" key={id}><ShortcutIcon target={item} /><span>{item.label}</span><div className="dshShortcutActions"><IconButton label={`${t('moveUp')}: ${item.label}`} disabled={index === 0} onClick={() => { shift(id, -1) }}><ArrowUp size={14} /></IconButton><IconButton label={`${t('moveDown')}: ${item.label}`} disabled={index === items.length - 1} onClick={() => { shift(id, 1) }}><ArrowDown size={14} /></IconButton><IconButton label={`${t('remove')}: ${item.label}`} onClick={() => { save(items.filter(current => current !== id)) }}><X size={14} /></IconButton></div></div>
      })}</div>
    </div>
  </section>
}

interface ShortcutRedirectInjected {
  readonly sectionId: string
  readonly openSection: (sectionId: string) => boolean
  readonly returnToConversation: () => void
}
type ShortcutRedirectProps = PropsRuntime<'main'> & PropsLocale<'desktop.shortcuts'> & InjectFace<ShortcutRedirectInjected>

export function ShortcutRedirectPanel({ sectionId, openSection, returnToConversation, t }: ShortcutRedirectProps): JSX.Element | null {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!openSection(sectionId)) {
      setFailed(true)
      return
    }
    returnToConversation()
  }, [openSection, returnToConversation, sectionId])
  if (!failed) return null
  return <main className="dshShortcutRedirectError"><h2>{t('unavailableTitle')}</h2><p>{t('unavailableHint')}</p></main>
}

interface ShortcutPanelIconInjected { readonly target: ShortcutTarget }
type ShortcutPanelIconProps = PropsRuntime<'sidebar.panellist'> & InjectFace<ShortcutPanelIconInjected>

export function ShortcutPanelIcon({ target, size }: ShortcutPanelIconProps): JSX.Element {
  return <ShortcutIcon target={target} size={size} />
}

/**
 * The rc.2 Settings shell does not expose an icon field on settings.section.
 * Mount the canonical icon into each nav row by the slot ledger's stable order,
 * while retaining the shell's own layout, store, shortcuts, and interactions.
 */
export function SettingsNavIconBridge({ shortcutTargets }: { readonly shortcutTargets: ShortcutTargets }): JSX.Element {
  const allTargets = useTargets(shortcutTargets)
  const targets = useMemo(() => allTargets.filter(target => target.kind === 'settings'), [allTargets])
  const [mounts, setMounts] = useState<readonly SettingsNavIconMount[]>([])

  useLayoutEffect(() => {
    const dialog = document.querySelector<HTMLElement>('[data-shortcut-modal="settings"]')
    const buttons = dialog === null ? [] : [...dialog.querySelectorAll<HTMLButtonElement>('nav button')]
    const cleanups: Array<() => void> = []
    const next = targets.flatMap((target, index): SettingsNavIconMount[] => {
      const button = buttons[index]
      const previous = button?.querySelector<SVGElement>(':scope > svg')
      if (button === undefined || previous === null || previous === undefined) return []
      const node = document.createElement('span')
      node.dataset.desktopSettingsIcon = target.targetId
      node.style.display = 'contents'
      button.insertBefore(node, previous)
      const previousDisplay = previous.style.display
      previous.style.display = 'none'
      cleanups.push(() => {
        previous.style.display = previousDisplay
        node.remove()
      })
      const className = previous.getAttribute('class') ?? undefined
      return [{ id: target.targetId, node, ...(className === undefined ? {} : { className }) }]
    })
    setMounts(next)
    return () => {
      cleanups.reverse().forEach(cleanup => { cleanup() })
    }
  }, [targets])

  return <>{mounts.map(mount => createPortal(
    <DesktopFeatureIcon
      featureId={mount.id}
      kind="settings"
      size={16}
      {...(mount.className === undefined ? {} : { className: mount.className })}
    />,
    mount.node,
    mount.id,
  ))}</>
}

interface SettingsShellActions { openSection(id: string): void }
interface SettingsShellStore { create(): { readonly actions: SettingsShellActions } }

export function openSettingsSection(ctx: ClientContext, sectionId: string): boolean {
  const declaration = ctx.slots.entriesOfSlot('sidebar.settings')[0]
  const store = declaration?.store
  if (store === undefined) return false
  const handle = typeof store === 'function' ? store() : store
  const actions = (handle as unknown as SettingsShellStore).create().actions
  if (typeof actions.openSection !== 'function') return false
  actions.openSection(sectionId)
  return true
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
        const sections = ctx.slots.entries('settings.section').map(entry => ({
          id: entry.options.id ?? '',
          label: resolveSlotLabel(entry.options.label) ?? '',
          order: entry.options.order ?? 0,
        })).filter(section => section.id.length > 0 && section.label.length > 0)
          .sort((a, b) => a.order - b.order).map(({ id, label }) => ({
            id: `${SETTINGS_TARGET_PREFIX}${id}`, targetId: id, label, kind: 'settings' as const,
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
    inject: () => ({ shortcutTargets }),
  }, SettingsNavIconBridge))

  ctx.inject(['layout'], (scope: ClientContext) => {
    scope.effect(() => {
      let registrations: Array<() => void> = []
      const reconcile = (): void => {
        registrations.splice(0).reverse().forEach(dispose => { dispose() })
        const targets = shortcutTargets.getSnapshot()
        const selected = normalizeShortcutItems(shortcutSettings.getSnapshot().value?.items, targets)
        const definitions = new Map(targets.map(target => [target.id, target]))
        selected.forEach((targetId, index) => {
          const target = definitions.get(targetId)
          if (target === undefined) return
          const panelId = target.kind === 'panel' ? target.targetId as MainPanelId : shortcutPanelId(target.targetId)
          const inject = () => ({
            sectionId: target.targetId,
            openSection: (id: string) => openSettingsSection(scope, id),
            returnToConversation: () => { scope.layout.selectPanel(null) },
          })
          if (target.kind === 'settings') {
            registrations.push(scope.slots.inject('main', () => scope.slots.register({
              name: 'main', key: panelId, locale: DESKTOP_SHORTCUTS_LOCALE_NAMESPACE, inject,
            }, ShortcutRedirectPanel)))
          }
          registrations.push(scope.slots.inject('sidebar.panellist', () => scope.slots.register({
            name: 'sidebar.panellist', id: panelId, order: 100 + index, label: target.label,
            inject: () => ({ target }),
          }, ShortcutPanelIcon)))
        })
      }
      const offSettings = shortcutSettings.subscribe(reconcile)
      const offTargets = shortcutTargets.subscribe(reconcile)
      reconcile()
      return () => {
        offSettings()
        offTargets()
        registrations.splice(0).reverse().forEach(dispose => { dispose() })
      }
    }, 'dsh-plugin-desktop: configurable sidebar shortcuts')
  })
}
