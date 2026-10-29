// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { htmlStateStorage } from '../src/client/genui-html-state.ts'
const id = { sessionId: 'session', callId: 'call', path: '0' }
const state = { controls: [{ index: 0, value: '42' }], custom: null }
afterEach(() => vi.unstubAllGlobals())
it('serializes saves across remounted views so reopen cannot read before the preceding write', async () => {
  vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array(32).buffer } })
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const actions: string[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); actions.push(body.action)
    if (body.action === 'save') await blocked
    expect(body.sourceHash).toHaveLength(64)
    return { ok: true, json: async () => ({ state }) }
  })
  const first = htmlStateStorage(id, '<input>')
  const write = first.save(state)
  await vi.waitFor(() => expect(actions).toEqual(['save']))
  const read = htmlStateStorage(id, '<input>').load()
  await Promise.resolve()
  expect(actions).toEqual(['save'])
  release(); await write
  expect(await read).toEqual(state)
  expect(actions).toEqual(['save', 'load'])
})
it('surfaces save failures and still permits retrying or clearing the same snapshot', async () => {
  vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array(32).buffer } })
  const fetch = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true, json: async () => ({}) })
  vi.stubGlobal('fetch', fetch)
  const storage = htmlStateStorage(id, '<input>')
  await expect(storage.save(state)).rejects.toThrow('persist')
  await expect(storage.clear()).resolves.toBeUndefined()
  expect(JSON.parse(fetch.mock.calls[1]![1].body).action).toBe('clear')
})
