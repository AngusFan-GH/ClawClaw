import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { applyGenuiState } from '../src/genui-state.ts'
import { validHtmlState } from '../src/genui-state-contract.ts'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const identity = { sessionId: 'session-a', callId: 'call-a', path: '0.1', sourceHash: 'a'.repeat(64) }
const state = { controls: [{ index: 0, value: '68.24' }, { index: 1, value: '500' }], custom: { count: 2 } }
async function boot(root: string, profile = 'profile-a') {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(root)
  ctx.storage.backend.register('json', backend)
  const facility = new DomainFacility(ctx, { backend: 'json', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const routes: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }[] = []
  ctx.provide('profileContext', { dir: profile } as never)
  ctx.provide('webServer', { port: 12345, register: (route: typeof routes[number]) => { routes.push(route); return () => {} } } as never)
  ctx.provide('connection', { requestRejection: () => undefined } as never)
  let enabled = true
  applyGenuiState(ctx, () => enabled)
  await vi.waitFor(() => expect(routes).toHaveLength(2))
  return { disable: () => { enabled = false }, close: async () => { await ctx.fiber.dispose(); await backend.close() },
    async send(action: string, patch = {}, origin = 'http://127.0.0.1:12345') {
      const req = Object.assign(Readable.from([JSON.stringify({ ...identity, action, ...patch })]), {
        method: 'POST', headers: { host: '127.0.0.1:12345', origin, 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' },
      }) as unknown as IncomingMessage
      let body = ''
      const response = { statusCode: 200, setHeader: vi.fn(), end: (value: string) => { body = value } }
      await routes.find(route => route.path.endsWith('/action'))!.handler(req, response as unknown as ServerResponse)
      return { status: response.statusCode, body: JSON.parse(body) }
    } }
}
it('durably restores through a cold Host restart, isolates identity and Profile, and clears only on Reset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'genui-state-')); roots.push(root)
  let host = await boot(root)
  try {
    expect((await host.send('save', { state })).status).toBe(200)
    expect((await host.send('save', { state }, 'null')).status).toBe(403)
    for (const patch of [{ sessionId: 'other' }, { callId: 'other' }, { path: '2' }, { sourceHash: 'b'.repeat(64) }]) {
      expect((await host.send('load', patch)).body.state).toBeNull()
    }
    expect((await host.send('save', { state: { controls: [], custom: 'x'.repeat(2001) } })).status).toBe(400)
  } finally { await host.close() }
  host = await boot(root, 'profile-b')
  try { expect((await host.send('load')).body.state).toBeNull() } finally { await host.close() }
  host = await boot(root)
  try {
    expect((await host.send('load')).body.state).toEqual(state)
    await host.send('clear')
    expect((await host.send('load')).body.state).toBeNull()
    host.disable()
    expect((await host.send('save', { state })).status).toBe(409)
  } finally { await host.close() }
})
it('rejects non-JSON, unbounded, prototype-bearing and malformed snapshots', () => {
  expect(validHtmlState(state)).toBe(true)
  for (const value of [null, { controls: [], custom: NaN }, { controls: [], custom: new Date() },
    { controls: [{ index: -1, value: 'x' }], custom: null }, { controls: [], custom: { constructor: 'x' } },
    { controls: [], custom: Array.from({ length: 100 }, () => 'x'.repeat(2000)) }]) expect(validHtmlState(value)).toBe(false)
})
