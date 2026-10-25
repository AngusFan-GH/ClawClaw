import { describe, expect, it, vi } from 'vitest'
import { readAssistanceStream } from '../src/client/input-assistance-stream.ts'
import type { DraftAssistRequest } from '../src/input-assistance-contract.ts'
const request: DraftAssistRequest = { requestId: 'stream', draftRev: 1, sessionId: 'a', kind: 'optimization', draft: '原文' }
const event = (value: object) => JSON.stringify(value) + '\n'
function response(text: string) {
  const bytes = new TextEncoder().encode(text)
  return new Response(new ReadableStream({ start(controller) {
    // Deliberately split every multibyte Chinese character and every JSON record.
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
    controller.close()
  } }), { headers: { 'content-type': 'application/x-ndjson' } })
}
describe('draft assistance streaming transport', () => {
  it('decodes split UTF-8 progress and returns only a matching final result', async () => {
    const progress = vi.fn(), result = { requestId: 'stream', draftRev: 1, text: '优化后的草稿', notes: [] }
    const wire = event({ type: 'progress', requestId: 'stream', draftRev: 1, channel: 'reasoning', delta: '整理语句。' })
      + event({ type: 'progress', requestId: 'stream', draftRev: 1, channel: 'text', delta: '优化后' }) + event({ type: 'result', result })
    expect(await readAssistanceStream(response(wire), request, new AbortController().signal, progress)).toEqual(result)
    expect(progress.mock.calls.map(([value]) => value.delta)).toEqual(['整理语句。', '优化后'])
  })
  it.each([
    event({ type: 'progress', requestId: 'old', draftRev: 1, channel: 'text', delta: 'stale' }),
    event({ type: 'error' }),
    event({ type: 'progress', requestId: 'stream', draftRev: 1, channel: 'text', delta: 'incomplete' }),
    event({ type: 'progress', requestId: 'stream', draftRev: 1, channel: 'text', delta: 'x'.repeat(8001) }),
  ])('rejects stale, failed, incomplete and oversized streams', async wire => {
    await expect(readAssistanceStream(response(wire), request, new AbortController().signal)).rejects.toThrow()
  })
  it('cancels a blocked stream read immediately when the request is aborted', async () => {
    const cancelled = vi.fn(), abort = new AbortController()
    const stream = new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'content-type': 'application/x-ndjson' } })
    const result = readAssistanceStream(stream, request, abort.signal)
    abort.abort()
    await expect(result).rejects.toThrow(); expect(cancelled).toHaveBeenCalledOnce()
  })
})
