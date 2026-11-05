// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpiritXCredential } from '../src/client/spiritx-onboarding.tsx'
import { SPIRITX_ONBOARDING_COPY, SPIRITX_PLATFORM_URL, type SpiritXCredentialState } from '../src/client/spiritx-onboarding-state.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    Button: ({ variant: _variant, ...props }: Record<string, unknown>) => createElement('button', props),
    Modal: ({ children }: { children: import('react').ReactNode }) => createElement('div', { role: 'dialog' }, children),
  }
})

const copy = SPIRITX_ONBOARDING_COPY.en
type Props = {
  complete(): void
  loadCredential(): Promise<SpiritXCredentialState>
  storeCredential(value: string): Promise<string | undefined>
  t(key: keyof typeof copy): string
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
  vi.useRealTimers()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})
async function render(overrides: Partial<Props> = {}): Promise<Props> {
  const props: Props = {
    complete: vi.fn(), loadCredential: vi.fn(async () => ({ kind: 'missing' as const, writable: true })),
    storeCredential: vi.fn(async () => undefined), t: key => copy[key], ...overrides,
  }
  await act(async () => { root.render(createElement(SpiritXCredential as ComponentType<Props>, props)) })
  return props
}
function button(label: string): HTMLButtonElement {
  return [...document.querySelectorAll('button')].find(element => element.textContent === label)!
}
async function enterKey(value: string): Promise<void> {
  const input = document.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit(): Promise<void> {
  await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
}

describe('model onboarding flow', () => {
  it.each(['en', 'zh'] as const)('guides %s users to get a key without leaving or completing setup', async locale => {
    const localized = SPIRITX_ONBOARDING_COPY[locale]
    const props = await render({ t: key => localized[key] })
    const guide = document.querySelector('section')!
    expect([...guide.querySelectorAll('li')].map(item => item.textContent))
      .toEqual([localized.registerStep, localized.findKeyStep, localized.createKeyStep, localized.connectKeyStep])
    const link = guide.querySelector('a')!
    expect(link.href).toBe(SPIRITX_PLATFORM_URL)
    expect(link.href).toBe('https://ai.xzinfra.com/')
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noopener noreferrer')
    expect(link.textContent).toContain(localized.getKey)
    expect(document.getElementById(link.getAttribute('aria-describedby')!)?.textContent).toBe(localized.browserHelp)
    await enterKey('existing-key')
    // Browser navigation is handled by Electron's existing external-link handler.
    link.addEventListener('click', event => { event.preventDefault() })
    await act(async () => { link.click() })
    expect(document.querySelector('input')?.value).toBe('existing-key')
    expect(props.complete).not.toHaveBeenCalled()
    expect(props.storeCredential).not.toHaveBeenCalled()
    await submit()
    expect(props.storeCredential).toHaveBeenCalledWith('existing-key')
    expect(props.complete).toHaveBeenCalledOnce()
  })

  it('skips already configured models without showing a form', async () => {
    const props = await render({ loadCredential: vi.fn(async () => ({ kind: 'configured' as const })) })
    expect(props.complete).toHaveBeenCalledOnce()
    expect(document.querySelector('form')).toBeNull()
  })

  it('keeps quick configured checks silent across new-conversation remounts', async () => {
    vi.useFakeTimers()
    for (let conversation = 0; conversation < 2; conversation++) {
      let finishLoad!: (state: SpiritXCredentialState) => void
      const props = await render({ loadCredential: () => new Promise(resolve => { finishLoad = resolve }) })
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      await act(async () => { vi.advanceTimersByTime(100) })
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      await act(async () => { finishLoad({ kind: 'configured' }) })
      await act(async () => { vi.advanceTimersByTime(1000) })
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(props.complete).toHaveBeenCalledOnce()
      await act(async () => { root.render(null) })
    }
  })

  it('shows the credential form immediately when configuration is missing', async () => {
    vi.useFakeTimers()
    const props = await render()
    expect(document.querySelector('input[type="password"]')).not.toBeNull()
    expect(props.complete).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(document.querySelector('input[type="password"]')).not.toBeNull()
    expect(document.querySelector('[role="status"]')).toBeNull()
  })

  it('cancels loading feedback and ignores results after unmount', async () => {
    vi.useFakeTimers()
    let finishLoad!: (state: SpiritXCredentialState) => void
    const props = await render({ loadCredential: () => new Promise(resolve => { finishLoad = resolve }) })
    await act(async () => { root.render(null) })
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => { finishLoad({ kind: 'configured' }); vi.advanceTimersByTime(1000) })
    expect(props.complete).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps failed loads visible and retries instead of silently marking setup complete', async () => {
    const loadCredential = vi.fn<Props['loadCredential']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ kind: 'missing', writable: true })
    const props = await render({ loadCredential })
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(copy.unavailable)
    expect(props.complete).not.toHaveBeenCalled()
    await act(async () => { button(copy.retry).click() })
    expect(document.querySelector('input[type="password"]')).not.toBeNull()
    expect(loadCredential).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('Settings > Models')
    await act(async () => { button(copy.later).click() })
    expect(props.complete).toHaveBeenCalledOnce()
    expect(props.storeCredential).not.toHaveBeenCalled()
  })

  it('allows entering the app while a configuration check is still pending', async () => {
    vi.useFakeTimers()
    let finishLoad!: (state: SpiritXCredentialState) => void
    const props = await render({ loadCredential: () => new Promise(resolve => { finishLoad = resolve }) })
    await act(async () => { vi.advanceTimersByTime(499) })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(document.querySelector('[role="status"]')?.textContent).toBe(copy.loading)
    await act(async () => { button(copy.later).click(); button(copy.later).click() })
    await act(async () => { finishLoad({ kind: 'configured' }) })
    expect(props.complete).toHaveBeenCalledOnce()
  })

  it('validates input, preserves the key after failure, and only completes after a successful retry', async () => {
    const storeCredential = vi.fn<Props['storeCredential']>()
      .mockRejectedValueOnce(new Error('private transport details'))
      .mockResolvedValue(undefined)
    const props = await render({ storeCredential })
    await submit()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(copy.required)
    expect(storeCredential).not.toHaveBeenCalled()
    await enterKey(' test-key ')
    await submit()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(copy.saveFailed)
    expect(document.querySelector('input')?.value).toBe(' test-key ')
    expect(props.complete).not.toHaveBeenCalled()
    await submit()
    expect(storeCredential).toHaveBeenLastCalledWith('test-key')
    expect(props.complete).toHaveBeenCalledOnce()
    expect(document.querySelector('input')?.value).toBe('')
  })

  it('prevents duplicate saves and keeps provisioning failures actionable', async () => {
    let finish!: (failure: string | undefined) => void
    const storeCredential = vi.fn(() => new Promise<string | undefined>(resolve => { finish = resolve }))
    const props = await render({ storeCredential })
    await enterKey('test-key')
    await submit()
    await submit()
    expect(storeCredential).toHaveBeenCalledOnce()
    expect(document.querySelector('input')?.disabled).toBe(true)
    expect(button(copy.saving).disabled).toBe(true)
    await act(async () => { finish('No language models available') })
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('No language models available')
    expect(props.complete).not.toHaveBeenCalled()
    expect(button(copy.save).disabled).toBe(false)
  })
})
