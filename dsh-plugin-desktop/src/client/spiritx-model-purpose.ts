/** Purpose is independent of reasoning capability and protocol availability. */
export const SPIRITX_MODEL_PURPOSES = [
  'conversation', 'decision', 'image-generation', 'video-generation', 'speech-generation',
  'transcription', 'embedding', 'rerank', 'safety-classifier', 'other',
] as const
export type SpiritXModelPurpose = typeof SPIRITX_MODEL_PURPOSES[number]
export interface SpiritXModelPurposeInput {
  id: string
  purpose?: SpiritXModelPurpose
  modelType?: string
  supportedEndpointPaths?: string[]
  supportsConversation?: boolean
}

const TYPE_PURPOSE: Record<string, SpiritXModelPurpose> = {
  llm: 'conversation', vlm: 'conversation', mllm: 'conversation',
  reasoning: 'conversation', hybrid: 'conversation', reasoningonly: 'conversation',
  decision: 'decision', texttoimage: 'image-generation', imagegeneration: 'image-generation',
  texttovideo: 'video-generation', imagetovideo: 'video-generation', videogeneration: 'video-generation',
  tts: 'speech-generation', texttospeech: 'speech-generation', speechsynthesis: 'speech-generation',
  asr: 'transcription', speechtotext: 'transcription', transcription: 'transcription',
  embedding: 'embedding', embeddings: 'embedding', rerank: 'rerank', reranker: 'rerank',
  moderation: 'safety-classifier', safetyclassifier: 'safety-classifier', classifier: 'safety-classifier',
}
const ENDPOINT_PURPOSE: Record<string, SpiritXModelPurpose> = {
  '/v1/images/generations': 'image-generation', '/v1/images/edits': 'image-generation',
  '/v1/videos': 'video-generation', '/v1/audio/speech': 'speech-generation',
  '/v1/audio/transcriptions': 'transcription', '/v1/audio/translations': 'transcription',
  '/v1/embeddings': 'embedding', '/v1/rerank': 'rerank', '/v1/moderations': 'safety-classifier',
}
const CONVERSATION_ENDPOINTS = new Set(['/v1/chat/completions', '/v1/messages', '/v1/responses'])

export function spiritXModelPurpose(model: SpiritXModelPurposeInput): SpiritXModelPurpose | 'unknown' {
  if (model.purpose !== undefined) return model.purpose
  const id = model.id.trim().toLowerCase()
  if (id === 'qwen3guard-gen-4b') return 'safety-classifier'
  if (id === 'startlux-decision-v1.1-9b-instant') return 'decision'
  if (/^gpt-image(?:[-_.]|$)/.test(id)) return 'image-generation'
  const type = model.modelType?.toLowerCase().replace(/[^a-z0-9]/g, '')
  const typedPurpose = type !== undefined && Object.hasOwn(TYPE_PURPOSE, type) ? TYPE_PURPOSE[type] : undefined
  if (typedPurpose !== undefined && typedPurpose !== 'conversation') return typedPurpose
  const endpoints = model.supportedEndpointPaths ?? []
  if (endpoints.some(endpoint => CONVERSATION_ENDPOINTS.has(endpoint))) return 'conversation'
  for (const endpoint of endpoints) {
    if (Object.hasOwn(ENDPOINT_PURPOSE, endpoint)) return ENDPOINT_PURPOSE[endpoint]!
  }
  if (typedPurpose === 'conversation') return typedPurpose
  if (model.supportsConversation === false) return 'other'
  if (model.supportsConversation === true) return 'conversation'
  // Restrict name fallback to task-specific IDs, preserving image/audio understanding models.
  if (/(?:^|[-_.])text-to-image(?:[-_.]|$)/.test(id)) return 'image-generation'
  if (/(?:^|[-_.])(?:embedding|embed)(?:[-_.\d]|$)/.test(id)) return 'embedding'
  if (/(?:^|[-_.])rerank(?:er)?(?:[-_.\d]|$)/.test(id)) return 'rerank'
  if (/(?:^|[-_.])moderation(?:[-_.\d]|$)/.test(id)) return 'safety-classifier'
  if (/(?:^|[-_.])(?:tts|text-to-speech)(?:[-_.\d]|$)/.test(id)) return 'speech-generation'
  if (/(?:^|[-_.])(?:whisper|transcription|transcribe)(?:[-_.\d]|$)/.test(id)) return 'transcription'
  return 'unknown'
}

export function isSpiritXConversationModel(model: SpiritXModelPurposeInput): boolean {
  const purpose = spiritXModelPurpose(model)
  return purpose === 'conversation' || purpose === 'unknown'
}

export function withSpiritXModelPurpose<T extends SpiritXModelPurposeInput>(model: T): T {
  if (spiritXModelPurpose(model) === 'unknown') return model
  return { ...model, supportsConversation: isSpiritXConversationModel(model) }
}
