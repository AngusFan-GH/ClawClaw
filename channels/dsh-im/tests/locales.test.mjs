import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { channelTranslator, en, zh } from '../client/locales.js'
import { CLAWCLAW_CHANNELS, channelStatusLabel } from '../client/overview-state.js'
import { en as upstreamEn, zh as upstreamZh, localizeText, setImTranslator } from '../node_modules/@xmanrui/dsh-im/plugin-src/client/i18n.js'

test('covers overview, detail and accessible channel labels in both languages', () => {
  assert.deepEqual(Object.keys(zh), Object.keys(en))
  for (const channel of CLAWCLAW_CHANNELS) {
    for (const copy of [channel.label, channel.description]) {
      if (/\p{Script=Han}/u.test(copy)) assert.ok(en[copy] ?? upstreamEn[copy], copy)
    }
  }
  for (const key of ['消息渠道', '返回', '企业微信接入方式', '智能机器人', '自建应用', '使用系统选择器']) {
    assert.equal(zh[key], key)
    assert.doesNotMatch(en[key], /\p{Script=Han}/u)
  }
})

test('all Chinese literals in pinned detail pages have exact English translations', async () => {
  const root = new URL('../node_modules/@xmanrui/dsh-im/plugin-src/client/', import.meta.url)
  const dictionary = { ...upstreamEn, ...en }
  const missing = new Set()
  for (const file of await readdir(root, { recursive: true })) {
    if (!file.endsWith('.js') || /(?:i18n|styles)\.js$/.test(file)) continue
    const source = await readFile(new URL(file, root), 'utf8')
    for (const match of source.matchAll(/['"]((?:[^'"\\\n]|\\.)*)['"]/g)) {
      if (/\p{Script=Han}/u.test(match[1]) && !(match[1] in dictionary)) missing.add(match[1])
    }
  }
  assert.deepEqual([...missing], [])
})

test('channel detail diagnostics and labels follow live language switches', () => {
  let language = 'en'
  const dictionaries = { en: { ...upstreamEn, ...en }, zh: { ...upstreamZh, ...zh } }
  setImTranslator(channelTranslator(key => dictionaries[language][key] ?? key, localizeText))
  try {
    assert.equal(localizeText('消息渠道'), 'Message channels')
    assert.equal(localizeText('无法读取企业微信机器人状态'), 'Could not load WeCom bot status')
    assert.equal(localizeText('状态刷新失败：企业微信操作失败'), 'Status refresh failed: WeCom operation failed')
    assert.equal(localizeText('连接检查失败：钉钉连接尚未就绪（参考号：abc-123）'), 'Connection check failed: DingTalk connection is not ready (reference: abc-123)')
    for (const copy of ['Telegram Bot API 长轮询运行正常', 'Discord Gateway 长连接运行正常', 'Slack Socket Mode 长连接运行正常']) {
      assert.doesNotMatch(localizeText(copy), /\p{Script=Han}/u)
    }
    language = 'zh'
    assert.equal(localizeText('消息渠道'), '消息渠道')
    assert.equal(localizeText('无法读取企业微信机器人状态'), '无法读取企业微信机器人状态')
  } finally { setImTranslator(undefined) }
})

test('all channel states and bot counts have English labels', () => {
  assert.equal(channelStatusLabel(undefined, 'en'), 'Loading status')
  assert.equal(channelStatusLabel({ state: 'connected', connected: 1, configured: 1 }, 'en'), '1 bot connected')
  assert.equal(channelStatusLabel({ state: 'connected', connected: 1, configured: 2 }, 'en'), '1/2 bots connected')
  for (const state of ['connected', 'connecting', 'offline', 'error', 'unavailable', 'unconfigured']) {
    assert.doesNotMatch(channelStatusLabel({ state, connected: 2, configured: 2 }, 'en'), /\p{Script=Han}/u)
  }
})
