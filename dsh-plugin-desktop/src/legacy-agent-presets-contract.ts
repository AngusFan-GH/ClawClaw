/** Private same-origin API for user-owned legacy Agent preset directories. */

export const DESKTOP_LEGACY_AGENT_PRESETS_PATH = '/api/desktop/legacy-agent-presets'
export const DESKTOP_LEGACY_AGENT_PRESETS_ACTION_PATH = '/api/desktop/legacy-agent-presets/action'

export interface DesktopLegacyAgentPreset {
  readonly id: string
  readonly name: string
  readonly description?: string
}

export interface DesktopLegacyAgentPresetsView {
  readonly presets: readonly DesktopLegacyAgentPreset[]
}
