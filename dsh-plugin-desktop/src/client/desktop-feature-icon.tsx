/** Canonical icons for Desktop features wherever they appear in navigation. */

import {
  IconAgentPresetOutlineMedium,
  IconArchiveOutlineMedium,
  IconClockOutlineRegular,
  IconDataOutlineMedium,
  IconListPenOutlineMedium,
  IconPersonalizationOutlineMedium,
  IconPluginPinwheelOutlineRegular,
  IconSettingsOutlineMedium,
  IconSkillOutlineMedium,
  IconUserOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { Cable, GraduationCap, MessageCirclePlus, MonitorCog } from 'lucide-react'

export interface DesktopFeatureIconProps {
  readonly featureId: string
  readonly kind: 'panel' | 'settings'
  readonly size?: number
  readonly className?: string
}

/** Render the semantic glyph shared by Settings, shortcut configuration, and the sidebar. */
export function DesktopFeatureIcon({ featureId, kind, size = 16, className }: DesktopFeatureIconProps): JSX.Element {
  const props = { size, className, 'aria-hidden': true } as const
  if (kind === 'panel') {
    if (featureId === 'plugins') return <IconPluginPinwheelOutlineRegular {...props} />
    if (featureId === 'desktop-automations') return <IconClockOutlineRegular {...props} />
    if (featureId === 'desktop-experts') return <GraduationCap {...props} strokeWidth={1.5} />
    return <IconSettingsOutlineMedium {...props} />
  }
  if (featureId === 'account') return <IconUserOutlineMedium {...props} />
  if (featureId === 'models') return <IconDataOutlineMedium {...props} />
  if (featureId === 'plugins') return <IconPersonalizationOutlineMedium {...props} />
  if (featureId === 'agent-presets') return <IconAgentPresetOutlineMedium {...props} />
  if (featureId === 'archived-sessions') return <IconArchiveOutlineMedium {...props} />
  if (featureId === 'desktop-reminders') return <IconListPenOutlineMedium {...props} />
  if (featureId === 'desktop-skills') return <IconSkillOutlineMedium {...props} />
  if (featureId === 'desktop-mcp') return <Cable {...props} strokeWidth={1.5} />
  if (featureId === 'desktop') return <MonitorCog {...props} strokeWidth={1.5} />
  if (featureId === 'clawclaw-channels') return <MessageCirclePlus {...props} strokeWidth={1.5} />
  return <IconSettingsOutlineMedium {...props} />
}
