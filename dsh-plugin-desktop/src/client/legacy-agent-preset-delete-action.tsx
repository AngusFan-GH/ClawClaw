/** Adds a deletion affordance to Desktop-owned legacy preset cards in the upstream Settings page. */

import { useEffect } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createDesktopSettingsApi } from './desktop-settings-api.ts'
import { createDesktopLegacyAgentPresetsApi } from './legacy-agent-presets-api.ts'
import { en, zh, type DesktopLegacyAgentPresetsLocaleKey } from './legacy-agent-presets-locales.ts'

export const DESKTOP_LEGACY_AGENT_PRESETS_LOCALE_NAMESPACE = 'desktop.legacy-agent-presets'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'desktop.legacy-agent-presets': DesktopLegacyAgentPresetsLocaleKey } }

const BUTTON_CLASS = 'dshLegacyPresetDelete'
const STYLE_ID = 'dsh-legacy-preset-delete-style'

function installStyles(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `.${BUTTON_CLASS}{margin-right:auto;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}.${BUTTON_CLASS}:hover:not(:disabled){color:var(--dsw-alias-danger-primary,#d14343)}.${BUTTON_CLASS}:disabled{opacity:.55;cursor:default}`
  document.head.append(style)
  return () => { style.remove() }
}

function LegacyPresetDeleteController({ t }: { t: (key: DesktopLegacyAgentPresetsLocaleKey, params?: Record<string, string>) => string }) {
  useEffect(() => {
    const api = createDesktopLegacyAgentPresetsApi()
    const settings = createDesktopSettingsApi()
    let stopped = false
    let loading = false
    const attach = async (): Promise<void> => {
      if (loading || stopped) return
      loading = true
      try {
        const removable = new Map((await api.read()).presets.map(preset => [preset.id, preset]))
        for (const card of document.querySelectorAll<HTMLElement>('[data-agent-preset-id]')) {
          const id = card.dataset.agentPresetId
          if (id === undefined || !removable.has(id) || card.querySelector(`.${BUTTON_CLASS}`) !== null) continue
          const foot = card.querySelector<HTMLElement>(':scope > div:last-child')
          if (foot === null) continue
          const preset = removable.get(id)!
          const button = document.createElement('button')
          button.type = 'button'; button.className = BUTTON_CLASS; button.textContent = t('remove'); button.setAttribute('aria-label', `${t('remove')}: ${preset.name}`)
          button.addEventListener('click', () => {
            if (!window.confirm(t('confirm', { name: preset.name }))) return
            button.disabled = true
            void api.remove(preset.id).then(async () => {
              button.textContent = t('deleted')
              try { await settings.restart() } catch { button.textContent = t('restartFailed'); button.disabled = false }
            }).catch(() => { button.textContent = t('operationFailed'); button.disabled = false })
          })
          foot.prepend(button)
        }
      } catch { /* The Agent preset page remains fully usable without the optional legacy endpoint. */ }
      finally { loading = false }
    }
    const observer = new MutationObserver(() => { void attach() })
    observer.observe(document.body, { childList: true, subtree: true })
    void attach()
    return () => { stopped = true; observer.disconnect() }
  }, [t])
  return null
}

/** Mount a controller in the existing Settings chrome; it adds buttons only to legacy custom cards. */
export function applyLegacyAgentPresetDeleteAction(ctx: ClientContext): void {
  const t = ctx.locale.bind(DESKTOP_LEGACY_AGENT_PRESETS_LOCALE_NAMESPACE)
  ctx.effect(() => ctx.locale.register(DESKTOP_LEGACY_AGENT_PRESETS_LOCALE_NAMESPACE, { zh, en }), 'dsh-plugin-desktop: legacy Agent preset dictionaries')
  ctx.effect(() => installStyles(), 'dsh-plugin-desktop: legacy Agent preset delete styles')
  ctx.slots.inject('settings.action', () => ctx.slots.register({ name: 'settings.action', id: 'desktop-legacy-agent-preset-delete' }, () => <LegacyPresetDeleteController t={t} />))
}
