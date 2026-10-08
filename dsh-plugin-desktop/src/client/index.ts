import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only service and SlotMap convergence for the Desktop settings section.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
import type {} from '@deepseek-ai/dsh-llm/remote'
import { applyAdvancedShell } from './advanced-shell.ts'
import { applyClawClawBrand } from './clawclaw-brand.tsx'
import { startRendererBootReporter } from './boot-health.ts'
import { applyDesktopSettings } from './desktop-settings.ts'
import { applyDesktopVersionRow } from './desktop-version-row.tsx'
import { applyDefaultWorkspaceSelection } from './default-workspace-selection.ts'
import { installDesktopDirectoryPickerBridge } from './directory-picker.ts'
import { applyWorkspaceDirectoryFlow } from './workspace-directory-flow.tsx'
import { parseDesktopClientEnvironment, resolveDesktopClientProductVersion } from './environment.ts'
import { applyExtendedShell } from './extended-shell.ts'
import { applyMcpSettings } from './mcp-settings.ts'
import { applyLegacyAgentPresetDeleteAction } from './legacy-agent-preset-delete-action.tsx'
import { applyMarketIntegration } from './market-integration.tsx'
import { applyManagedPluginManager } from './plugin-manager.ts'
import { applyCronTasksSettings } from './cron-tasks-settings.ts'
import { applyRemindersSettings } from './reminders-settings.ts'
import { applySkillsSettings } from './skills-settings.ts'
import { applyShortcutMenu } from './shortcut-menu.tsx'
import { installShortcutMenuStyles } from './shortcut-menu-styles.ts'
import { applySpiritXOnboarding } from './spiritx-onboarding.tsx'
import { applySpiritXProviderPriority } from './spiritx-provider-priority.tsx'
import { desktopWindowService, provideDesktopWindow } from './window-service.ts'
import { apply as applyExperts } from '../experts/client/index.ts'

export { applyAdvancedShell } from './advanced-shell.ts'
export { applyClawClawBrand } from './clawclaw-brand.tsx'
export { applyDesktopSettings } from './desktop-settings.ts'
export { applyDesktopVersionRow, DesktopCurrentVersionRow } from './desktop-version-row.tsx'
export {
  applyDefaultWorkspaceSelection,
  installDesktopWorkspaceSelection,
  resolveDesktopWorkspaceSelection,
} from './default-workspace-selection.ts'
export { applyExtendedShell, applyFramedShell } from './extended-shell.ts'
export { applyMcpSettings } from './mcp-settings.ts'
export { applyLegacyAgentPresetDeleteAction } from './legacy-agent-preset-delete-action.tsx'
export { applyMarketIntegration } from './market-integration.tsx'
export { applyManagedPluginManager } from './plugin-manager.ts'
export { applySpiritXProviderPriority, SpiritXProviderPriorityMarker } from './spiritx-provider-priority.tsx'
export { applyRemindersSettings } from './reminders-settings.ts'
export { applySkillsSettings } from './skills-settings.ts'
export { applyShortcutMenu } from './shortcut-menu.tsx'
export {
  createDesktopSettingsApi,
  desktopSettingsPaths,
  parseDesktopActionAcceptance,
  parseDesktopRestartAcceptance,
  parseDesktopSettingsView,
} from './desktop-settings-api.ts'
export type {
  DesktopMarketProvider,
  DesktopMarketView,
  DesktopProfileView,
  DesktopRestartAcceptance,
  DesktopSettingsApi,
  DesktopSettingsView,
} from './desktop-settings-api.ts'
export { DesktopSettingsSection } from './DesktopSettingsSection.tsx'
export { DesktopTerminalSettingsAction } from './DesktopTerminalSettingsAction.tsx'
export type {
  DesktopTerminalSettingsActionInjected,
  DesktopTerminalSettingsActionProps,
} from './DesktopTerminalSettingsAction.tsx'
export type {
  DesktopNotificationSettings,
  DesktopSettingsSectionInjected,
  DesktopSettingsSectionProps,
  DesktopShellSettings,
} from './DesktopSettingsSection.tsx'
export {
  RENDERER_BOOT_REPORT_PATH,
  rendererBootReport,
  sendRendererBootReport,
  startRendererBootReporter,
} from './boot-health.ts'
export type { RendererBootLoader, RendererBootReport } from './boot-health.ts'
export { parseDesktopClientEnvironment, resolveDesktopClientProductVersion } from './environment.ts'
export type {
  DesktopClientEnvironment,
  DesktopClientMaterial,
  DesktopClientMode,
  DesktopClientPlatform,
} from './environment.ts'
export { desktopWindowService, provideDesktopWindow } from './window-service.ts'
export type {
  DesktopWindowDragRegion,
  DesktopWindowInsets,
  DesktopWindowService,
} from './contracts.ts'

/** Services required by Desktop settings and Desktop-owned presentations. */
export const inject = [
  'slots',
  'locale',
  'connection',
  'remote',
  'remote.credentials',
  'remote.llm',
  'configForms',
  'sessions',
  'theme',
  'uiRenderer',
  'inputTriggers',
]

/** Register product identity and, in Electron, native client surfaces. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  const environment = parseDesktopClientEnvironment(window.location.search)
  const productVersion = resolveDesktopClientProductVersion(environment)
  if (environment) {
    ctx.effect(
      () => startRendererBootReporter(ctx.loader),
      'dsh-plugin-desktop: renderer boot health report',
    )
  }
  // The Desktop-hosted browser client shares the product identity, while
  // native window services and shell effects require the Electron markers.
  applyClawClawBrand(ctx)
  applyMarketIntegration(ctx)
  applyManagedPluginManager(ctx)
  applySpiritXOnboarding(ctx)
  applySpiritXProviderPriority(ctx)
  applyCronTasksSettings(ctx)
  applyRemindersSettings(ctx)
  applyLegacyAgentPresetDeleteAction(ctx)
  applySkillsSettings(ctx, { registerSection: false })
  ctx.effect(() => applyExperts(ctx), 'dsh-plugin-desktop: experts')
  applyShortcutMenu(ctx)
  if (productVersion !== undefined) applyDesktopVersionRow(ctx, productVersion)
  ctx.effect(() => installShortcutMenuStyles(), 'dsh-plugin-desktop: shortcut menu styles')
  if (!environment) return
  ctx.effect(
    () => provideDesktopWindow(ctx, desktopWindowService(environment)),
    'dsh-plugin-desktop: native window geometry service',
  )
  applyDefaultWorkspaceSelection(ctx)
  applyMcpSettings(ctx, { registerSection: false })
  const desktopSettings = applyDesktopSettings(ctx, environment)
  if (environment.platform === 'win32' || environment.platform === 'darwin') {
    ctx.effect(
      () => installDesktopDirectoryPickerBridge(),
      'dsh-plugin-desktop: native directory picker bridge',
    )
  }
  if (environment.mode !== 'compatibility') applyWorkspaceDirectoryFlow(ctx)
  if (environment.mode === 'advanced') applyAdvancedShell(ctx, environment)
  if (environment.mode === 'extended') applyExtendedShell(ctx, environment, desktopSettings)
}
