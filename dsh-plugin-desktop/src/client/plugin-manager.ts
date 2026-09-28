/** Reuse the rc.2 Plugins panel while Desktop owns its configurable sidebar entry. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import pluginManagerClientFactory from 'clawclaw:plugin-manager-client'
import { whenPluginManagerReady, withoutSidebarPanelRegistration } from './plugin-manager-context.ts'

export { whenPluginManagerReady, withoutSidebarPanelRegistration } from './plugin-manager-context.ts'

declare function require(id: string): unknown

export function applyManagedPluginManager(ctx: ClientContext): void {
  whenPluginManagerReady(ctx, (scope) => {
    const { apply: applyPluginManager } = pluginManagerClientFactory(require)
    applyPluginManager(withoutSidebarPanelRegistration(scope))
  })
}
