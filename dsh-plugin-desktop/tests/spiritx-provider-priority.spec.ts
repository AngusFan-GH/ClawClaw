// @vitest-environment jsdom
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  applySpiritXProviderPriority,
  protectSpiritXProviderRow,
  SPIRITX_PROVIDER_PRIORITY_STYLE,
  SpiritXProviderPriorityMarker,
} from '../src/client/spiritx-provider-priority.tsx'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function injected(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    load: vi.fn(async () => ({ ok: true, value: {
      baseURL: 'https://ai.xzinfra.com/spiritx-api/v1',
      models: [{ id: 'chat-first', name: 'Chat First' }],
    } })),
    discover: vi.fn(async () => ({ ok: true, value: [] })),
    provision: vi.fn(async () => undefined),
    saveModels: vi.fn(async () => undefined),
    t: (key: string) => key,
    ...overrides,
  }
}

describe('SpiritX provider priority', () => {
  it('pins the SpiritX card and hides custom and delete chrome', () => {
    const row = document.createElement('li')
    row.innerHTML = `<div><span><span>SpiritX</span><span>自定义</span><span role="img"></span></span><span><button aria-label="编辑 SpiritX">编辑</button><button aria-label="删除 SpiritX">删除</button></span></div><div data-dsh-spiritx-provider></div>`
    document.body.append(row)
    const root = row.querySelector<HTMLElement>('[data-dsh-spiritx-provider]')
    expect(root).not.toBeNull()

    const dispose = protectSpiritXProviderRow(root!)

    expect(row.style.getPropertyValue('order')).toBe('-1')
    expect(row.style.getPropertyPriority('order')).toBe('important')
    expect(row.querySelector<HTMLElement>('span > span:nth-child(2)')?.style.display).toBe('none')
    expect(row.querySelector<HTMLElement>('div > span:last-child')?.style.display).toBe('none')
    expect(row.querySelector<HTMLElement>('[role="img"]')?.style.display).not.toBe('none')
    dispose()
    row.remove()
  })

  it('marks only the SpiritX provider card', () => {
    const props = (provider: string) => ({
      provider: { provider }, keyConfigured: true, ...injected(),
    }) as never
    expect(renderToStaticMarkup(SpiritXProviderPriorityMarker(props('spiritx'))))
      .toContain('data-dsh-spiritx-provider')
    expect(renderToStaticMarkup(SpiritXProviderPriorityMarker(props('openai')))).toBe('')
  })

  it('opens the complete editor immediately when SpiritX has no configured key', () => {
    const html = renderToStaticMarkup(SpiritXProviderPriorityMarker({
      provider: { provider: 'spiritx' }, configured: false, keyConfigured: false, ...injected(),
    } as never))
    expect(html).toContain('spiritxProviderEditor')
    expect(html).toContain('customized')
    expect(html).toContain('placeholder')
  })

  it('requires setup when a stored key exists without a materialized SpiritX profile', () => {
    const html = renderToStaticMarkup(SpiritXProviderPriorityMarker({
      provider: { provider: 'spiritx' }, configured: false, keyConfigured: true, ...injected(),
    } as never))
    expect(html).toContain('spiritxProviderEditor')
    expect(html).toContain('replacePlaceholder')
  })

  it('opens the built-in SpiritX credential editor for an already configured key', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(createElement(SpiritXProviderPriorityMarker, {
        provider: { provider: 'spiritx' },
        configured: true,
        keyConfigured: true,
        ...injected(),
      } as never))
    })

    await act(async () => { host.querySelector<HTMLButtonElement>('button')?.click() })

    expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.placeholder)
      .toBe('replacePlaceholder')
    expect(host.querySelector('.spiritxProviderEditor')).not.toBeNull()
    expect(host.querySelector('summary')?.textContent).toBe('customized')
    expect(host.querySelector<HTMLInputElement>('[aria-label="modelId 1"]')?.value).toBe('chat-first')
    await act(async () => { root.unmount() })
    host.remove()
  })

  it('refreshes models with the stored credential when the replacement key is blank', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const discover = vi.fn(async () => ({ ok: true, value: [
      { id: 'chat-refreshed', name: 'Chat Refreshed', contextWindow: 16_384 },
    ] }))
    await act(async () => {
      root.render(createElement(SpiritXProviderPriorityMarker, {
        provider: { provider: 'spiritx' }, configured: true, keyConfigured: true,
        ...injected({ discover }),
      } as never))
    })
    await act(async () => { host.querySelector<HTMLButtonElement>('.spiritxProviderEdit')?.click() })
    await act(async () => {})
    await act(async () => { host.querySelector<HTMLButtonElement>('.spiritxProviderLink')?.click() })

    expect(discover).toHaveBeenCalledWith(undefined)
    expect(host.querySelector<HTMLInputElement>('[aria-label="modelId 1"]')?.value).toBe('chat-refreshed')
    await act(async () => { root.unmount() })
    host.remove()
  })

  it('saves edited models with the stored credential and closes the editor', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const saveModels = vi.fn(async () => undefined)
    await act(async () => {
      root.render(createElement(SpiritXProviderPriorityMarker, {
        provider: { provider: 'spiritx' }, configured: true, keyConfigured: true,
        ...injected({ saveModels }),
      } as never))
    })
    await act(async () => { host.querySelector<HTMLButtonElement>('.spiritxProviderEdit')?.click() })
    await act(async () => {})
    await act(async () => { host.querySelector<HTMLButtonElement>('.spiritxProviderButtonPrimary')?.click() })

    expect(saveModels).toHaveBeenCalledWith([{ id: 'chat-first', name: 'Chat First' }])
    expect(host.querySelector('.spiritxProviderEditor')).toBeNull()
    await act(async () => { root.unmount() })
    host.remove()
  })

  it('shows a rejected save and keeps the editor open', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const saveModels = vi.fn(async () => { throw new Error('保存服务暂不可用') })
    await act(async () => {
      root.render(createElement(SpiritXProviderPriorityMarker, {
        provider: { provider: 'spiritx' }, configured: true, keyConfigured: true,
        ...injected({ saveModels }),
      } as never))
    })
    await act(async () => { host.querySelector<HTMLButtonElement>('.spiritxProviderEdit')?.click() })
    await act(async () => {})
    await act(async () => { host.querySelector<HTMLButtonElement>('.spiritxProviderButtonPrimary')?.click() })

    expect(host.querySelector('[role="alert"]')?.textContent).toBe('保存服务暂不可用')
    expect(host.querySelector('.spiritxProviderEditor')).not.toBeNull()
    await act(async () => { root.unmount() })
    host.remove()
  })

  it('registers the marker in the official keyed slot and installs ordering styles', () => {
    const register = vi.fn(() => vi.fn())
    const inject = vi.fn((_name: string, registerEntry: () => void) => { registerEntry() })
    const disposers: Array<() => void> = []
    const effect = vi.fn((mount: () => () => void) => { disposers.push(mount()) })

    const locale = { register: vi.fn(() => vi.fn()), bind: vi.fn(() => (key: string) => key) }
    applySpiritXProviderPriority({ slots: { inject, register }, effect, locale } as unknown as ClientContext)

    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      name: 'settings.models.provider-card',
      key: 'llm-pi-ai',
      inject: expect.any(Function),
    }), SpiritXProviderPriorityMarker)
    expect(SPIRITX_PROVIDER_PRIORITY_STYLE).toContain('order: -1')
    const style = document.querySelector('style[data-plugin-css="dsh-plugin-desktop/spiritx-provider-priority"]')
    expect(style?.textContent).toBe(SPIRITX_PROVIDER_PRIORITY_STYLE)
    disposers.forEach(dispose => { dispose() })
    expect(style?.isConnected).toBe(false)
  })
})
