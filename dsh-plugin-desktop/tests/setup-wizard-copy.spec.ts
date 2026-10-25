import { describe, expect, it } from 'vitest'
import {
  desktopSetupWizardSelectionIsAvailable,
  isDesktopSetupWizardInput,
  type DesktopSetupWizardInput,
} from '../src/setup-wizard-contract.ts'
import { desktopSetupWizardCopy } from '../src/setup-wizard-copy.ts'

const input: DesktopSetupWizardInput = {
  appVersion: '2.0.6-beta.1',
  profileName: 'work',
  platform: 'win32',
  micaSupported: true,
  mode: 'compatibility',
  macosMaterial: 'transparent',
  windowsMaterial: 'mica',
  openBrowser: false,
  networkExposure: 'loopback',
  market: 'disabled',
  notifications: {
    enabled: true,
    notifyOnTurnCompletion: true,
    notifyOnTurnFailure: true,
    notifyOnJobCompletion: true,
    notifyOnJobFailure: true,
  },
}

describe('Desktop Setup Wizard copy and contract', () => {
  it('keeps English and Chinese dictionaries structurally complete', () => {
    const english = desktopSetupWizardCopy('en')
    const chinese = desktopSetupWizardCopy('zh')
    expect(Object.keys(english)).toEqual(Object.keys(chinese))
    expect(Object.values(english).every(value => value.length > 0)).toBe(true)
    expect(Object.values(chinese).every(value => value.length > 0)).toBe(true)
  })

  it('introduces model setup and defers optional preferences without exposing Profile', () => {
    for (const locale of ['en', 'zh'] as const) {
      const copy = desktopSetupWizardCopy(locale)
      expect(copy.modelBody).toContain('SpiritX')
      expect(copy.defaultsBody).toContain(locale === 'zh' ? '桌面设置' : 'Desktop settings')
      expect(copy.modelBody).toContain(locale === 'zh' ? '稍后' : 'later')
      expect(JSON.stringify(copy)).not.toContain('Profile')
      expect(JSON.stringify(copy)).not.toContain(locale === 'zh' ? '已保存' : 'saved')
      expect(copy.continue).toBe(locale === 'zh' ? '继续' : 'Continue')
    }
  })

  it('strictly validates complete input and platform capability gates', () => {
    expect(isDesktopSetupWizardInput(input)).toBe(true)
    expect(isDesktopSetupWizardInput({ ...input, unexpected: true })).toBe(false)
    expect(isDesktopSetupWizardInput({ ...input, notifications: { enabled: true } })).toBe(false)
    expect(isDesktopSetupWizardInput({ ...input, appVersion: '' })).toBe(false)
    expect(isDesktopSetupWizardInput({ ...input, appVersion: '<script>' })).toBe(false)
    expect(isDesktopSetupWizardInput({ ...input, profileName: '../escape' })).toBe(false)
    expect(isDesktopSetupWizardInput({ ...input, profileName: 'CON' })).toBe(false)
    expect(desktopSetupWizardSelectionIsAvailable(input, input)).toBe(true)
    expect(desktopSetupWizardSelectionIsAvailable(input, { platform: 'win32', micaSupported: false })).toBe(false)
    expect(isDesktopSetupWizardInput({ ...input, mode: 'extended' })).toBe(false)
    expect(isDesktopSetupWizardInput({ ...input, mode: 'advanced' })).toBe(false)
  })
})
