import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { registerDesktopJsonApi } from '../src/desktop-json-api.ts'

describe('same-origin Desktop streaming actions', () => {
  it('flushes progress before completion, rejects cross-origin access and aborts on disconnect', async () => {
    const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>>()
    const server = createServer((req, res) => { void routes.get(req.url!)!(req, res) })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }, origin = `http://127.0.0.1:${address.port}`
    let release!: () => void, cancelled = false
    const streamAction = vi.fn(async (_value, emit: (value: object) => void, signal: AbortSignal) => {
      emit({ type: 'progress', delta: 'visible before completion' })
      await new Promise<void>(resolve => {
        release = resolve
        signal.addEventListener('abort', () => { cancelled = true; resolve() }, { once: true })
      })
      return { done: true }
    })
    registerDesktopJsonApi({ connection: { requestRejection: () => undefined }, effect: (setup: () => void) => setup(),
      webServer: { port: address.port, register: (route: { path: string; handler: typeof routes extends Map<string, infer V> ? V : never }) => { routes.set(route.path, route.handler) } },
    } as unknown as Context, { label: 'Stream test', readPath: '/read', actionPath: '/action', read: async () => ({}), action: async () => ({}), streamAction })
    const headers = { origin, 'content-type': 'application/json', accept: 'application/x-ndjson' }
    try {
      const forbidden = await fetch(origin + '/action', { method: 'POST', headers: { ...headers, origin: 'https://example.com' }, body: '{}' })
      expect(forbidden.status).toBe(403); expect(streamAction).not.toHaveBeenCalled()
      const first = await fetch(origin + '/action', { method: 'POST', headers, body: '{}' })
      const reader = first.body!.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('visible before completion')
      release()
      let tail = ''
      while (true) { const chunk = await reader.read(); if (chunk.done) break; tail += new TextDecoder().decode(chunk.value) }
      expect(tail).toContain('"type":"result"'); expect(cancelled).toBe(false)
      reader.releaseLock()
      const abort = new AbortController()
      const second = await fetch(origin + '/action', { method: 'POST', headers, body: '{}', signal: abort.signal })
      const pending = second.body!.getReader()
      await pending.read(); abort.abort()
      await vi.waitFor(() => expect(cancelled).toBe(true))
    } finally {
      release?.(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
