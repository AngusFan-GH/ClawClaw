import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { channelGateway } from '../src/harness-peer.mjs'
import { patchChannelHarnessPeer } from '../scripts/channel-harness-peer-patch.mjs'

function fixture() {
  const cleanups = [], calls = []
  const abort = new AbortController()
  const peer = { signal: abort.signal, dispose: async () => { abort.abort() } }
  let created = 0
  const root = { effect: factory => { cleanups.push(factory()) } }
  const gateway = { invoke: async request => { calls.push(request); return 'result' }, stream: async request => { calls.push(request); return 'stream' } }
  const connection = { createPeer: options => { created++; assert.deepEqual(options, { principal: { kind: 'owner' }, interactions: 'none' }); return peer } }
  const ctx = { root, typertGateway: gateway, connection }
  return { root, ctx, peer, calls, cleanups, created: () => created }
}
test('pins a Host-owned Peer on unary, stream and sibling channel calls', async () => {
  const f = fixture(), api = channelGateway(f.ctx)
  const signal = new AbortController().signal
  assert.equal(await api.invoke({ namespace: 'session', method: 'prompt', args: {}, signal, peer: 'untrusted' }), 'result')
  assert.equal(await channelGateway({ ...f.ctx }).stream({ namespace: 'session', method: 'follow', args: {}, signal }), 'stream')
  assert.equal(f.created(), 1)
  for (const call of f.calls) { assert.equal(call.peer, f.peer); assert.equal(call.signal, signal) }
  await f.cleanups[0]()
  assert.equal(f.peer.signal.aborted, true)
})
test('fails closed when the Host cannot provide a Peer', () => {
  assert.throws(() => channelGateway({ root: {}, typertGateway: {} }), /Peer/)
  assert.equal(channelGateway({}), undefined)
})
test('covers both pinned IM adapters and refuses an unmatched source', async () => {
  for (const name of ['modern-harness-api', 'harness-command-executor']) {
    const source = await readFile(new URL(`../node_modules/@xmanrui/dsh-im/plugin-src/host/${name}.mjs`, import.meta.url), 'utf8')
    assert.match(patchChannelHarnessPeer(source), /const gateway = channelGateway\(ctx\);/)
  }
  assert.throws(() => patchChannelHarnessPeer('changed adapter'), /Pinned IM/)
})
