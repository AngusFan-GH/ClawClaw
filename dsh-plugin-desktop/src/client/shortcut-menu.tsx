/** Configurable sidebar shortcuts projected from the Settings navigation. */

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconAgentPresetOutlineMedium, IconDataOutlineMedium, IconListPenOutlineMedium, IconPersonalizationOutlineMedium, IconSettingsOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { SETTINGS_NAV_ICON_ATTRIBUTE, type DesktopSettingsNavIcon } from './settings-nav-icons.ts'

export const DESKTOP_SHORTCUTS_LOCALE_NAMESPACE = 'desktop.shortcuts'
export const DESKTOP_SHORTCUTS_SETTINGS_NAMESPACE = 'desktop-shortcuts'
const OPEN_SETTINGS_EVENT = 'clawclaw:open-settings-section'
const MAX_SHORTCUTS = 4

export interface DesktopShortcutSettings { readonly items?: readonly string[] }

interface SettingsSection { readonly id: string; readonly label: string }
interface SettingsSections { getSnapshot(): readonly SettingsSection[]; subscribe(listener: () => void): () => void }
type ShortcutIcon = JSX.Element | DesktopSettingsNavIcon
interface ShortcutDefinition extends SettingsSection { readonly icon: ShortcutIcon }

const DEFAULT_ITEMS: readonly string[] = ['desktop-skills', 'desktop-cron-tasks', 'desktop-reminders']

export const zh = {
  title: '快捷入口', intro: '将常用功能固定在工作区上方，最多显示 4 项。', selected: '已固定', available: '可添加', add: '添加', remove: '移除', moveUp: '上移', moveDown: '下移',
} as const
export type DesktopShortcutsLocaleKey = keyof typeof zh
export const en: Record<DesktopShortcutsLocaleKey, string> = {
  title: 'Shortcuts', intro: 'Pin frequently used features above the workspace list. You can show up to 4.', selected: 'Pinned', available: 'Available', add: 'Add', remove: 'Remove', moveUp: 'Move up', moveDown: 'Move down',
}

function shortcutIcon(section: SettingsSection): ShortcutIcon {
  switch (section.id) {
    case 'models': return <IconDataOutlineMedium />
    case 'agent-presets': return <IconAgentPresetOutlineMedium />
    case 'plugins': return <IconPersonalizationOutlineMedium />
    case 'desktop-reminders': return <IconListPenOutlineMedium />
    case 'desktop': return <DesktopSettingsIcon />
  }
  // These are the same semantic glyphs applied to their navigation rows.
  if (['插件市场', 'Plugin Marketplace'].includes(section.label)) return 'marketplace'
  if (['技能', 'Skills'].includes(section.label)) return 'skill'
  if (['MCP 服务', 'MCP Servers'].includes(section.label)) return 'mcp'
  if (['定时任务', 'Scheduled tasks'].includes(section.label)) return 'schedule'
  return <IconSettingsOutlineMedium />
}

function sectionsToShortcuts(sections: readonly SettingsSection[]): readonly ShortcutDefinition[] {
  return sections.map(section => ({ ...section, icon: shortcutIcon(section) }))
}

function normalize(items: readonly string[] | undefined, shortcuts: readonly ShortcutDefinition[]): readonly string[] {
  const input = items === undefined ? DEFAULT_ITEMS : items
  const known = new Set(shortcuts.map(item => item.id))
  return input.filter((item, index) => known.has(item) && input.indexOf(item) === index).slice(0, MAX_SHORTCUTS)
}

function useScope<T>(scope: ConfigForm<T>): T | undefined {
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const snapshot = useCallback(() => scope.getSnapshot(), [scope])
  return useSyncExternalStore(subscribe, snapshot, snapshot).value
}

function useSections(sections: SettingsSections): readonly SettingsSection[] {
  return useSyncExternalStore(listener => sections.subscribe(listener), () => sections.getSnapshot(), () => sections.getSnapshot())
}

function openSettingsSection(id: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { id } }))
}

function DesktopSettingsIcon(): JSX.Element {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.25" /><path d="M5 14h6M8 11.5V14" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /></svg>
}

function ShortcutIcon({ icon }: { readonly icon: ShortcutIcon }): JSX.Element {
  if (typeof icon === 'string') return <span className="dshShortcutGlyph" {...{ [SETTINGS_NAV_ICON_ATTRIBUTE]: icon }} />
  return <span className="dshShortcutGlyph">{icon}</span>
}

type ShortcutMenuProps = PropsRuntime<'settings.general.item'> & PropsLocale<'desktop.shortcuts'> & {
  readonly shortcutSettings: ConfigForm<DesktopShortcutSettings>
  readonly settingsSections: SettingsSections
}

