import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { channelFromSessionId } from '../client/session-presentation.js'

test('maps channel Session ids to their canonical source logos', () => {
  assert.equal(channelFromSessionId('feishu-1234'), 'feishu')
  assert.equal(channelFromSessionId('weixin-steer-1234'), 'weixin')
  assert.equal(channelFromSessionId('cron-1234'), null)
})

test('replaces the legacy pseudo-title effect with the rc.2 leading slot', () => {
  const entry = readFileSync(new URL('../client/index.js', import.meta.url), 'utf8')
  const presentation = readFileSync(new URL('../client/session-presentation.js', import.meta.url), 'utf8')

  assert.match(entry, /label === 'im-settings: Session channel logos'/u)
  assert.match(entry, /sidebar\.session\.row\.leading/u)
  assert.doesNotMatch(presentation, /text-overflow\s*:\s*ellipsis/u)
  assert.match(presentation, /replaceChildren/u)
})
