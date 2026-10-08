/** Localize the default Workspace projection without changing durable user data. */
import type { IWorkspaces, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'

export const DEFAULT_WORKSPACE_LOCALE_NAMESPACE = 'clawclaw-default-workspace'
export const DEFAULT_WORKSPACE_LOCALES = {
  zh: { title: '默认' },
  en: { title: 'Default' },
}

const DEFAULT_WORKSPACE_TITLES = new Set(Object.values(DEFAULT_WORKSPACE_LOCALES).map(copy => copy.title))

/**
 * Resolve the product row even while its settings form is still loading.
 *
 * A fresh renderer can receive the Workspace follow baseline before the
 * settings document. During that interval the default id is unavailable, so
 * relying on it alone leaks the durable fallback title into the UI. A unique
 * known product title is safe to use only as that short-lived fallback; once
 * settings are ready, identity always wins.
 */
function resolveDefaultWorkspaceId(base: WorkspaceSnapshot, configuredId: string | undefined): string | undefined {
  if (configuredId !== undefined && configuredId !== '') return configuredId
  const candidates = base.items.filter(item => DEFAULT_WORKSPACE_TITLES.has(item.title))
  return candidates.length === 1 ? candidates[0]?.workspaceId : undefined
}

export function installDefaultWorkspaceLocale(options: {
  readonly source: IWorkspaces['list']
  readonly defaultId: () => string | undefined
  readonly title: () => string
  readonly subscribeLocale: (listener: () => void) => () => void
  readonly subscribeSettings: (listener: () => void) => () => void
}): () => void {
  // Decorate the shared source behind any context-specific Cordis proxy.
  const source = Reflect.get(options.source, Symbol.for('cordis.original')) as typeof options.source ?? options.source
  const originalSnapshot = source.getSnapshot
  const originalSubscribe = source.subscribe
  let cached: { base: WorkspaceSnapshot; id: string | undefined; title: string; value: WorkspaceSnapshot } | undefined
  const listeners = new Set<() => void>()
  const getSnapshot = (): WorkspaceSnapshot => {
    const base = originalSnapshot.call(source)
    const id = resolveDefaultWorkspaceId(base, options.defaultId())
    const title = options.title()
    if (cached?.base === base && cached.id === id && cached.title === title) return cached.value
    const items = base.items.map(item => item.workspaceId === id && item.title !== title
      // Respect explicit user renames; only the product name is dictionary copy.
      && DEFAULT_WORKSPACE_TITLES.has(item.title) ? { ...item, title } : item)
    const value = items.every((item, index) => item === base.items[index]) ? base : { ...base, items }
    cached = { base, id, title, value }
    return value
  }
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    const off = originalSubscribe.call(source, listener)
    return () => { listeners.delete(listener); off() }
  }
  const notify = (): void => { for (const listener of listeners) listener() }
  source.getSnapshot = getSnapshot
  source.subscribe = subscribe
  const offLocale = options.subscribeLocale(notify)
  const offSettings = options.subscribeSettings(notify)
  return () => {
    offLocale()
    offSettings()
    listeners.clear()
    if (source.getSnapshot === getSnapshot) source.getSnapshot = originalSnapshot
    if (source.subscribe === subscribe) source.subscribe = originalSubscribe
  }
}
