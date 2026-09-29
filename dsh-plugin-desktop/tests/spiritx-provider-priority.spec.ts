// @vitest-environment jsdom
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  applySpiritXProviderPriority,
  SPIRITX_PROVIDER_PRIORITY_STYLE,
  SpiritXProviderPriorityMarker,
} from '../src/client/spiritx-provider-priority.tsx'

describe('SpiritX provider priority', () => {
  it('marks only the SpiritX provider card', () => {
    const props = (provider: string) => ({ provider: { provider } }) as never
    expect(renderToStaticMarkup(SpiritXProviderPriorityMarker(props('spiritx'))))
      .toContain('data-dsh-spiritx-provider')
    expect(renderToStaticMarkup(SpiritXProviderPriorityMarker(props('openai')))).toBe('')
  })

  it('registers the marker in the official keyed slot and installs ordering styles', () => {
    const register = vi.fn(() => vi.fn())
    const inject = vi.fn((_name: string, registerEntry: () => void) => { registerEntry() })
    const disposers: Array<() => void> = []
    const effect = vi.fn((mount: () => () => void) => { disposers.push(mount()) })

    applySpiritXProviderPriority({ slots: { inject, register }, effect } as unknown as ClientContext)

    expect(register).toHaveBeenCalledWith({
      name: 'settings.models.provider-card',
      key: 'spiritx',
    }, SpiritXProviderPriorityMarker)
    expect(SPIRITX_PROVIDER_PRIORITY_STYLE).toContain('order: -1')
    const style = document.querySelector('style[data-plugin-css="dsh-plugin-desktop/spiritx-provider-priority"]')
    expect(style?.textContent).toBe(SPIRITX_PROVIDER_PRIORITY_STYLE)
    disposers.forEach(dispose => { dispose() })
    expect(style?.isConnected).toBe(false)
  })
})
