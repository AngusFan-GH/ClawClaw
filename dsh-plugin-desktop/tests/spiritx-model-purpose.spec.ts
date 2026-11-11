import { describe, expect, it } from 'vitest'
import { isSpiritXConversationModel, spiritXModelPurpose, withSpiritXModelPurpose } from '../src/client/spiritx-model-purpose.ts'

describe('SpiritX model purposes', () => {
  it.each([
    ['Qwen3Guard-Gen-4B', 'safety-classifier'],
    ['StartLux-Decision-v1.1-9B-Instant', 'decision'],
    ['gpt-image-2', 'image-generation'],
  ] as const)('recognizes %s despite generic LLM metadata and chat endpoints', (id, purpose) => {
    const model = { id, modelType: 'LLM', supportedEndpointPaths: ['/v1/responses'], supportsConversation: true }
    expect(spiritXModelPurpose(model)).toBe(purpose)
    expect(withSpiritXModelPurpose(model).supportsConversation).toBe(false)
  })

  it.each([
    ['TextToImage', 'image-generation'], ['TextToVideo', 'video-generation'],
    ['TextToSpeech', 'speech-generation'], ['ASR', 'transcription'],
    ['Embedding', 'embedding'], ['Rerank', 'rerank'], ['safety_classifier', 'safety-classifier'],
  ] as const)('uses explicit %s purpose even with a chat-compatible endpoint', (modelType, purpose) => {
    expect(spiritXModelPurpose({ id: 'future-model', modelType, supportedEndpointPaths: ['/v1/chat/completions'] })).toBe(purpose)
  })

  it('uses generation-only endpoints before coarse LLM metadata', () => {
    expect(isSpiritXConversationModel({ id: 'future-model', modelType: 'LLM', supportedEndpointPaths: ['/v1/images/generations'] })).toBe(false)
  })

  it.each(['image-understanding-v99', 'audio-understanding-v99', 'future-v99'])('preserves %s without metadata', id => {
    expect(spiritXModelPurpose({ id })).toBe('unknown')
    expect(isSpiritXConversationModel({ id })).toBe(true)
  })

  it('retains a future model with unrecognized types and endpoints', () => {
    expect(isSpiritXConversationModel({ id: 'future-v99', modelType: 'NewMultimodal', supportedEndpointPaths: ['/v2/inference'] })).toBe(true)
  })

  it('honors user purpose overrides in both directions', () => {
    expect(withSpiritXModelPurpose({ id: 'Qwen3Guard-Gen-4B', purpose: 'conversation', supportsConversation: false }).supportsConversation).toBe(true)
    expect(withSpiritXModelPurpose({ id: 'GLM-5.3', purpose: 'other', supportsConversation: true }).supportsConversation).toBe(false)
  })
})
