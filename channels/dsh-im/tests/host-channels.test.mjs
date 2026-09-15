import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { CLAWCLAW_HOST_CHANNELS, resolveChannelWorkspace } from '../src/index.mjs'

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
