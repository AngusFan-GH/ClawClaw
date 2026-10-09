// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopSettingsSection,
  type DesktopSettingsSectionProps,
} from '../src/client/DesktopSettingsSection.tsx'
import type { DesktopSettingsApi, DesktopSettingsView } from '../src/client/desktop-settings-api.ts'
import { en } from '../src/client/desktop-settings-locales.ts'

const VIEW: DesktopSettingsView = {
  current: 'desktop',
  profiles: [{ name: 'desktop', exists: true, webCapable: true, selectable: true, deletable: false }],
  market: { requested: 'disabled', effective: 'disabled', legacyDefaulted: false },
  preferences: {
    mode: 'compatibility',
    macosMaterial: 'transparent',
    windowsMaterial: 'off',
    notifications: {
      enabled: true,
      notifyOnTurnCompletion: true,
      notifyOnTurnFailure: true,
      notifyOnJobCompletion: true,
      notifyOnJobFailure: true,
    },
    updateQualificationJournal: false,
  },
}

function desktopApi(): DesktopSettingsApi {
  return {
    read: vi.fn(async () => VIEW),
    createProfile: vi.fn(async () => VIEW),
    selectProfile: vi.fn(async () => ({ accepted: true as const, restartRequired: false })),
    deleteProfile: vi.fn(async () => VIEW),
    selectMarket: vi.fn(async () => ({ accepted: true as const, restartRequired: false })),
    updatePreference: vi.fn(async () => VIEW),
    openTerminal: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    restartToRecovery: vi.fn(async () => {}),
    reloadRenderer: vi.fn(async () => {}),
    toggleDeveloperTools: vi.fn(async () => {}),
    checkForUpdates: vi.fn(async () => {}),
    clearUpdateJournal: vi.fn(async () => {}),
    resetBackgroundCloseNotice: vi.fn(async () => {}),
    exportDiagnostics: vi.fn(async () => {}),
  }
}

let root: Root | undefined

async function renderSettings(api: DesktopSettingsApi): Promise<void> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(DesktopSettingsSection, {
      api,
      platform: 'darwin',
      micaSupported: false,
      close: vi.fn(),
      t: key => en[key as keyof typeof en],
    } as DesktopSettingsSectionProps))
  })
}

function toggleFor(label: string): HTMLButtonElement {
  const row = [...document.querySelectorAll<HTMLElement>('.dshDesktopSettingsToggleRow')]
    .find(element => element.textContent?.includes(label))
  const toggle = row?.querySelector<HTMLButtonElement>('[role="switch"]')
  if (toggle === undefined || toggle === null) throw new Error(`missing toggle for ${label}`)
  return toggle
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('Desktop settings window appearance', () => {
  it('persists material through the launcher API before opening restart confirmation', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const api = desktopApi()
    await renderSettings(api)
    const select = document.querySelector<HTMLSelectElement>('.dshDesktopSettingsSelect')
    expect(select).not.toBeNull()

    await act(async () => {
      select!.value = 'off'
      select!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(api.updatePreference).toHaveBeenCalledWith({ field: 'macosMaterial', value: 'off' })
    expect(api.restart).toHaveBeenCalledOnce()
  })

  it('writes notification choices and omits browser access controls', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const api = desktopApi()
    await renderSettings(api)

    await act(async () => { toggleFor(en.notificationsEnabled).click() })
    expect(api.updatePreference).toHaveBeenCalledWith({
      field: 'notifications',
      value: { ...VIEW.preferences.notifications, enabled: false },
    })

    expect(document.body.textContent).not.toContain(en.readOnly)
    expect(document.body.textContent).not.toContain('后台驻留提示')
    expect(document.body.textContent).not.toContain('更新资格记录')
    expect(document.body.textContent).not.toContain('浏览器与局域网')
    expect(document.body.textContent).not.toContain('Profile')
    expect(document.querySelector('input[placeholder="For example: work"]')).toBeNull()
  })
})
