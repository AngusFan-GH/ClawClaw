/** Product-owned SpiritX route over the upstream pi-ai transport. */

import type { Context } from '@deepseek-ai/cordis'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'

export const name = 'spiritx'
export const inject = PiAi.inject
export const Config = PiAi.Config
export type Config = PiAi.Config

/** Mark the product route as built in while preserving the upstream catalog. */
export function productProviderDirectory(
  entries: readonly LlmConfigurableProvider[],
): LlmConfigurableProvider[] {
  const spiritx = entries.find(entry => entry.provider === 'spiritx')
  const remaining = entries.filter(entry => entry.provider !== 'spiritx').map(entry => ({ ...entry }))
  return spiritx === undefined ? remaining : [{ ...spiritx, declared: false }, ...remaining]
}

/** Register SpiritX through pi-ai with a product-owned provider identity. */
export function apply(ctx: Context, config: Config): void {
  const llm = new Proxy(ctx.llm, {
    get(target, property, receiver) {
      if (property === 'registerConfigurableProviders') {
        return (entries: readonly LlmConfigurableProvider[]) => (
          target.registerConfigurableProviders(productProviderDirectory(entries))
        )
      }
      return Reflect.get(target, property, receiver)
    },
  })
  const productContext = new Proxy(ctx, {
    get(target, property, receiver) {
      return property === 'llm' ? llm : Reflect.get(target, property, receiver)
    },
  })
  PiAi.apply(productContext, config)
}
