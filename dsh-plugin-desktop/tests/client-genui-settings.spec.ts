// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyGenuiSettings, GenuiSettingsRow, GENUI_SETTINGS_ZH, GENUI_SETTINGS_EN } from '../src/client/genui-settings.tsx'
import { GENUI_ENTRY, type GenuiSettings } from '../src/genui-contract.ts'

const roots: Root[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function form(initial: Partial<ConfigFormSnapshot<GenuiSettings>> = {}) {
  let snapshot: ConfigFormSnapshot<GenuiSettings> = { status: 'ready', value: { enabled: false },
    base: { enabled: false }, user: {}, revision: 1, writable: true, ...initial }
  const listeners = new Set<() => void>()
  const set = vi.fn<(field: string, value: unknown) => Promise<boolean>>(async () => false)
  const settings: ConfigForm<GenuiSettings> = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set, unset: async () => false, mutate: async () => false,
  }
  return { settings, set, update(patch: Partial<ConfigFormSnapshot<GenuiSettings>>) {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  } }
}

async function mount(settings: ConfigForm<GenuiSettings>, language: 'zh' | 'en' = 'zh') {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const element = document.createElement('div'); document.body.append(element)
  const root = createRoot(element); roots.push(root)
  const dictionary = language === 'zh' ? GENUI_SETTINGS_ZH : GENUI_SETTINGS_EN
  await act(async () => root.render(createElement(GenuiSettingsRow, { settings, t: key => dictionary[key] })))
  return { element, root }
}

describe('GenUI General settings switch', () => {
  it('animates the shared switch immediately without adding a saving row, then follows Host state', async () => {
    const source = form()
    let finish!: (value: boolean) => void
    source.set.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const { element } = await mount(source.settings)
    const toggle = element.querySelector<HTMLButtonElement>('[role="switch"]')!
    expect(toggle.getAttribute('aria-label')).toBe('可视化回答')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    const rowElements = Array.from(element.querySelectorAll('*'))
    await act(async () => { toggle.click(); toggle.click() })
    expect(source.set).toHaveBeenCalledExactlyOnceWith('enabled', true)
    expect(toggle.disabled).toBe(true)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(element.querySelector('[role="status"]')).toBeNull()
    expect(element.textContent).not.toContain('正在保存')
    // Keep the same title/description/control elements throughout the write.
    expect(Array.from(element.querySelectorAll('*'))).toEqual(rowElements)
    await act(async () => { source.update({ value: { enabled: true }, revision: 2 }); finish(true) })
    expect(toggle.disabled).toBe(false)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(element.querySelector('[role="status"]')).toBeNull()
    await act(async () => source.update({ value: { enabled: false }, revision: 3 }))
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it.each([false, true])('rolls a pending toggle back to the confirmed value after failure (enabled=%s)', async enabled => {
    const source = form({ value: { enabled } })
    let reject!: (reason: Error) => void
    source.set.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    const { element } = await mount(source.settings)
    const toggle = element.querySelector<HTMLButtonElement>('[role="switch"]')!
    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-checked')).toBe(String(!enabled))
    expect(toggle.disabled).toBe(true)
    expect(source.settings.getSnapshot().value?.enabled).toBe(enabled)
    await act(async () => reject(new Error('offline')))
    expect(toggle.getAttribute('aria-checked')).toBe(String(enabled))
    expect(toggle.disabled).toBe(false)
    expect(element.querySelector('[role="alert"]')?.textContent).toBe(GENUI_SETTINGS_ZH.failed)
  })

  it.each(['refused', 'rejected'] as const)('shows a recoverable error after a %s write', async failure => {
    const source = form()
    if (failure === 'rejected') source.set.mockRejectedValueOnce(new Error('offline'))
    else source.set.mockResolvedValueOnce(false)
    const { element } = await mount(source.settings, 'en')
    const toggle = element.querySelector<HTMLButtonElement>('[role="switch"]')!
    await act(async () => toggle.click())
    expect(element.querySelector('[role="alert"]')?.textContent).toBe(GENUI_SETTINGS_EN.failed)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle.disabled).toBe(false)
    source.set.mockImplementation(async () => { source.update({ value: { enabled: true } }); return true })
    await act(async () => toggle.click())
    expect(element.querySelector('[role="alert"]')).toBeNull()
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  it('prevents writes to a read-only Profile', async () => {
    const source = form({ writable: false })
    const { element } = await mount(source.settings)
    const toggle = element.querySelector<HTMLButtonElement>('[role="switch"]')!
    expect(toggle.disabled).toBe(true)
    await act(async () => toggle.click())
    expect(source.set).not.toHaveBeenCalled()
  })

  it.each(['loading', 'unavailable'] as const)('hides the control when Host configuration is %s', async status => {
    const source = form({ status, value: undefined })
    const { element } = await mount(source.settings)
    expect(element.textContent).toBe('')
    await act(async () => source.update({ status: 'ready', value: { enabled: true } }))
    expect(element.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
  })

  it('registers a localized General row against the existing Host entry', () => {
    const source = form()
    const register = vi.fn(() => () => {})
    const get = vi.fn(() => source.settings)
    const locale = vi.fn(() => () => {})
    const scope = { configForms: { get }, locale: { register: locale },
      effect: (install: () => () => void) => install(),
      slots: { inject: (_name: string, install: () => () => void) => install(), register },
    }
    applyGenuiSettings({ inject: (_services: string[], install: (scope: unknown) => void) => install(scope) } as unknown as Context)
    expect(get).toHaveBeenCalledWith(GENUI_ENTRY)
    expect(locale).toHaveBeenCalledWith('desktop.genui', { zh: GENUI_SETTINGS_ZH, en: GENUI_SETTINGS_EN })
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ name: 'settings.general.item', id: GENUI_ENTRY, locale: 'desktop.genui' }), GenuiSettingsRow)
  })
})
