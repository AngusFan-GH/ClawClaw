import type { NativeImage } from 'electron'
import { describe, expect, it } from 'vitest'
import type { DesktopShellSpec } from '../src/runtime.ts'
import {
  compatibilityWindowOptions,
  DESKTOP_RENDERER_SESSION_PARTITION,
  desktopWindowOptions,
} from '../src/window-options.ts'
import {
  DESKTOP_FRAME_HEIGHT,
  DESKTOP_FRAME_MACOS_TRAFFIC_LIGHT_TOP,
} from '../src/window-chrome.ts'

const spec: DesktopShellSpec = {
  profileName: 'desktop',
  mode: 'compatibility',
  macosMaterial: 'transparent',
  windowsMaterial: 'off',
  material: 'off',
  width: 1280,
  height: 840,
  minWidth: 900,
  minHeight: 640,
  url: 'http://127.0.0.1:43120/',
  authenticationUrl: 'http://127.0.0.1:43120/?token=test-token',
  rendererAccessHeader: {
    name: 'x-dsh-desktop-renderer',
    value: Buffer.alloc(32, 8).toString('base64url'),
  },
  productName: 'ClawClaw',
  windowTitle: 'DeepSeek Harness Desktop',
  iconPath: '/tmp/app-icon.png',
  trayIcons: {
    templatePath: '/tmp/tray-iconTemplate.png',
    bluePath: '/tmp/tray-icon-blue.png',
  },
  readLocalePreference: () => undefined,
  readThemeSource: () => 'system',
  requestQuit: () => {},
}

const preload = '/tmp/preload.cjs'

describe('compatibility BrowserWindow options', () => {
  it('uses an independent 36px macOS frame and enables renderer isolation', () => {
    const icon = {} as NativeImage
    const options = compatibilityWindowOptions(spec, icon, 'darwin', preload)

    expect(options).toEqual(expect.objectContaining({
      title: '',
      width: 1280,
      height: 840,
      minWidth: 900,
      minHeight: 640,
      show: false,
      backgroundColor: '#202124',
      icon,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: DESKTOP_FRAME_MACOS_TRAFFIC_LIGHT_TOP },
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        partition: DESKTOP_RENDERER_SESSION_PARTITION,
      },
    }))
    expect(options).not.toHaveProperty('titleBarOverlay')
    expect(DESKTOP_FRAME_HEIGHT).toBe(36)
  })

  it('uses an independent Windows frame with native controls on the left-side action layout', () => {
    const options = compatibilityWindowOptions(spec, {} as NativeImage, 'win32', preload)

    expect(options.title).toBe('DeepSeek Harness Desktop')
    expect(options.backgroundColor).toBe('#202124')
    expect(options.autoHideMenuBar).toBe(true)
    expect(options.titleBarStyle).toBe('hidden')
    expect(options.titleBarOverlay).toEqual(expect.objectContaining({ height: DESKTOP_FRAME_HEIGHT }))
  })

  it('keeps the ordinary native frame as the Linux compatibility fallback', () => {
    const options = compatibilityWindowOptions(spec, {} as NativeImage, 'linux', preload)

    expect(options).not.toHaveProperty('titleBarStyle')
    expect(options).not.toHaveProperty('titleBarOverlay')
    expect(options).not.toHaveProperty('trafficLightPosition')
  })

  it('reveals transparent material behind the macOS compatibility frame', () => {
    const options = compatibilityWindowOptions(
      { ...spec, material: 'transparent' },
      {} as NativeImage,
      'darwin',
      preload,
    )

    expect(options).toEqual(expect.objectContaining({
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
    }))
  })

  it('rejects an advanced spec before BrowserWindow construction', () => {
    expect(() => compatibilityWindowOptions(
      { ...spec, mode: 'advanced' } as unknown as DesktopShellSpec,
      {} as NativeImage,
      'darwin',
      preload,
    )).toThrow('unsupported compatibility window mode advanced')
  })

  it('uses compatibility options for the fixed desktop presentation', () => {
    expect(desktopWindowOptions(spec, {} as NativeImage, 'win32', preload)).toEqual(
      compatibilityWindowOptions(spec, {} as NativeImage, 'win32', preload),
    )
  })
})
