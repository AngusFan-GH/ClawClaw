/** Context adapter used to move the rc.2 Plugins sidebar entry under Desktop ownership. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'

type Slots = ClientContext['slots']

const PLUGIN_MANAGER_SERVICES = [
  'layout',
  'remote.pluginManager',
  'remote.pluginInventory',
  'remote.pluginRegistryProbe',
] as const

/** Delay the Desktop-owned Plugins panel until all of its runtime services are available. */
export function whenPluginManagerReady(
  ctx: ClientContext,
  install: (scope: ClientContext) => void,
): void {
  ctx.inject([...PLUGIN_MANAGER_SERVICES], install)
}

/** Present a slot registry that ignores only the Plugins manager's fixed sidebar injection. */
export function withoutSidebarPanelRegistration(ctx: ClientContext): ClientContext {
  const slots = new Proxy(ctx.slots, {
    get(target, property) {
      if (property === 'inject') {
        return (key: string, callback: () => (() => void) | Iterable<() => void>): (() => void) => {
          if (key === 'sidebar.panellist') return () => {}
          return (target.inject as unknown as (name: string, install: typeof callback) => () => void)
            .call(target, key, callback)
        }
      }
      const value = Reflect.get(target, property) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as Slots
  return new Proxy(ctx, {
    get(target, property, receiver) {
      return property === 'slots' ? slots : Reflect.get(target, property, receiver)
    },
  })
}
