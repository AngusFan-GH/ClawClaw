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

  it('publishes the dormant SpiritX row before a key materializes its profile', () => {
    expect(productProviderDirectory([])).toEqual([{
      provider: 'spiritx',
      displayName: 'SpiritX',
      settingsNs: 'spiritx',
      settingsPath: ['providers', 'spiritx'],
      declared: false,
    }])
  })

  it('keeps the dormant product entry when unrelated catalog rows are present', () => {
    expect(productProviderDirectory([{
      provider: 'anthropic',
      displayName: 'Anthropic',
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'anthropic'],
      declared: false,
    }])).toEqual([expect.objectContaining({
      provider: 'spiritx', settingsNs: 'spiritx', settingsPath: ['providers', 'spiritx'], declared: false,
    })])
  })
})
