import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { channelForSession, channelFromSessionId, svgAttributeName } from '../client/session-presentation.js'
import { SESSION_CHANNEL_LABELS } from '../node_modules/@xmanrui/dsh-im/src/channels/shared/session-channel-labels.mjs'

test('maps channel Session ids to their canonical source logos', () => {
  assert.equal(channelFromSessionId('feishu-1234'), 'feishu')
  assert.equal(channelFromSessionId('weixin-steer-1234'), 'weixin')
  assert.equal(channelFromSessionId('cron-1234'), null)
})

test('uses the durable channel title for legacy generic Session ids', () => {
  assert.equal(channelForSession('session-52d26a9b', '飞书 · ClawClaw 与 workbuddy 对比分析'), 'feishu')
  assert.equal(channelForSession('session-52d26a9b', 'Ordinary conversation'), null)
})

test('maps every supported channel title in Chinese and English', () => {
  for (const [channel, labels] of Object.entries(SESSION_CHANNEL_LABELS)) {
    for (const label of labels) {
      assert.equal(channelForSession(`session-${channel}`, `${label} · Conversation`), channel)
    }
  }
})

test('preserves case-sensitive SVG viewport attributes', () => {
  assert.equal(svgAttributeName('viewBox'), 'viewBox')
  assert.equal(svgAttributeName('preserveAspectRatio'), 'preserveAspectRatio')
  assert.equal(svgAttributeName('strokeWidth'), 'stroke-width')
})

test('replaces the legacy pseudo-title effect with the rc.2 leading slot', () => {
  const entry = readFileSync(new URL('../client/index.js', import.meta.url), 'utf8')
  const presentation = readFileSync(new URL('../client/session-presentation.js', import.meta.url), 'utf8')

  assert.match(entry, /label === 'im-settings: Session channel logos'/u)
  assert.match(entry, /sidebar\.session\.row\.leading/u)
  assert.doesNotMatch(presentation, /text-overflow\s*:\s*ellipsis/u)
  assert.match(presentation, /replaceChildren/u)
  assert.match(presentation, /data-dsh-im-session-leading="weixin"[^}]+color:#07c160/u)
  assert.match(presentation, /data-dsh-session-source-icon="weixin"[^}]+color:#07c160/u)
  assert.doesNotMatch(presentation, /data-dsh-session-source-icon="weixin"[^}]+(?:padding|background)/u)
})
