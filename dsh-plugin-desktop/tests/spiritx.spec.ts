import { describe, expect, it } from 'vitest'
import { productProviderDirectory } from '../src/spiritx.ts'

describe('SpiritX provider directory', () => {
  it('presents only SpiritX and leaves the official catalog to llm-pi-ai', () => {
    expect(productProviderDirectory([
      {
        provider: 'openai',
        displayName: 'OpenAI',
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'openai'],
        declared: false,
      },
      {
        provider: 'spiritx',
        displayName: 'SpiritX',
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'spiritx'],
        declared: true,
      },
    ])).toEqual([expect.objectContaining({ provider: 'spiritx', declared: false })])
  })

  it('publishes no catalog entries when the product route is absent', () => {
    expect(productProviderDirectory([{
      provider: 'anthropic',
      displayName: 'Anthropic',
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'anthropic'],
      declared: false,
    }])).toEqual([])
  })
})
