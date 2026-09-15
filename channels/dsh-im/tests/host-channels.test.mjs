import assert from 'node:assert/strict'
import test from 'node:test'

import { CLAWCLAW_HOST_CHANNELS } from '../src/index.mjs'

test('activates every channel exposed by the ClawClaw overview', () => {
  assert.deepEqual(CLAWCLAW_HOST_CHANNELS, [
    'feishu', 'weixin', 'dingtalk', 'wecom', 'wecomApp', 'slack', 'telegram',
    'discord', 'imessage', 'office', 'qq', 'whatsapp',
  ])
})
