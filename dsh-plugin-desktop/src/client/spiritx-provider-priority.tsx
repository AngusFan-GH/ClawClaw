import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

export const SPIRITX_PROVIDER_PRIORITY_STYLE = `
li:has([data-dsh-spiritx-provider]) { order: -1; }
[data-dsh-spiritx-provider] { display: none; }
`

/** Semantic marker placed through the official per-provider extension slot. */
export function SpiritXProviderPriorityMarker(
  props: PropsRuntime<'settings.models.provider-card'>,
): ReactNode {
  return props.provider.provider === 'spiritx' ? <span data-dsh-spiritx-provider /> : null
}

/** Keep the product-default provider card first in the Models list. */
export function applySpiritXProviderPriority(ctx: ClientContext): void {
  if (typeof document === 'undefined') return
  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card',
    key: 'spiritx',
  }, SpiritXProviderPriorityMarker))
  const style = document.createElement('style')
  style.dataset.pluginCss = 'dsh-plugin-desktop/spiritx-provider-priority'
  style.textContent = SPIRITX_PROVIDER_PRIORITY_STYLE
  document.head.append(style)
  ctx.effect(() => () => { style.remove() }, 'dsh-plugin-desktop: SpiritX provider priority styles')
}
