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
import { applyDefaultWorkspaceSelection } from './default-workspace-selection.ts'
import { installDesktopDirectoryPickerBridge } from './directory-picker.ts'
import { applyWorkspaceDirectoryFlow } from './workspace-directory-flow.tsx'
import { parseDesktopClientEnvironment } from './environment.ts'
import { applyExtendedShell } from './extended-shell.ts'
import { applyMcpSettings } from './mcp-settings.ts'
import { applyCronTasksSettings } from './cron-tasks-settings.ts'
import { applySkillsSettings } from './skills-settings.ts'
import { installSemanticSettingsNavIcons } from './settings-nav-icons.ts'
import { applySpiritXOnboarding } from './spiritx-onboarding.tsx'
import { desktopWindowService, provideDesktopWindow } from './window-service.ts'

export { applyAdvancedShell } from './advanced-shell.ts'
export { applyClawClawBrand } from './clawclaw-brand.tsx'
export { applyDesktopSettings } from './desktop-settings.ts'
export {
  applyDefaultWorkspaceSelection,
  installDesktopWorkspaceSelection,
  resolveDesktopWorkspaceSelection,
} from './default-workspace-selection.ts'
export { applyExtendedShell, applyFramedShell } from './extended-shell.ts'
export { applyMcpSettings } from './mcp-settings.ts'
export { applySkillsSettings } from './skills-settings.ts'
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
export { parseDesktopClientEnvironment } from './environment.ts'
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
  'settingsScope',
  'sessions',
  'theme',
  'uiRenderer',
]

/** Register product identity and, in Electron, native client surfaces. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  const environment = parseDesktopClientEnvironment(window.location.search)
  // The Desktop-hosted browser client shares the product identity, while
  // native window services and shell effects require the Electron markers.
  applyClawClawBrand(ctx)
  applySpiritXOnboarding(ctx)
  applyCronTasksSettings(ctx)
  applySkillsSettings(ctx)
  ctx.effect(() => installSemanticSettingsNavIcons([
    { icon: 'marketplace', labels: ['插件市场', 'Plugin Marketplace', 'Plugins'] },
    { icon: 'skill', labels: ['技能', 'Skills'] },
    { icon: 'mcp', labels: ['MCP Servers'] },
    { icon: 'schedule', labels: ['定时任务', 'Scheduled tasks'] },
  ]), 'dsh-plugin-desktop: semantic settings navigation icons')
  if (!environment) return
  ctx.effect(
    () => provideDesktopWindow(ctx, desktopWindowService(environment)),
    'dsh-plugin-desktop: native window geometry service',
  )
  applyDefaultWorkspaceSelection(ctx)
  applyMcpSettings(ctx)
  const desktopSettings = applyDesktopSettings(ctx, environment)
  ctx.effect(
    () => startRendererBootReporter(ctx.loader),
    'dsh-plugin-desktop: renderer boot health report',
  )
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
