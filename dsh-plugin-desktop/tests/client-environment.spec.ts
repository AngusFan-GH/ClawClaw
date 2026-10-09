import { afterEach, describe, expect, it } from 'vitest'
import {
  parseDesktopClientEnvironment,
  resolveDesktopClientProductVersion,
} from '../src/client/environment.ts'
import { desktopWindowService } from '../src/client/window-service.ts'

afterEach(() => { delete process.env.DSH_DESKTOP_PRODUCT_VERSION })

describe('Desktop client environment', () => {
  it('recognizes the fixed compatibility presentation on supported platforms', () => {
    expect(parseDesktopClientEnvironment(
      '?dsh-desktop-mode=compatibility&dsh-desktop-platform=darwin&dsh-desktop-version=2.0.3&dsh-desktop-material=transparent',
    )).toEqual({
      version: '2.0.3', mode: 'compatibility', platform: 'darwin', material: 'transparent', micaSupported: false,
    })
    expect(parseDesktopClientEnvironment(
      '?dsh-desktop-mode=compatibility&dsh-desktop-platform=win32&dsh-desktop-version=2.0.3&dsh-desktop-material=mica&dsh-desktop-mica=1',
    )).toEqual({
      version: '2.0.3', mode: 'compatibility', platform: 'win32', material: 'mica', micaSupported: true,
    })
    expect(parseDesktopClientEnvironment(
      '?dsh-desktop-mode=compatibility&dsh-desktop-platform=linux&dsh-desktop-version=2.0.3&dsh-desktop-material=off',
    )).toEqual({
      version: '2.0.3', mode: 'compatibility', platform: 'linux', material: 'off', micaSupported: false,
    })
  })

  it('rejects legacy runtime modes and incompatible material markers', () => {
    expect(() => parseDesktopClientEnvironment(
      '?dsh-desktop-mode=advanced&dsh-desktop-platform=darwin&dsh-desktop-version=2.0.3&dsh-desktop-material=off',
    )).toThrow('invalid or missing dsh-desktop-mode')
    expect(() => parseDesktopClientEnvironment(
      '?dsh-desktop-mode=compatibility&dsh-desktop-platform=win32&dsh-desktop-version=2.0.3&dsh-desktop-material=mica&dsh-desktop-mica=0',
    )).toThrow('renderer material is incompatible')
  })

  it('keeps ordinary browser clients marker-free and validates product versions', () => {
    expect(parseDesktopClientEnvironment('')).toBeUndefined()
    process.env.DSH_DESKTOP_PRODUCT_VERSION = '2.0.3-beta.1'
    expect(resolveDesktopClientProductVersion(undefined)).toBe('2.0.3-beta.1')
    process.env.DSH_DESKTOP_PRODUCT_VERSION = 'not-a-version'
    expect(() => resolveDesktopClientProductVersion(undefined)).toThrow('invalid product version')
  })

  it('publishes zero content geometry because native chrome is isolated from the upstream client', () => {
    const service = desktopWindowService({
      version: '2.0.3', mode: 'compatibility', platform: 'darwin', material: 'transparent', micaSupported: false,
    })
    expect(service.safeAreaInsets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(service.dragRegion).toEqual({ height: 0, leftInset: 0, rightInset: 0 })
    expect(service.availableMaterials).toEqual(['off', 'transparent'])
  })
})
