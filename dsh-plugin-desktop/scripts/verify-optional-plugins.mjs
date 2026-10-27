/** Exercise the shipped optional bundles through the real Desktop PluginManager. */
import assert from 'node:assert/strict'
import { OPTIONAL_BUNDLES } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, ToolCallId, createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'

export async function verifyOptionalInventory(ctx, enabled) {
  const bundles = await ctx.pluginManager.listBundles()
  for (const name of OPTIONAL_BUNDLES) {
    const bundle = bundles.find(item => item.name === name)
    assert.ok(bundle, `Desktop does not offer ${name}`)
    assert.equal(bundle.error, undefined, `${name}: ${JSON.stringify(bundle.error)}`)
    assert.equal(bundle.availability, 'installation', name)
    assert.equal(bundle.optional, true, name)
    assert.equal(bundle.enabled, enabled, name)
    assert.ok(bundle.meta?.title, `${name} has no display title`)
    assert.ok(bundle.rows.length > 0, `${name} has no readable patch rows`)
    if (enabled) {
      const entries = [...ctx.loader.entries()]
      for (const row of bundle.rows) {
        const entry = entries.find(item => item.options.id === row.rowId)
        assert.ok(entry, `${name}: ${row.rowId} was not composed`)
        if (!entry.disabled) assert.equal(entry.fiber?.state, 2, `${name}: ${row.rowId} did not activate`)
      }
    }
  }
  const catalog = ctx.permissionPresets.catalog()
  assert.equal(catalog.options.some(option => option.value === 'auto'), enabled,
    'the current-session permission menu must follow Auto review activation')
  assert.ok(!catalog.defaultOptions.some(option => option.value === 'auto'),
    'Auto must retain upstream current-session-only semantics')
}

export async function selectOptionalBundles(ctx, enabled) {
  for (const name of OPTIONAL_BUNDLES) {
    const change = await ctx.pluginManager.setBundleEnabled(name, enabled)
    assert.equal(change.application, 'restart-required', `${name}: ${JSON.stringify(change)}`)
    assert.equal(change.changed, true, name)
  }
}

/** Confirm the browser receives the optional Client halves alongside the permission menu. */
export async function verifyOptionalRenderer(authenticationUrl, headers, enabled) {
  const exchange = await fetch(authenticationUrl, { headers, redirect: 'manual' })
  await exchange.body?.cancel()
  assert.equal(exchange.status, 303)
  const cookie = exchange.headers.get('set-cookie')?.split(';', 1)[0]
  assert.ok(cookie)
  const response = await fetch(new URL('/', authenticationUrl), { headers: { ...headers, Cookie: cookie } })
  assert.equal(response.status, 200)
  const html = await response.text()
  const match = html.match(/(?:window\.__DSH_BOOT__|globalThis\["__DSH_BOOT__"\]) = (\{.*?\})<\/script>/u)
  assert.ok(match?.[1], 'optional plugin Web root has no client boot graph')
  const ids = new Set(JSON.parse(match[1]).entries.map(entry => entry.id))
  assert.ok(ids.has('@deepseek-ai/dsh-client-ui-permission-presets'))
  for (const id of [
    '@deepseek-ai/dsh-experimental-client-ui-agent-team',
    '@deepseek-ai/dsh-experimental-client-ui-voice-input',
    '@deepseek-ai/dsh-experimental-client-ui-cot-translation',
    '@deepseek-ai/dsh-client-ui-plugin-market',
  ]) assert.equal(ids.has(id), enabled, `${id} must follow its bundle switch`)
}

/** Exercise the permission owner and real review gate using only an offline model. */
export async function verifyAutoSelection(ctx, home) {
  let reviews = 0
  let executions = 0
  class Reviewer extends LlmAdapter {
    resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model }) }
    async *stream(options) {
      assert.match(options.system, /REVIEW_POLICY/)
      reviews++
      const text = '{"risk":"low","decision":"allow"}'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const releaseAdapter = ctx.llm.registerAdapter(['optional-review-offline'], new Reviewer())
  const name = 'optional_review_probe'
  const releaseTool = ctx.tools.register(defineContentToolFixture({
    name, description: 'Return an in-memory verification result.', parameters: {},
    async execute() { executions++; return [{ type: 'text', text: 'reviewed' }] },
  }))
  const created = await ctx.agents.create({
    sessionId: SessionId('optional-auto-permission-smoke'),
    meta: { cwd: home, agentPreset: 'minimal' },
    agentOptions: { provider: 'optional-review-offline', model: 'offline' },
    setup: async scope => { await ctx.agentPresets.mount(scope, 'minimal') },
  })
  try {
    ctx.permissionPresets.set(created.agent.session, 'auto')
    assert.equal(ctx.permissionPresets.current(created.agent.session), 'auto')
    ctx.permissionPresets.set(created.agent.session, 'workspace-write')
    assert.equal(ctx.permissionPresets.current(created.agent.session), 'workspace-write')
    ctx.permissionPresets.set(created.agent.session, 'auto')
    assert.equal(ctx.permissionPresets.current(created.agent.session), 'auto')
    const session = created.agent.session
    session.append('request/header', { header: {
      config: { provider: 'optional-review-offline', model: 'offline' },
      tools: [{ name, description: 'Return an in-memory verification result.', parameters: { type: 'object', properties: {} } }],
    }, reason: session.requestHeader() === undefined ? 'initial' : 'change' })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Run the in-memory verification.' }],
      source: { kind: 'human' } }), { surfaceOp: 'append' })
    const callId = ToolCallId('optional-auto-call')
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', { turn: 1, step: 1, stream: [], message: createMessage({
      role: 'assistant', source: { kind: 'model', provider: 'optional-review-offline', model: 'offline' },
      content: [{ type: 'tool-call', id: callId, name, arguments: '{}' }],
    }) }, { surfaceOp: 'append' })
    session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: '{}' })
    const result = await ctx.tools.execute({ name, arguments: {}, callId, agent: created.agent, signal: AbortSignal.timeout(10_000) })
    assert.equal(result.isError, false, JSON.stringify(result))
    assert.equal(reviews, 1, 'Auto never invoked the reviewer')
    assert.equal(executions, 1, 'the allowed tool did not execute exactly once')
    await ctx.sessions.flush(created.agent.session)
  } finally {
    await created.dispose()
    releaseTool()
    releaseAdapter()
  }
}
