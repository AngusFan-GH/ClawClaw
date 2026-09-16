import { beforeEach, describe, expect, it, vi } from 'vitest'
import { electronPlatformStrategy } from '../src/electron-platform.ts'
import { createServer } from 'node:http'
import { ElectronWorkspaceAdmission } from '../src/workspace-admission.ts'
import { handleDesktopDirectoryPickerRequest } from '../src/directory-picker-route.ts'
import { requestDesktopDirectory } from '../src/client/directory-picker.ts'

const electron = vi.hoisted(() => ({
  app: {
    dock: {
      setIcon: vi.fn(),
    },
    getPreferredSystemLanguages: vi.fn(() => ['en-US']),
  },
  Menu: {
    buildFromTemplate: vi.fn((template: unknown) => template),
    setApplicationMenu: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  app: electron.app,
  Menu: electron.Menu,
}))

function createWindow(): {
  readonly removeMenu: ReturnType<typeof vi.fn>
  readonly setBackgroundMaterial: ReturnType<typeof vi.fn>
} {
  return {
    removeMenu: vi.fn(),
    setBackgroundMaterial: vi.fn(),
  }
}

describe('electronPlatformStrategy', () => {
  beforeEach(() => {
    electron.app.dock.setIcon.mockClear()
    electron.Menu.buildFromTemplate.mockClear()
    electron.Menu.setApplicationMenu.mockClear()
  })

  it('selects the Windows adapter and configures native window chrome', () => {
    const strategy = electronPlatformStrategy('win32')
    const window = createWindow()
    const icon = {} as Parameters<typeof strategy.configureApplication>[0]

    expect(strategy.platform).toBe('win32')
    expect(strategy.updateDownloadPlatform).toBe('win32')
    expect(strategy.canPickDirectory).toBe(true)
    expect(strategy.canToggleShellMode).toBe(true)

    strategy.configureApplication(icon, 'DSH Desktop')
    strategy.configureWindow(window as never)
    strategy.refreshThemeMaterial(window as never, 'mica')

    expect(electron.app.dock.setIcon).not.toHaveBeenCalled()
    expect(electron.Menu.setApplicationMenu).not.toHaveBeenCalled()
    expect(window.removeMenu).toHaveBeenCalledTimes(1)
    expect(window.setBackgroundMaterial.mock.calls).toEqual([
      ['mica'],
    ])
  })

  it('selects the macOS adapter and configures its native application chrome', () => {
    const strategy = electronPlatformStrategy('darwin')
    const window = createWindow()
    const icon = {} as Parameters<typeof strategy.configureApplication>[0]

    expect(strategy.platform).toBe('darwin')
    expect(strategy.updateDownloadPlatform).toBe('darwin')
    expect(strategy.canPickDirectory).toBe(true)
    expect(strategy.canToggleShellMode).toBe(true)

    strategy.configureApplication(icon, 'DSH Desktop')
    strategy.configureWindow(window as never)
    strategy.refreshThemeMaterial(window as never, 'transparent')

    expect(electron.app.dock.setIcon).toHaveBeenCalledWith(icon)
    expect(electron.Menu.buildFromTemplate).toHaveBeenCalledTimes(1)
    expect(electron.Menu.setApplicationMenu).toHaveBeenCalledTimes(1)
    expect(window.removeMenu).not.toHaveBeenCalled()
    expect(window.setBackgroundMaterial).not.toHaveBeenCalled()
  })

  it('selects the Linux adapter without desktop chrome tweaks', () => {
    const strategy = electronPlatformStrategy('linux')
    const window = createWindow()

    expect(strategy.platform).toBe('linux')
    expect(strategy.updateDownloadPlatform).toBeUndefined()
    expect(strategy.canPickDirectory).toBe(false)
    expect(strategy.canToggleShellMode).toBe(false)

    strategy.configureApplication({} as never, 'DSH Desktop')
    strategy.configureWindow(window as never)
    strategy.refreshThemeMaterial(window as never, 'off')

    expect(electron.app.dock.setIcon).not.toHaveBeenCalled()
    expect(electron.Menu.setApplicationMenu).not.toHaveBeenCalled()
    expect(window.removeMenu).not.toHaveBeenCalled()
    expect(window.setBackgroundMaterial).not.toHaveBeenCalled()
  })

  it('serves the macOS renderer picker request using the real platform capability', async () => {
    const strategy = electronPlatformStrategy('darwin')
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: ['/Users/test/.clawclaw'] }))
    const picker = new ElectronWorkspaceAdmission({
      platform: strategy.platform,
      canPickDirectory: strategy.canPickDirectory,
      locale: () => 'en',
      showOpenDialog,
      showMessageBox: vi.fn(),
      logError: vi.fn(),
    })
    let origin = ''
    const server = createServer((req, res) => {
      void handleDesktopDirectoryPickerRequest(req, res, origin, (options) => picker.pickDirectory(options))
    })
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('missing server address')
      origin = `http://127.0.0.1:${address.port}`
      const request: Parameters<typeof requestDesktopDirectory>[0] = (input, init) => fetch(
        new URL(String(input), origin),
        { ...init, headers: { ...init?.headers, origin } },
      )
      await expect(requestDesktopDirectory(request)).resolves.toBe('/Users/test/.clawclaw')
      expect(showOpenDialog).toHaveBeenCalledWith({
        title: 'Select Workspace Directory',
        properties: ['openDirectory', 'dontAddToRecent'],
      })
      for (const showHiddenFiles of [true, false]) {
        await expect(requestDesktopDirectory(request, { showHiddenFiles })).resolves.toBe('/Users/test/.clawclaw')
        expect(showOpenDialog).toHaveBeenLastCalledWith({
          title: 'Select Workspace Directory',
          properties: ['openDirectory', 'dontAddToRecent', ...(showHiddenFiles ? ['showHiddenFiles'] : [])],
        })
      }
      showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
      await expect(requestDesktopDirectory(request)).resolves.toBeNull()
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  it('rejects unsupported platforms', () => {
    expect(() => electronPlatformStrategy('aix')).toThrow('unsupported Electron platform aix')
  })
})
