import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { stageNativeUpdate, type NativeUpdater } from '../src/native-update-installer.ts'

function provider(version = '2.1.0') {
  const emitter = new EventEmitter()
  const cancel = vi.fn()
  const updater = Object.assign(emitter, {
    autoDownload: true, autoInstallOnAppQuit: true, allowDowngrade: true, allowPrerelease: true, channel: '',
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => ({
      isUpdateAvailable: true,
      updateInfo: { version, files: [{ url: 'ClawClaw.exe', sha512: 'signed-artifact-digest' }] },
      cancellationToken: { cancel },
    })),
    downloadUpdate: vi.fn(async (_token?: unknown) => [] as string[]),
    quitAndInstall: vi.fn(),
  })
  return { updater, cancel, native: updater as unknown as NativeUpdater }
}
describe('native installer ownership', () => {
  it('stages without installing on ordinary quit and waits for the explicit installer action', async () => {
    const { updater, native } = provider()
    const progress = vi.fn()
    updater.downloadUpdate.mockImplementationOnce(async () => { updater.emit('download-progress', { percent: 42 }); return [] })
    const staged = await stageNativeUpdate(native, '2.1.0', new AbortController().signal, progress)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.autoDownload).toBe(false)
    expect(updater.allowDowngrade).toBe(false)
    expect(updater.setFeedURL).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://clawclaw.xzinfra.com/updates/dsh/stable' }))
    expect(progress).toHaveBeenCalledWith(0.42)
    expect(progress).toHaveBeenLastCalledWith(-1)
    expect(updater.listenerCount('download-progress')).toBe(0)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(staged.artifactDigest).toMatch(/^[0-9a-f]{64}$/u)
    staged.install()
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })
  it('rejects a rotated release before downloading', async () => {
    const { native, updater } = provider('2.2.0')
    await expect(stageNativeUpdate(native, '2.1.0', new AbortController().signal)).rejects.toThrow('no longer available')
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })
  it('forwards cancellation during a pending download and removes progress listeners', async () => {
    const { native, updater, cancel } = provider()
    const controller = new AbortController()
    updater.downloadUpdate.mockImplementationOnce(async () => { controller.abort(); return [] })
    await expect(stageNativeUpdate(native, '2.1.0', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledOnce()
    expect(updater.listenerCount('download-progress')).toBe(0)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })
})
