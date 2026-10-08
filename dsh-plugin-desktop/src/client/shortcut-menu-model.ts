/** Shared shortcut identities, migration, and ordering; independent of either presentation host. */
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'

export const DESKTOP_SHORTCUTS_LOCALE_NAMESPACE = 'desktop.shortcuts'
export const DESKTOP_SHORTCUTS_SETTINGS_ENTRY_ID = 'desktop-shortcuts'
export const PLUGINS_PANEL_ID = 'plugins' as MainPanelId
export const AUTOMATIONS_PANEL_ID = 'desktop-automations' as MainPanelId
export const MAX_SHORTCUTS = 4
export const SETTINGS_TARGET_PREFIX = 'settings:'
const DEFAULT_ITEMS: readonly string[] = [PLUGINS_PANEL_ID, AUTOMATIONS_PANEL_ID, 'settings:clawclaw-experts', 'settings:desktop-reminders']
const LEGACY_DEFAULT_ITEMS: readonly string[] = ['desktop-skills', 'desktop-cron-tasks', 'desktop-reminders']
const INTERIM_DEFAULT_ITEMS: readonly string[] = ['desktop-skills', 'desktop-reminders', 'desktop']

export interface DesktopShortcutSettings { readonly items?: readonly string[] }
export interface ShortcutTarget {
  readonly id: string
  readonly targetId: string
  readonly label: string
  readonly kind: 'panel' | 'settings'
  readonly order?: number
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
    : items.map(item => item === 'desktop-cron-tasks' ? AUTOMATIONS_PANEL_ID
      : item === 'desktop-skills' || item === 'desktop-mcp' || item === 'settings:desktop-skills' || item === 'settings:desktop-mcp'
        ? 'settings:clawclaw-experts' : item)
  const known = new Set(targets.map(target => target.id))
  const settingsIds = new Map(targets.filter(target => target.kind === 'settings')
    .map(target => [target.targetId, target.id]))
  const migrated = input.map(item => known.has(item) ? item : settingsIds.get(item) ?? item)
  return migrated.filter((item, index) => known.has(item) && migrated.indexOf(item) === index).slice(0, MAX_SHORTCUTS)
}

export function shortcutPanelId(sectionId: string): MainPanelId {
  return `desktop-shortcut:${sectionId}` as MainPanelId
}

export function reorderShortcutItems(
  items: readonly string[],
  draggedId: string,
  targetId: string,
  placement: 'before' | 'after',
): readonly string[] {
  if (draggedId === targetId || !items.includes(draggedId) || !items.includes(targetId)) return items
  const next = items.filter(id => id !== draggedId)
  const targetIndex = next.indexOf(targetId)
  next.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, draggedId)
  return next.every((id, index) => id === items[index]) ? items : next
}

