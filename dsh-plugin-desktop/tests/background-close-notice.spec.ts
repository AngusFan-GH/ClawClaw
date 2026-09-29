import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopBackgroundCloseNotice,
  desktopBackgroundCloseNoticePath,
} from '../src/background-close-notice.ts'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'clawclaw-background-notice-'))
  roots.add(root)
  const markerPath = desktopBackgroundCloseNoticePath(root, 'desktop')
  const response = Promise.withResolvers<MessageBoxReturnValue>()
  const show = vi.fn<(options: MessageBoxOptions) => Promise<MessageBoxReturnValue>>(
    async () => await response.promise,
  )
  const focus = vi.fn()
  const hide = vi.fn()
  const warn = vi.fn()
  const options = { markerPath, locale: () => 'zh' as const, show, focus, warn }
  return { root, markerPath, response, show, focus, hide, warn, options,
    notice: new DesktopBackgroundCloseNotice(options) }
}

const roots = new Set<string>()

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.clear()
})

describe('background close notice', () => {
  it('waits for acknowledgement once per Profile and coalesces repeated close requests', async () => {
    const fixture = setup()
    fixture.notice.close(fixture.hide)
    fixture.notice.close(fixture.hide)
    expect(fixture.hide).not.toHaveBeenCalled()
    expect(fixture.focus).toHaveBeenCalledOnce()
    expect(fixture.show).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      title: 'ClawClaw 正在后台运行',
      buttons: ['知道了'],
    }))

    fixture.response.resolve({ response: 0, checkboxChecked: false })
    await vi.waitFor(() => { expect(fixture.hide).toHaveBeenCalledOnce() })
    expect(existsSync(fixture.markerPath)).toBe(true)
    fixture.notice.close(fixture.hide)
    expect(fixture.hide).toHaveBeenCalledTimes(2)
  })

  it('isolates marker paths by Profile and supports an explicit reset', async () => {
    const fixture = setup()
    expect(desktopBackgroundCloseNoticePath(fixture.root, 'desktop'))
      .not.toBe(desktopBackgroundCloseNoticePath(fixture.root, '../other'))
    fixture.notice.close(fixture.hide)
    fixture.response.resolve({ response: 0, checkboxChecked: false })
    await vi.waitFor(() => { expect(existsSync(fixture.markerPath)).toBe(true) })
    fixture.notice.reset()
    expect(existsSync(fixture.markerPath)).toBe(false)
  })

  it('keeps the window visible after cancellation, failure, or disposal', async () => {
    const cancelled = setup()
    cancelled.notice.close(cancelled.hide)
    cancelled.response.resolve({ response: -1, checkboxChecked: false })
    await cancelled.response.promise
    expect(cancelled.hide).not.toHaveBeenCalled()

    const failed = setup()
    failed.show.mockRejectedValueOnce(new Error('dialog unavailable'))
    failed.notice.close(failed.hide)
    await vi.waitFor(() => { expect(failed.warn).toHaveBeenCalled() })
    expect(failed.hide).not.toHaveBeenCalled()

    const disposed = setup()
    disposed.notice.close(disposed.hide)
    disposed.notice.dispose()
    disposed.response.resolve({ response: 0, checkboxChecked: false })
    await disposed.response.promise
    expect(disposed.hide).not.toHaveBeenCalled()
  })

  it('does not follow a symbolic-link marker directory', async () => {
    const fixture = setup()
    const outside = join(fixture.root, 'outside')
    mkdirSync(outside)
    const markerParent = join(fixture.root, 'linked')
    symlinkSync(outside, markerParent, process.platform === 'win32' ? 'junction' : 'dir')
    const notice = new DesktopBackgroundCloseNotice({
      ...fixture.options,
      markerPath: join(markerParent, 'background-close-v1'),
    })
    notice.close(fixture.hide)
    fixture.response.resolve({ response: 0, checkboxChecked: false })
    await vi.waitFor(() => { expect(fixture.warn).toHaveBeenCalled() })
    expect(fixture.hide).toHaveBeenCalledOnce()
    expect(existsSync(join(outside, 'background-close-v1'))).toBe(false)
  })
})
