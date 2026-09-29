import { describe, expect, it } from 'vitest'
import {
  desktopProfilePreferencesWithMode,
  type DesktopProfilePreferences,
  type DesktopProfilePreferencesStateV1,
} from '../src/profile-preferences.ts'

const CURRENT: DesktopProfilePreferences = {
  mode: 'compatibility',
  openBrowser: true,
  networkExposure: 'lan',
  notifications: {
    enabled: true,
    notifyOnTurnCompletion: true,
    notifyOnTurnFailure: true,
    notifyOnJobCompletion: true,
    notifyOnJobFailure: true,
  },
  market: 'dsh-market',
}

describe('Desktop Profile mode preferences', () => {
  it('withdraws browser and LAN access for custom window modes', () => {
    expect(desktopProfilePreferencesWithMode(CURRENT, 'extended')).toEqual({
      ...CURRENT,
      mode: 'extended',
      openBrowser: false,
      networkExposure: 'loopback',
    })
  })

  it('preserves browser preferences when selecting compatibility mode', () => {
    expect(desktopProfilePreferencesWithMode(CURRENT, 'compatibility')).toEqual(CURRENT)
  })

  it('projects persisted state metadata out of the next preferences update', () => {
    const stored: DesktopProfilePreferencesStateV1 = {
      ...CURRENT,
      version: 1,
      profileHash: 'a'.repeat(64),
      recordedAt: '2026-09-29T00:00:00.000Z',
    }

    expect(desktopProfilePreferencesWithMode(stored, 'advanced')).toEqual({
      ...CURRENT,
      mode: 'advanced',
      openBrowser: false,
      networkExposure: 'loopback',
    })
  })
})
