// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SetupWizardApp } from '../src/native-ui/setup-wizard/App.tsx'
import type { DesktopSetupWizardInput } from '../src/setup-wizard-contract.ts'

const input: DesktopSetupWizardInput = {
  appVersion: '0.2.12', profileName: 'private-work-profile', platform: 'win32', micaSupported: false,
  mode: 'compatibility', macosMaterial: 'off', windowsMaterial: 'mica',
  openBrowser: true, networkExposure: 'lan', market: 'dsh-market',
  notifications: { enabled: false, notifyOnTurnCompletion: false, notifyOnTurnFailure: true,
    notifyOnJobCompletion: false, notifyOnJobFailure: true },
}
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  document.body.replaceChildren()
  window.history.replaceState({}, '', '/')
  vi.unstubAllGlobals()
})

describe('first-run welcome', () => {
  it.each(['en', 'zh'])('continues once with existing preferences and desktop-safe defaults in %s', async locale => {
    const query = new URLSearchParams({ locale, platform: 'win32', frame: 'false',
      state: Buffer.from(JSON.stringify(input)).toString('base64url') })
    window.history.replaceState({}, '', `/?${query}`)
    const navigate = vi.fn()
    await act(async () => { root.render(createElement(SetupWizardApp, { navigate })) })
    expect(document.body.textContent).not.toContain('Profile')
    expect(document.body.textContent).not.toContain(input.profileName)
    expect(document.querySelectorAll('button')).toHaveLength(1)
    expect(document.querySelectorAll('input, [role="switch"], [role="radiogroup"]')).toHaveLength(0)
    const button = document.querySelector('button')!
    await act(async () => { button.click(); button.click() })
    expect(navigate).toHaveBeenCalledOnce()
    expect(button.disabled).toBe(true)
    const action = new URL(navigate.mock.calls[0]![0])
    expect(action.hostname).toBe('complete')
    expect(Object.fromEntries(action.searchParams)).toMatchObject({
      mode: 'compatibility', macosMaterial: 'off', windowsMaterial: 'off', market: 'dsh-market',
      openBrowser: 'false', networkExposure: 'loopback', notificationsEnabled: 'false',
      notifyOnTurnCompletion: 'false', notifyOnTurnFailure: 'true',
      notifyOnJobCompletion: 'false', notifyOnJobFailure: 'true',
    })
    expect(document.body.textContent).not.toContain(locale === 'zh' ? '已保存' : 'saved')
  })

  it('does not acknowledge a malformed welcome state', async () => {
    window.history.replaceState({}, '', '/?locale=en&state=bad&platform=win32&frame=false')
    const navigate = vi.fn()
    await act(async () => { root.render(createElement(SetupWizardApp, { navigate })) })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded')
    expect(document.querySelector('button')).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })
})
