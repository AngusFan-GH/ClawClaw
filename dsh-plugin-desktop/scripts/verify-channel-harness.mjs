/** Real Gateway compatibility check using only a disposable Profile and offline model. */
import assert from 'node:assert/strict'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { fileURLToPath } from 'node:url'
import { build } from '../../channels/dsh-im/node_modules/esbuild/lib/main.js'
import { channelHarnessPeerPatch } from '../../channels/dsh-im/scripts/channel-harness-peer-patch.mjs'
import { modernHarnessApi as unpatchedHarnessApi } from '../../channels/dsh-im/node_modules/@xmanrui/dsh-im/plugin-src/host/modern-harness-api.mjs'
import { HarnessClient } from '../../channels/dsh-im/node_modules/@xmanrui/dsh-im/src/channels/shared/harness-client.mjs'

export async function verifyChannelHarness(ctx) {
  assert.match(ctx.profileContext.home, /dsh-desktop-profile-/, 'IM smoke must use its disposable Profile')
  const bundled = await build({ entryPoints: [fileURLToPath(new URL('../../channels/dsh-im/node_modules/@xmanrui/dsh-im/plugin-src/host/modern-harness-api.mjs', import.meta.url))], bundle: true, format: 'esm', platform: 'node', write: false, plugins: [channelHarnessPeerPatch] })
  const { modernHarnessApi } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
  const api = modernHarnessApi(ctx)
  let calls = 0
  class Adapter extends LlmAdapter {
    resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model }) }
    async *stream() {
      calls++
      const text = 'Offline channel reply.'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const release = ctx.llm.registerAdapter(['channel-offline'], new Adapter())
  const previous = ctx.agentDefaultModel.currentSelection()
  try {
    await ctx.agentDefaultModel.saveSelection({ provider: 'channel-offline', model: 'offline' })
    for (const channel of ['feishu', 'weixin']) {
      const client = new HarnessClient({ apiProxy: api, interactionScope: ctx.root ?? ctx, rpcIdPrefix: channel, workspace: ctx.profileContext.home })
      const id = await client.createSession()
      await client.renameSession(id, `${channel} offline fixture`)
      if (channel === 'feishu') {
        const original = unpatchedHarnessApi(ctx)
        const failed = await original.sessions.history({ rpcId: 'missing-peer-regression', payload: { sessionId: id, maxMessages: 20 } }, new AbortController().signal)
        assert.equal(failed.result.ok, false, 'the original pinned adapter unexpectedly accepted a missing Peer')
        assert.match(failed.result.error.message, /signal/, 'must reproduce the reported missing-Peer failure')
        original.dispose()
      }
      const before = await client.rpc('session.history', { sessionId: id, maxMessages: 20 })
      assert.ok(Array.isArray(before.events))
      const reply = await client.ask(id, 'Reply with the offline channel fixture result.', { timeoutMs: 10_000 })
      assert.ok(JSON.stringify(reply).includes('Offline channel reply.'), `${channel}: missing offline reply`)
      const after = await client.rpc('session.history', { sessionId: id, maxMessages: 20 })
      assert.ok(after.events.some(({ event }) => event.type === 'user/message'))
      assert.ok(after.events.some(({ event }) => event.type === 'assistant/message'))
      // Exercise both the first-snapshot and subsequent-page paths, retaining the same identity.
      const listed = await client.rpc('session.list', {})
      assert.ok(listed.items.some(item => item.sessionId === id))
    }
    assert.equal(calls, 2, 'each channel prompt must execute once')
    console.log('verify-channel-harness: Feishu and Weixin history, prompt, reply, repeated history and list passed on the real Gateway')
  } finally { await ctx.agentDefaultModel.saveSelection(previous); release(); api.dispose() }
}
