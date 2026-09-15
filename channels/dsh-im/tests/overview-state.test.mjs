import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLAWCLAW_CHANNELS,
  channelOverviewState,
  channelStatusLabel,
  combineChannelOverviewStates,
} from '../client/overview-state.js'

test('keeps the ClawClaw channel order', () => {
  assert.deepEqual(CLAWCLAW_CHANNELS.map(channel => channel.id), [
    'weixin', 'wecom', 'feishu', 'dingtalk', 'qq', 'imessage', 'telegram',
    'whatsapp', 'discord', 'slack',
  ])
})

test('summarizes singleton connector status', () => {
  assert.deepEqual(channelOverviewState({ ok: true, value: {
    configured: true, connected: false, state: 'reconnecting',
  } }), { state: 'connecting', configured: 1, connected: 0 })
})

test('summarizes dsh-im status envelopes without exposing bot details', () => {
  const status = channelOverviewState({ ok: true, value: { bots: [
    { botId: 'one', connected: true },
    { botId: 'two', connected: false, state: 'offline' },
  ] } })
  assert.deepEqual(status, { state: 'connected', configured: 2, connected: 1 })
  assert.equal(channelStatusLabel(status), '1/2 个机器人已连接')
})

test('distinguishes unconfigured and unavailable states', () => {
  assert.deepEqual(channelOverviewState({ ok: true, value: { snapshot: { bots: [] } } }), {
    state: 'unconfigured', configured: 0, connected: 0,
  })
  assert.equal(channelOverviewState(undefined).state, 'error')
})

test('ships QQ and WhatsApp as available channels', () => {
  for (const id of ['qq', 'whatsapp']) {
    const channel = CLAWCLAW_CHANNELS.find(candidate => candidate.id === id)
    assert.equal(channel.unavailable, undefined)
    assert.equal(typeof channel.rpc, 'string')
  }
})

test('combines enterprise WeChat bot and app status', () => {
  assert.deepEqual(combineChannelOverviewStates([
    { state: 'connected', configured: 1, connected: 1 },
    { state: 'offline', configured: 2, connected: 0 },
  ]), { state: 'connected', configured: 3, connected: 1 })
  assert.deepEqual(combineChannelOverviewStates([
    { state: 'error', configured: 0, connected: 0 },
    { state: 'unconfigured', configured: 0, connected: 0 },
  ]), { state: 'unconfigured', configured: 0, connected: 0 })
})
