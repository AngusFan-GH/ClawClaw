/** Register the independent MCP Servers page in the official Settings shell. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createDesktopMcpApi } from './mcp-api.ts'
import { en, zh, type DesktopMcpLocaleKey } from './mcp-locales.ts'
import { installIntegrationsStyles } from './integrations-styles.ts'
import { McpSettingsSection } from './McpSettingsSection.tsx'

export const DESKTOP_MCP_LOCALE_NAMESPACE = 'desktop.mcp'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'desktop.mcp': DesktopMcpLocaleKey } }

export function applyMcpSettings(ctx: ClientContext): void {
  const api = createDesktopMcpApi()
  const t = ctx.locale.bind(DESKTOP_MCP_LOCALE_NAMESPACE)
  ctx.effect(() => ctx.locale.register(DESKTOP_MCP_LOCALE_NAMESPACE, { zh, en }), 'dsh-plugin-desktop: MCP dictionaries')
  ctx.effect(() => installIntegrationsStyles(), 'dsh-plugin-desktop: MCP styles')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'desktop-mcp', order: 91,
    label: () => t('nav'), locale: DESKTOP_MCP_LOCALE_NAMESPACE, inject: () => ({ api }),
  }, McpSettingsSection))
}
