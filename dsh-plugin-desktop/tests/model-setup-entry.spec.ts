// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelSetupEntry, openModelSettings } from '../src/client/model-setup-entry.tsx'

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
  vi.unstubAllGlobals()
})

function fixture(overrides: Partial<ModelDirectoryState> = {}) {
  let snapshot: ModelDirectoryState = {
    status: 'ready', current: null, routable: false, groups: [], failures: [], pending: null, error: null, ...overrides,
  }
  const listeners = new Set<() => void>()
  const props = {
    available: true,
    directory: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    load: vi.fn(), select: vi.fn(), configureLabel: '配置模型', openModelSettings: vi.fn(),
    sectionComponent: vi.fn(() => createElement('span', { 'data-selector': true }, 'Original model selector')),
  } as unknown as ComponentProps<typeof ModelSetupEntry>
  return { props, update: (patch: Partial<ModelDirectoryState>) => {
    snapshot = { ...snapshot, ...patch }
    listeners.forEach(listener => { listener() })
  } }
}
async function render(props: ComponentProps<typeof ModelSetupEntry>) {
  await act(async () => { root.render(createElement(ModelSetupEntry, props)) })
}

describe('empty model setup entry', () => {
  it('offers a direct setup button and opens the model settings section', async () => {
    const { props } = fixture()
    const openSection = vi.fn()
    const ctx = { slots: { entriesOfSlot: vi.fn((slot: string) => slot === 'main' ? [] : [{ store: { create: () => ({ actions: { openSection } }) } }]) } } as unknown as Context
    props.openModelSettings = () => openModelSettings(ctx)
    await render(props)
    const button = document.querySelector('button')!
    expect(button.textContent).toBe('配置模型')
    expect(document.querySelector('[data-selector]')).toBeNull()
    await act(async () => { button.click() })
    expect(openSection).toHaveBeenCalledWith('models')
    expect(props.select).not.toHaveBeenCalled()
  })

  it('opens the model page in the main area when it is pinned as a shortcut', () => {
    const selectPanel = vi.fn()
    const ctx = {
      slots: { entriesOfSlot: vi.fn(() => [{ options: { key: 'desktop-shortcut:models' } }]) },
      layout: { selectPanel },
    } as unknown as Context
    openModelSettings(ctx)
    expect(selectPanel).toHaveBeenCalledWith('desktop-shortcut:models')
  })

  it.each(['idle', 'loading', 'error', 'selecting'] as const)('preserves the original selector while %s', async status => {
    const { props } = fixture({ status })
    await render(props)
    expect(document.querySelector('[data-selector]')).not.toBeNull()
    expect(document.querySelector('button')).toBeNull()
  })

  it('preserves catalog failure feedback and retry controls', async () => {
    const { props } = fixture({ failures: [{ id: 'spiritx', name: 'SpiritX', message: 'offline' }] })
    await render(props)
    expect(document.querySelector('[data-selector]')).not.toBeNull()
  })

  it('restores model selection as soon as configuration provides models', async () => {
    const { props, update } = fixture()
    await render(props)
    expect(document.querySelector('button')).not.toBeNull()
    await act(async () => { update({ groups: [{ id: 'spiritx', name: 'SpiritX', models: [{ id: 'chat', name: 'Chat' }] }] }) })
    expect(document.querySelector('button')).toBeNull()
    expect(document.querySelector('[data-selector]')).not.toBeNull()
    await act(async () => { update({ groups: [] }) })
    expect(document.querySelector('button')?.textContent).toBe('配置模型')
  })

  it('does not offer model configuration for addressed subagent sessions', async () => {
    const { props } = fixture()
    await render({ ...props, available: false })
    expect(document.body.textContent).toBe('')
    expect(props.load).not.toHaveBeenCalled()
  })
})
