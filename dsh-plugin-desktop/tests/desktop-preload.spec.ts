import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_FILE_PATH_BRIDGE } from '../src/file-path-bridge-contract.ts'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  getPathForFile: vi.fn(() => '/tmp/example.txt'),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  webUtils: { getPathForFile: electron.getPathForFile },
}))

describe('Desktop preload', () => {
  beforeEach(() => {
    electron.exposeInMainWorld.mockClear()
    electron.getPathForFile.mockClear()
    vi.resetModules()
  })

  it('marks the renderer as Desktop before exposing the file bridge', async () => {
    await import('../src/preload.ts')

    expect(electron.exposeInMainWorld).toHaveBeenNthCalledWith(1, 'dshDesktop', {
      protocolVersion: 1,
    })
    expect(electron.exposeInMainWorld).toHaveBeenNthCalledWith(
      2,
      DESKTOP_FILE_PATH_BRIDGE,
      expect.objectContaining({ getPathForFile: expect.any(Function) }),
    )
  })

  it('keeps file-path resolution delegated to Electron webUtils', async () => {
    await import('../src/preload.ts')
    const bridge = electron.exposeInMainWorld.mock.calls[1]?.[1] as {
      getPathForFile(file: File): string
    }
    const file = {} as File

    expect(bridge.getPathForFile(file)).toBe('/tmp/example.txt')
    expect(electron.getPathForFile).toHaveBeenCalledExactlyOnceWith(file)
  })
})
