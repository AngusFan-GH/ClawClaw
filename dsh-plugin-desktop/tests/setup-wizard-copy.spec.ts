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

  it('describes the sequential navigation, skip confirmation, and final success action', () => {
    const english = desktopSetupWizardCopy('en')
    const chinese = desktopSetupWizardCopy('zh')
    expect(chinese.back).toBe('上一步')
    expect(chinese.next).toBe('下一步')
    expect(chinese.successTitle).toContain('完成')
    expect(chinese.startUsing).toBe('开始使用')
    expect(chinese.skipDialogBody).toContain('设置')
    expect(chinese.skipDialogBody).toContain('桌面设置')
    expect(english.back).toMatch(/^(?:Back|Previous)$/u)
    expect(english.next).toBe('Next')
    expect(english.startUsing).toContain('Start using')
    expect(english.skipDialogBody).toContain('Settings')
    expect(english.skipDialogBody).toContain('Desktop settings')
  })

  it('introduces first-time setup for the current Profile before showing settings', () => {
    const english = desktopSetupWizardCopy('en')
    const chinese = desktopSetupWizardCopy('zh')
    expect(chinese.welcomeTitle).toBeTruthy()
    expect(chinese.welcomeBody).toContain('Profile')
    expect(chinese.firstProfileSetup).toContain('首次')
    expect(chinese.firstProfileSetup).toContain('桌面设置')
    expect(chinese.startSetup).toBe('开始设置')
    expect(english.welcomeTitle).toBeTruthy()
    expect(english.welcomeBody).toContain('Profile')
    expect(english.firstProfileSetup).toMatch(/first(?:-time| time)/iu)
    expect(english.firstProfileSetup).toMatch(/Desktop setup/iu)
    expect(english.startSetup).toBe('Start setup')
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
