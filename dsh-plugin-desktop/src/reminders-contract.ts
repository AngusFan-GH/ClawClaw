/** Public values and loopback paths for ClawClaw's global reminders. */

export const DESKTOP_REMINDERS_PATH = '/api/desktop/reminders'
export const DESKTOP_REMINDERS_ACTION_PATH = '/api/desktop/reminders/action'

export interface DesktopReminder {
  readonly id: string
  readonly text: string
  readonly enabled: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

export interface DesktopRemindersView {
  readonly reminders: readonly DesktopReminder[]
}
