import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { build } from 'esbuild'
import { channelBrandCopyPatch, patchChannelBrandCopy } from '../scripts/channel-brand-copy-patch.mjs'

async function bundled(contents) {
  const result = await build({
    stdin: { contents, resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
    bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['react'], plugins: [channelBrandCopyPatch],
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  return module.exports
}

test('Host product messages use ClawClaw in both languages and preserve interpolated names', async () => {
  const api = await bundled(`
    export { t, setImHostLanguage } from './node_modules/@xmanrui/dsh-im/src/channels/shared/i18n.mjs';
    export { connectionTestMessage } from './node_modules/@xmanrui/dsh-im/src/channels/shared/connection-test.mjs';
    export const passThrough = value => value;
    export const ownSource = 'DeepSeek Harness';
  `)
  const userText = '用户消息 / model reply: DeepSeek Harness，已连接 DeepSeek Harness，正在思考…'
  for (const language of ['zh', 'en']) {
    api.setImHostLanguage(language)
    for (const copy of [
      '微信已连接 ClawClaw。',
      '钉钉机器人已连接 ClawClaw。',
      'QQ 机器人与 ClawClaw 连接正常。',
      '已连接 ClawClaw，正在思考…',
      'ClawClaw 需要你的审批：',
      'ClawClaw 暂时无法完成请求，请稍后重试。',
    ]) {
      const translated = api.t(copy)
      assert.match(translated, /ClawClaw/)
      if (language === 'en') assert.doesNotMatch(translated, /\p{Script=Han}/u)
    }
    const message = api.connectionTestMessage('DeepSeek Harness 用户自定义名称')
    assert.match(message.split('\n')[0], /ClawClaw/)
    assert.match(message, /DeepSeek Harness 用户自定义名称/)
    assert.equal(api.t('工具：{tool}', { tool: userText }).includes(userText), true)
    assert.equal(api.passThrough(userText), userText)
  }
  // The patch must never rewrite modules outside the pinned dependency.
  assert.equal(api.ownSource, 'DeepSeek Harness')
})

test('Client dictionaries and dynamic removal prompts stay bilingual without changing bot names', async () => {
  const api = await bundled(`
    export { en, zh, localizeText, setImTranslator } from './node_modules/@xmanrui/dsh-im/plugin-src/client/i18n.js';
  `)
  for (const language of ['zh', 'en']) {
    const dictionary = api[language]
    api.setImTranslator(key => dictionary[key] ?? key)
    const prompt = api.localizeText('从 ClawClaw 移除“DeepSeek Harness 自定义机器人”？')
    assert.match(prompt, /ClawClaw/)
    assert.match(prompt, /DeepSeek Harness 自定义机器人/)
    if (language === 'en') assert.match(prompt, /^Remove/)
    const label = api.localizeText('通过扫码把钉钉机器人接入 ClawClaw')
    assert.match(label, /ClawClaw/)
    if (language === 'en') assert.doesNotMatch(label, /\p{Script=Han}/u)
  }
})

test('static templates change product copy while preserving runtime expressions and protocol IDs', () => {
  const source = 'export const render = (user, model) => `已连接 DeepSeek Harness，正在思考… ${user} ${model}`; export const source = "deepseek-harness";'
  const patched = patchChannelBrandCopy(source)
  const api = new Function(patched.replaceAll('export const ', 'const ') + '; return { render, source };')()
  assert.equal(api.render('DeepSeek Harness 用户', 'DeepSeek Harness 回复'),
    '已连接 ClawClaw，正在思考… DeepSeek Harness 用户 DeepSeek Harness 回复')
  assert.equal(api.source, 'deepseek-harness')
})

test('Feishu sends a branded placeholder and preserves streamed model text verbatim', async () => {
  const { VerifiedFeishuChannel } = await bundled(`
    export { VerifiedFeishuChannel } from './node_modules/@xmanrui/dsh-im/src/channels/feishu/feishu-channel.mjs';
  `)
  const created = [], updates = []
  const client = {
    cardkit: { v1: {
      card: {
        create: async request => { created.push(JSON.parse(request.data.data)); return { data: { card_id: 'card' } } },
        settings: async () => ({}),
      },
      cardElement: { content: async request => { updates.push(request.data.content); return {} } },
    } },
    im: { v1: { message: { create: async () => ({ data: { message_id: 'message' } }) } } },
  }
  const reply = 'DeepSeek Harness：模型回复中的品牌原文。'
  await new VerifiedFeishuChannel({ client }).stream('chat', {
    markdown: async controller => { await controller.setContent(reply) },
  })
  assert.match(JSON.stringify(created), /已连接 ClawClaw，正在思考…/)
  assert.deepEqual(updates, [reply])
})

test('shipped Host and Client bundles contain no old product copy', async () => {
  for (const file of ['index.js', 'client.js']) {
    const bundle = await readFile(new URL(`../lib/${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(bundle, /DeepSeek Harness/)
    assert.match(bundle, /ClawClaw/)
    assert.match(bundle, /deepseek-harness/)
  }
})
