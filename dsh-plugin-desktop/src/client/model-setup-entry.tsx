/** Offer model setup from an empty composer model catalog. */
import { useEffect, useSyncExternalStore, type ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { registerEntryProjection } from './shortcut-presentation.tsx'
import { shortcutPanelId } from './shortcut-menu-model.ts'

const NS = 'desktop.model-setup'
const SLOT = 'conversation.input.model'
const COPY = { en: { configure: 'Configure models' }, zh: { configure: '配置模型' } }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop.model-setup': 'configure' }
}

type Props = Record<string, unknown> & ModelSelectInjected & {
  sectionComponent: ComponentType<Record<string, unknown>>
  configureLabel: string
  openModelSettings(): void
}

export function ModelSetupEntry({ sectionComponent: Selector, configureLabel, openModelSettings, ...props }: Props) {
  const { directory, available, load } = props
  const state = useSyncExternalStore(listener => directory.subscribe(listener), () => directory.getSnapshot())
  useEffect(() => { if (available) load() }, [available, load])
  if (!available) return null
  // Preserve the selector's loading, retry, provider failures, and usable models.
  const empty = state.status === 'ready' && state.error === null
    && state.failures.length === 0 && !state.groups.some(group => group.models.length > 0)
  if (!empty) return <Selector {...props} />
  return <button type="button" className="desktopModelSetupEntry" onClick={openModelSettings}>{configureLabel}</button>
}

/** Use the same shared Settings store as the sidebar and keyboard launcher. */
export function openModelSettings(ctx: Context): void {
  const panel = shortcutPanelId('models')
  if (ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === panel)) {
    ctx.layout.selectPanel(panel)
    return
  }
  const shell = ctx.slots.entriesOfSlot('sidebar.settings').find(entry => entry.store !== undefined)
  const store = shell?.store
  const instance = store !== undefined && 'create' in store
    ? store.create() as { actions?: { openSection?: (id: string) => void } }
    : undefined
  instance?.actions?.openSection?.('models')
}

export function applyModelSetupEntry(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, COPY), 'desktop: model setup copy')
  const t = ctx.locale.bind(NS)
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = `.desktopModelSetupEntry { padding: 6px 10px; min-height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 14px; cursor: pointer; }
.desktopModelSetupEntry:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.desktopModelSetupEntry:focus-visible { outline: 2px solid var(--dsh-color-accent); outline-offset: 2px; }`
    document.head.append(style)
    return () => { style.remove() }
  }, 'desktop: model setup styles')
  ctx.effect(() => {
    let source: StoredEntry | undefined
    let dispose: (() => void) | undefined
    let reconciling = false
    const reconcile = () => {
      if (reconciling) return
      reconciling = true
      try {
        const next = ctx.slots.entries(SLOT).find(entry => entry.component !== ModelSetupEntry)
        if (next === source) return
        dispose?.(); dispose = undefined; source = next
        if (next !== undefined) dispose = registerEntryProjection(ctx, next,
          { name: SLOT, priority: -100 }, ModelSetupEntry,
          () => ({ configureLabel: t('configure'), openModelSettings: () => openModelSettings(ctx) }))
      } finally { reconciling = false }
    }
    const off = ctx.slots.subscribe(SLOT, reconcile)
    reconcile()
    return () => { off(); dispose?.() }
  }, 'desktop: empty model setup entry')
}
