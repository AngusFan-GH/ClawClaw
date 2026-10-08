/** Coalesced native confirmation before quitting a Host with interruptible work. */

import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { DesktopLocale } from './runtime.ts'
import {
  hasDesktopActiveInterruptions,
  type DesktopInterruptionSnapshot,
} from './interruption-inspection.ts'
import { desktopNativeCopy } from './native-dialog-copy.ts'

export type DesktopQuitPrompt = 'active' | undefined

/** Unknown inspection is deliberately treated as possibly active work.
 *
 * Armed future cron tasks do not need confirmation: they are persisted and will
 * resume when ClawClaw starts again. Only work that is active right now can be
 * interrupted by an immediate quit.
 */
export function resolveDesktopQuitPrompt(
  snapshot: DesktopInterruptionSnapshot | 'unknown',
): DesktopQuitPrompt {
  if (snapshot === 'unknown') return 'active'
  return hasDesktopActiveInterruptions(snapshot) ? 'active' : undefined
}

export interface DesktopQuitConfirmationOptions {
  readonly locale: () => DesktopLocale
  /** Undefined means the Host is not bound yet, so no Host work can exist. */
  readonly inspect: () => Promise<DesktopInterruptionSnapshot> | undefined
  readonly show: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>
  readonly focus: () => void
}

/** One native decision at a time; repeated quit sources join instead of stacking dialogs. */
export class DesktopQuitConfirmation {
  private pending: Promise<boolean> | undefined
  private disposed = false

  constructor(private readonly options: DesktopQuitConfirmationOptions) {}

  confirm(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    if (this.pending !== undefined) {
      this.options.focus()
      return this.pending
    }
    const pending = this.decide().finally(() => {
      if (this.pending === pending) this.pending = undefined
    })
    this.pending = pending
    return pending
  }

  dispose(): void {
    this.disposed = true
  }

  private async decide(): Promise<boolean> {
    const inspection = this.options.inspect()
    if (inspection === undefined) return true
    const prompt = resolveDesktopQuitPrompt(await inspection.catch(() => 'unknown' as const))
    if (this.disposed || prompt === undefined) return !this.disposed
    const copy = desktopNativeCopy(this.options.locale())
    const result = await this.options.show({
      type: 'warning',
      title: copy.quitTitle,
      message: copy.quitMessage,
      detail: copy.quitActiveTasks,
      buttons: [copy.quit, copy.cancel],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }).catch(() => undefined)
    if (result === undefined) return false
    return !this.disposed && result.response === 0
  }
}

export interface DesktopQuitRequestOptions {
  readonly confirmation: Pick<DesktopQuitConfirmation, 'confirm'>
  readonly shutdown: (code: number) => Promise<void>
}

/** Coalesce quit sources across both the decision and the final shutdown. */
export class DesktopQuitRequest {
  private pending: Promise<void> | undefined

  constructor(private readonly options: DesktopQuitRequestOptions) {}

  request(code: number): Promise<void> {
    if (this.pending !== undefined) {
      void this.options.confirmation.confirm()
      return this.pending
    }
    const task = this.options.confirmation.confirm().then(async (confirmed) => {
      if (confirmed) await this.options.shutdown(code)
    }).finally(() => {
      if (this.pending === task) this.pending = undefined
    })
    this.pending = task
    return task
  }
}
