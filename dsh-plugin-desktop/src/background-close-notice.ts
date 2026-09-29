/** One-time, per-Profile confirmation before the desktop first hides to the tray. */

import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { DesktopLocale } from './runtime.ts'

export interface DesktopBackgroundCloseNoticeOptions {
  readonly markerPath: string
  readonly locale: () => DesktopLocale
  readonly show: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>
  readonly focus: () => void
  readonly warn?: (message: string) => void
}

export function desktopBackgroundCloseNoticePath(userDataDir: string, profileName: string): string {
  const profileKey = createHash('sha256').update(profileName).digest('hex')
  return join(userDataDir, 'notices', 'profiles', profileKey, 'background-close-v1')
}

function noticeCopy(locale: DesktopLocale): Pick<MessageBoxOptions, 'title' | 'message' | 'buttons'> {
  return locale === 'zh'
    ? { title: 'ClawClaw 正在后台运行', message: '关闭窗口不会中断正在运行的任务。可从系统托盘重新打开。', buttons: ['知道了'] }
    : { title: 'ClawClaw is running in the background', message: 'Closing the window does not interrupt active work. Reopen it from the system tray.', buttons: ['Got it'] }
}

function writeMarker(path: string): void {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stats = lstatSync(directory)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('dsh-plugin-desktop: background notice directory is invalid')
  }
  const temporary = join(directory, `.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, '', { flag: 'wx', mode: 0o600, flush: true })
    renameSync(temporary, path)
  } finally {
    try { unlinkSync(temporary) } catch {}
  }
}

function hasValidMarker(path: string): boolean {
  try {
    const stats = lstatSync(path)
    return stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw cause
  }
}

/** Coalesces repeated close requests and remembers only explicit acknowledgement. */
export class DesktopBackgroundCloseNotice {
  private acknowledged = false
  private pending = false
  private disposed = false

  constructor(private readonly options: DesktopBackgroundCloseNoticeOptions) {}

  close(hide: () => void): void {
    if (this.disposed) return
    if (this.pending) {
      this.options.focus()
      return
    }
    let persisted = false
    try { persisted = hasValidMarker(this.options.markerPath) } catch (cause) {
      this.options.warn?.(`dsh-plugin-desktop: could not read background notice: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
    if (this.acknowledged || persisted) {
      hide()
      return
    }
    this.pending = true
    void this.confirm(hide)
  }

  reset(): void {
    this.acknowledged = false
    try { unlinkSync(this.options.markerPath) } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
  }

  dispose(): void {
    this.disposed = true
  }

  private async confirm(hide: () => void): Promise<void> {
    try {
      const copy = noticeCopy(this.options.locale())
      const result = await this.options.show({
        type: 'info',
        ...copy,
        defaultId: 0,
        cancelId: -1,
        noLink: true,
      })
      if (this.disposed || result.response !== 0) return
      this.acknowledged = true
      try { writeMarker(this.options.markerPath) } catch (cause) {
        this.options.warn?.(`dsh-plugin-desktop: could not record background notice: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
      hide()
    } catch (cause) {
      this.options.warn?.(`dsh-plugin-desktop: background notice unavailable: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      this.pending = false
    }
  }
}
