import { describe, expect, it } from 'vitest'
import { SPIRITX_ONBOARDING_COPY, SPIRITX_ONBOARDING_SHADOW, spiritXCredentialState } from '../src/client/spiritx-onboarding-state.ts'

describe('SpiritX onboarding', () => {
  it('prompts only while the product credential is missing', () => {
    expect(spiritXCredentialState({ configured: false, writable: true }))
      .toEqual({ kind: 'missing', writable: true })
    expect(spiritXCredentialState({ configured: true, writable: false }))
      .toEqual({ kind: 'configured' })
    expect(spiritXCredentialState(undefined)).toEqual({ kind: 'unavailable' })
  })

  it('owns the welcome and credential copy without DeepSeek branding', () => {
    for (const copy of Object.values(SPIRITX_ONBOARDING_COPY)) {
      expect(`${copy.welcomeTitle}\n${copy.welcomeBody}\n${copy.description}`).toContain('SpiritX')
      expect(`${copy.welcomeTitle}\n${copy.welcomeBody}\n${copy.description}`).not.toContain('DeepSeek')
    }
  })

  it('shadows the two upstream steps in place', () => {
    expect(SPIRITX_ONBOARDING_SHADOW).toEqual({
      welcome: { id: 'welcome-notice', order: -100, priority: -10 },
      credential: { id: 'deepseek-official', order: 0, priority: -10 },
    })
  })
})
