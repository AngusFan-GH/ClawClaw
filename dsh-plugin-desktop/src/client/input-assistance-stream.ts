import type { DraftAssistProgress, DraftAssistRequest, DraftAssistResult } from '../input-assistance-contract.ts'

/** Bounded NDJSON decoding; chunk boundaries may split UTF-8, escapes and records. */
export async function readAssistanceStream(response: Response, request: DraftAssistRequest, signal: AbortSignal,
  progress?: (event: DraftAssistProgress) => void): Promise<DraftAssistResult> {
  if (!response.ok) throw new Error('Draft assistance unavailable')
  if (!response.headers?.get('content-type')?.startsWith('application/x-ndjson')) return await response.json() as DraftAssistResult
  if (response.body === null) throw new Error('Missing assistance stream')
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let pending = '', size = 0, reasoning = 0, text = 0
  let result: DraftAssistResult | undefined
  const parse = (line: string): void => {
    if (line.trim() === '') return
    if (result !== undefined) throw new Error('Unexpected event after result')
    const event = JSON.parse(line) as Record<string, unknown>
    if (event === null || typeof event !== 'object') throw new Error('Invalid assistance event')
    if (event.type === 'error') throw new Error('Draft assistance failed')
    if (event.type === 'result') {
      const value = event.result as DraftAssistResult | undefined
      if (value?.requestId !== request.requestId || value.draftRev !== request.draftRev || typeof value.text !== 'string'
        || value.text.length > 8000 || !Array.isArray(value.notes)) throw new Error('Invalid assistance result')
      result = value; return
    }
    if (event.type !== 'progress' || event.requestId !== request.requestId || event.draftRev !== request.draftRev
      || (event.channel !== 'reasoning' && event.channel !== 'text') || typeof event.delta !== 'string' || event.delta.length > 16_000) throw new Error('Invalid assistance progress')
    if (event.channel === 'reasoning') reasoning += event.delta.length
    else text += event.delta.length
    if (reasoning > 16_000 || text > 8000) throw new Error('Assistance progress exceeded limit')
    progress?.({ requestId: request.requestId, draftRev: request.draftRev, channel: event.channel, delta: event.delta })
  }
  const abort = (): void => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      signal.throwIfAborted()
      if (chunk.done) { pending += decoder.decode(); break }
      size += chunk.value.byteLength
      if (size > 8 * 1024 * 1024) throw new Error('Assistance stream exceeded limit')
      pending += decoder.decode(chunk.value, { stream: true })
      let end: number
      while ((end = pending.indexOf('\n')) !== -1) { parse(pending.slice(0, end)); pending = pending.slice(end + 1) }
      if (pending.length > 64_000) throw new Error('Assistance record exceeded limit')
    }
    if (pending !== '') parse(pending)
    if (result === undefined) throw new Error('Incomplete assistance stream')
    return result
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