export function ShortcutSettingsRow({ t, shortcutSettings, settingsSections }: ShortcutMenuProps): JSX.Element {
  const settings = useScope(shortcutSettings)
  const sections = useSections(settingsSections)
  const shortcuts = useMemo(() => sectionsToShortcuts(sections), [sections])
  const items = normalize(settings?.items, shortcuts)
  const save = (next: readonly string[]): void => { void shortcutSettings.set('items', next) }
  const definitions = useMemo(() => new Map(shortcuts.map(item => [item.id, item])), [shortcuts])
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
      <div className="dshShortcutGroup"><h4>{t('available')}</h4>{shortcuts.filter(item => !items.includes(item.id)).map(item => <div className="dshShortcutRow" key={item.id}><ShortcutIcon icon={item.icon} /><span>{item.label}</span><button type="button" disabled={items.length >= MAX_SHORTCUTS} onClick={() => { save([...items, item.id]) }}>{t('add')}</button></div>)}</div>
      <div className="dshShortcutGroup"><h4>{t('selected')}</h4>{items.map((id, index) => {
        const item = definitions.get(id)!
        return <div className="dshShortcutRow" key={id}><ShortcutIcon icon={item.icon} /><span>{item.label}</span><div className="dshShortcutActions"><button type="button" disabled={index === 0} aria-label={t('moveUp')} onClick={() => { shift(id, -1) }}>↑</button><button type="button" disabled={index === items.length - 1} aria-label={t('moveDown')} onClick={() => { shift(id, 1) }}>↓</button><button type="button" aria-label={t('remove')} onClick={() => { save(items.filter(current => current !== id)) }}>×</button></div></div>
      })}</div>
    </div>
  </section>
}

export function SidebarShortcuts({ wide, t, shortcutSettings, settingsSections }: PropsRuntime<'sidebar.shortcuts'> & PropsLocale<'desktop.shortcuts'> & { readonly shortcutSettings: ConfigForm<DesktopShortcutSettings>; readonly settingsSections: SettingsSections }): JSX.Element {
  const settings = useScope(shortcutSettings)
  const sections = useSections(settingsSections)
  const shortcuts = useMemo(() => sectionsToShortcuts(sections), [sections])
  const items = normalize(settings?.items, shortcuts)
  const definitions = new Map(shortcuts.map(item => [item.id, item]))
  return <nav className="dshSidebarShortcuts" data-wide={wide} aria-label={t('title')}>
    {items.map(id => {
      const item = definitions.get(id)!
      return <button className="dshSidebarShortcut" type="button" key={id} title={item.label} aria-label={item.label} onClick={() => { openSettingsSection(id) }}>
        <ShortcutIcon icon={item.icon} />{wide && <span>{item.label}</span>}
      </button>
    })}
  </nav>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop.shortcuts': DesktopShortcutsLocaleKey }
  interface SlotMap { 'sidebar.shortcuts': { kind: 'list'; scope: 'root'; owner: { wide: boolean } } }
}

export function applyShortcutMenu(ctx: ClientContext): void {
  const shortcutSettings = ctx.configForms.get<DesktopShortcutSettings>(DESKTOP_SHORTCUTS_SETTINGS_NAMESPACE)
  let sectionsVersion = -1
  let sectionsLocaleRevision = -1
  let sectionsSnapshot: readonly SettingsSection[] = []
  const settingsSections: SettingsSections = {
    getSnapshot: () => {
      const version = ctx.slots.getVersion('settings.section')
      const localeRevision = ctx.locale.getSnapshot().revision
      if (version !== sectionsVersion || localeRevision !== sectionsLocaleRevision) {
        sectionsVersion = version
        sectionsLocaleRevision = localeRevision
        sectionsSnapshot = ctx.slots.entries('settings.section').map(entry => ({
          id: entry.options.id ?? '', label: resolveSlotLabel(entry.options.label) ?? '', order: entry.options.order ?? 0,
        })).filter(section => section.id.length > 0 && section.label.length > 0)
          .sort((a, b) => a.order - b.order).map(({ id, label }) => ({ id, label }))
      }
      return sectionsSnapshot
    },
    subscribe: listener => {
      const offSlots = ctx.slots.subscribe('settings.section', listener)
      const offLocale = ctx.locale.subscribe(listener)
      return () => { offSlots(); offLocale() }
    },
  }
  ctx.effect(() => ctx.locale.register(DESKTOP_SHORTCUTS_LOCALE_NAMESPACE, { zh, en }), 'dsh-plugin-desktop: shortcut menu dictionaries')
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'desktop-shortcuts', order: 35, locale: DESKTOP_SHORTCUTS_LOCALE_NAMESPACE,
    inject: () => ({ shortcutSettings, settingsSections }),
  }, ShortcutSettingsRow))
  ctx.slots.inject('sidebar.shortcuts', () => ctx.slots.register({
    name: 'sidebar.shortcuts', id: 'desktop-shortcuts', order: 0, locale: DESKTOP_SHORTCUTS_LOCALE_NAMESPACE,
    inject: () => ({ shortcutSettings, settingsSections }),
  }, SidebarShortcuts))
}
