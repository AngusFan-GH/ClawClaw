/** rc.2 presentation adapter: feature registrations retain ownership of their state and child slots. */
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { StoredEntry, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { normalizeShortcutItems, type DesktopShortcutSettings, type ShortcutTarget } from './shortcut-menu-model.ts'

export const PANEL_SETTINGS_PREFIX = 'desktop-panel:'
export function settingsMenuSectionId(target: ShortcutTarget): string {
  return target.kind === 'panel' ? `${PANEL_SETTINGS_PREFIX}${target.targetId}` : target.targetId
}

export function settingsMenuOrder(target: ShortcutTarget, targets: readonly ShortcutTarget[]): number {
  return target.kind === 'panel' ? 1000 + targets.indexOf(target) : target.order ?? 0
}

interface Targets {
  getSnapshot(): readonly ShortcutTarget[]
  subscribe(listener: () => void): () => void
}
interface SectionRow { readonly id: string; readonly order: number; readonly label: string }
interface ShellProps extends Record<string, unknown> {
  readonly sectionComponent: ComponentType<Record<string, unknown>>
  readonly shortcutSettings: ConfigForm<DesktopShortcutSettings>
  readonly shortcutTargets: Targets
  readonly useSections: SnapshotSelectorHook<readonly SectionRow[]>
}

/** Filter the shell's observable nav rows before selection, rendering, or modal autofocus. */
export function ShortcutSettingsShell({ sectionComponent: Shell, shortcutSettings, shortcutTargets, useSections, ...props }: ShellProps): JSX.Element {
  const subscribe = useCallback((listener: () => void) => shortcutSettings.subscribe(listener), [shortcutSettings])
  const getSnapshot = useCallback(() => shortcutSettings.getSnapshot(), [shortcutSettings])
  const settings = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const targets = useSyncExternalStore(shortcutTargets.subscribe, shortcutTargets.getSnapshot, shortcutTargets.getSnapshot)
  const pinned = useMemo(() => new Set(normalizeShortcutItems(settings.value?.items, targets)
    .flatMap(id => {
      const target = targets.find(candidate => candidate.id === id)
      return target === undefined ? [] : [settingsMenuSectionId(target)]
    })), [settings.value?.items, targets])
  const useVisibleSections: SnapshotSelectorHook<readonly SectionRow[]> = useCallback((selector, comparison) => useSections(rows => selector(rows.filter(row => !pinned.has(row.id))), comparison), [useSections, pinned])
  return <Shell {...props} useSections={useVisibleSections} />
}

type ErasedRegister = (options: Record<string, unknown>, component: ComponentType<Record<string, unknown>>) => () => void

/**
 * Reuse locale, inject hooks, and store seats in a second host. rc.2 has no
 * child-slot alias API, so borrowing is confined here. Never release a borrowed
 * declaration: only its original feature may own or collapse the child slots.
 */
export function registerEntryProjection(
  ctx: Context,
  source: StoredEntry,
  options: Record<string, unknown> & { name: string },
  wrapper?: unknown,
  extraInject?: () => Record<string, unknown>,
): () => void {
  return ctx.slots.inject(options.name as 'main', function* () {
    const register = ctx.slots.register.bind(ctx.slots) as unknown as ErasedRegister
    const component = (wrapper ?? source.component) as ComponentType<Record<string, unknown>>
    const dispose = register({
      ...options,
      ...(source.locale === undefined ? {} : { locale: source.locale }),
      ...(source.store === undefined ? {} : { store: source.store }),
      inject: (...args: never[]) => ({
        ...source.inject?.(...args),
        ...(wrapper === undefined ? {} : { sectionComponent: source.component }),
        ...extraInject?.(),
      }),
    }, component)
    // Yield the registration into this declaration effect; it must not retain
    // an independent fiber cleanup ahead of the borrowed-table cleanup.
    yield dispose
    const projected = ctx.slots.entries(options.name as 'main')
      .find(entry => entry.component === component && entry.options.key === options.key && entry.options.id === options.id && entry !== source)
    if (projected !== undefined && source.children !== undefined) projected.children = source.children
    yield () => { if (projected !== undefined) delete projected.children }
  })
}
