import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { CLAWCLAW_HOST_CHANNELS, resolveChannelWorkspace, createImHostPlugin } from '../src/index.mjs'

test('activates every channel exposed by the ClawClaw overview', () => {
  assert.deepEqual(CLAWCLAW_HOST_CHANNELS, [
    'feishu', 'weixin', 'dingtalk', 'wecom', 'wecomApp', 'slack', 'telegram',
    'discord', 'imessage', 'office', 'qq', 'whatsapp',
  ])
})

test('passes one stable product default Workspace to every channel', async () => {
  const previous = process.env.CLAWCLAW_DEFAULT_WORKSPACE
  process.env.CLAWCLAW_DEFAULT_WORKSPACE = join(tmpdir(), 'clawclaw-default')
  try {
    assert.equal(resolveChannelWorkspace({}, 'feishu'), resolve(process.env.CLAWCLAW_DEFAULT_WORKSPACE))
    assert.equal(resolveChannelWorkspace({
      defaultWorkspace: join(tmpdir(), 'configured-default'),
      feishu: { workspace: join(tmpdir(), 'account-workspace') },
    }, 'feishu'), resolve(tmpdir(), 'account-workspace'))
  } finally {
    if (previous === undefined) delete process.env.CLAWCLAW_DEFAULT_WORKSPACE
    else process.env.CLAWCLAW_DEFAULT_WORKSPACE = previous
  }
})


test('channel tool installation never returns a boolean as a Cordis effect', async () => {
  let registered = 0, activated = 0
  const ctx = {
    typertGateway: { stream() {} },
    sessions: { get() {}, list: () => [] },
    tools: { register() { registered++; return () => {} } },
    systemPrompt: { section() { return () => {} } },
    effect() {}, on: () => () => {},
    inject(_services, install) {
      const result = install(ctx)
      const validate = value => {
        if (value !== undefined && typeof value !== 'function') throw new TypeError('Invalid effect')
      }
      return result?.then ? result.then(validate) : validate(result)
    },
  }
  const plugin = createImHostPlugin({
    channels: [['fixture', async () => { activated++ }]],
    installHostLanguage: () => ({ ready: Promise.resolve() }),
    installSessionSyncCoordinator() {},
    installDeliveryHttp() {},
  })
  await plugin.apply(ctx)
  assert.equal(registered, 1)
  assert.equal(activated, 1)
})
