/** Desktop automation panel backed by the established Cron task model. */

import { IconClockOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CronTasksSettingsInjected } from './CronTasksSettingsSection.tsx'
import { CronTasksSettingsSection } from './CronTasksSettingsSection.tsx'

export type AutomationPanelProps = PropsRuntime<'main'>
  & PropsLocale<'desktop.cron-tasks'>
  & InjectFace<CronTasksSettingsInjected>

/** The main panel owns navigation, so opening a task Session needs no Settings close action. */
export function AutomationPanel(props: AutomationPanelProps): JSX.Element {
  return <main className="dshAutomationPage"><CronTasksSettingsSection {...props} close={() => {}} /></main>
}

export function AutomationPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): JSX.Element {
  return <IconClockOutlineRegular size={size} />
}
