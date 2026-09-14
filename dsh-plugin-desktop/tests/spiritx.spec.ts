import { describe, expect, it } from 'vitest'
import { productProviderDirectory } from '../src/spiritx.ts'

describe('SpiritX provider directory', () => {
  it('presents SpiritX as a built-in provider', () => {
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
    ])).toEqual([
      expect.objectContaining({ provider: 'spiritx', declared: false }),
      expect.objectContaining({ provider: 'openai', declared: false }),
    ])
  })
})
