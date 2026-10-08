/** Desktop automation panel backed by the established Cron task model. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CronTasksSettingsInjected } from './CronTasksSettingsSection.tsx'
import { CronTasksSettingsSection } from './CronTasksSettingsSection.tsx'
import { DesktopFeatureIcon } from './desktop-feature-icon.tsx'

export type AutomationPanelProps = PropsRuntime<'main'>
  & PropsLocale<'desktop.cron-tasks'>
  & InjectFace<CronTasksSettingsInjected>
  & { readonly close?: () => void }

/** The main panel owns navigation, so opening a task Session needs no Settings close action. */
export function AutomationPanel(props: AutomationPanelProps): JSX.Element {
  return <main className={props.close === undefined ? "dshAutomationPage" : undefined}><CronTasksSettingsSection {...props} close={props.close ?? (() => {})} /></main>
}

export function AutomationPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): JSX.Element {
  return <DesktopFeatureIcon featureId="desktop-automations" kind="panel" size={size} />
}
