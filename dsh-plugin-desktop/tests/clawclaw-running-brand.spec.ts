// @vitest-environment jsdom
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyClawClawBrand } from '../src/client/clawclaw-brand.tsx'

const disposers: Array<() => void> = []
function mount() {
  applyClawClawBrand({
    slots: { inject: vi.fn() },
    effect: (fn: () => () => void) => disposers.push(fn()),
  } as unknown as ClientContext)
}
async function flush() { await new Promise(resolve => setTimeout(resolve, 0)) }
afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose())
  document.body.replaceChildren()
  document.head.replaceChildren()
})

/** Upstream ChatFlow nests the status under data-chat-flow, beside message seats. */
function statusMarkup(label: string, accessible: string) {
  return `<div data-chat-flow><div data-slot="conversation.chat.flow"><div data-chat-running>
    <span role="status" aria-live="polite" aria-atomic="true">${accessible}</span>
    <span aria-hidden="true"></span><span><span aria-hidden="true"><span></span><svg></svg></span>
      <span data-shimmer><span><span id="label">${label}</span></span>
        <span aria-hidden="true" inert=""><span><span><span id="shimmer" data-shimmer-text="${label}"></span></span></span></span>
      </span></span>
  </div></div></div>`
}

describe('ClawClaw running presentation', () => {
  it.each([
    ['深度求索中，用时 2秒 ···', '深度求索中', '正在处理，用时 2秒 ···', '正在处理', '深度求索中，用时 1小时2分3秒 ···', '正在处理，用时 1小时2分3秒 ···'],
    ['Deep diving for 2s ···', 'Deep diving', 'Working for 2s ···', 'Working', 'Deep diving for 1h 2m 3s ···', 'Working for 1h 2m 3s ···'],
  ])('adapts initial, timed and accessible labels (%s)', async (label, accessible, expected, expectedAccessible, next, expectedNext) => {
    document.body.innerHTML = statusMarkup(label, accessible)
    mount()
    expect(document.getElementById('label')?.textContent).toBe(expected)
    expect(document.getElementById('shimmer')?.getAttribute('data-shimmer-text')).toBe(expected)
    const status = document.querySelector('[role="status"]')!
    expect(status.textContent).toBe(expectedAccessible)
    expect(status.getAttribute('aria-live')).toBe('polite')
    const text = document.getElementById('label')!.firstChild!
    text.nodeValue = next
    document.getElementById('shimmer')!.setAttribute('data-shimmer-text', next)
    await flush()
    expect(text.nodeValue).toBe(expectedNext)
    expect(document.getElementById('shimmer')?.getAttribute('data-shimmer-text')).toBe(expectedNext)
    expect(document.getElementById('label')!.firstChild).toBe(text)
    expect(status.textContent).toBe(expectedAccessible)
  })

  it('keeps the session title branded after upstream title updates', async () => {
    mount()
    document.title = 'My session — DeepSeek Harness'
    await flush()
    expect(document.title).toBe('My session — ClawClaw')
  })

  it('handles late mounting, locale changes and teardown', async () => {
    mount()
    document.body.innerHTML = statusMarkup('深度求索中', '深度求索中')
    await flush()
    expect(document.getElementById('label')?.textContent).toBe('正在处理')
    expect(document.getElementById('shimmer')?.getAttribute('data-shimmer-text')).toBe('正在处理')
    document.getElementById('label')!.firstChild!.nodeValue = 'Deep diving for 1m 2s ···'
    document.querySelector('[role="status"]')!.firstChild!.nodeValue = 'Deep diving'
    await flush()
    expect(document.getElementById('label')?.textContent).toBe('Working for 1m 2s ···')
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Working')
    const style = document.head.querySelector('style')!
    expect(style.textContent).toContain('[data-chat-running]')
    expect(style.textContent).toContain('center / contain no-repeat')
    disposers.splice(0).forEach(dispose => dispose())
    expect(style.isConnected).toBe(false)
    document.getElementById('label')!.textContent = 'Deep diving'
    await flush()
    expect(document.getElementById('label')?.textContent).toBe('Deep diving')
  })

  it('preserves messages, tool output, code, editable text and user session titles', async () => {
    mount()
    document.body.innerHTML = `<div data-slot="conversation.content"><div data-chat-flow>
      <div data-chat-flow-kind="user">DSH</div>
      <div data-chat-flow-kind="assistant">DeepSeek Harness</div>
      <div data-chat-flow-kind="tool">深度求索中</div>
    </div></div><div data-slot="settings.section"><code>DeepSeek Harness</code><pre>DSH</pre>
      <textarea>探索未至之境</textarea><div contenteditable="true">DeepSeek Harness</div></div>
      <div data-slot="sidebar.session">DeepSeek Harness</div>`
    const content = document.body.textContent
    await flush()
    expect(document.body.textContent).toBe(content)
  })

  it.each([
    ["DeepSeek Harness 0.2 is still in preview, and many areas need continued improvement and refinement. We welcome feedback and suggestions from all developers and users. The new desktop app now targets a broad range of users, while developer-related advanced features can be enabled in the settings. DeepSeek Harness’s product features and plugin APIs are expected to continue rapid iteration and evolution, and will gradually stabilize over time.\n\nWe look forward to exploring the limits of intelligence together with users and developers around the world, building on open-source, reusable, and composable infrastructure. We welcome everyone to bring their ideas to life with DeepSeek Harness and participate in the community to enrich the plugin ecosystem.", "ClawClaw brings"],
    ["DeepSeek Harness 目前的 0.2 版本仍处于预览阶段，还有许多地方需要持续改进和打磨，希望听取广大开发者和用户的反馈建议。现在，新的桌面端面向广泛用户，开发者相关的进阶功能可在配置中开启使用。预计 DeepSeek Harness 的产品功能以及插件 API 都会继续快速迭代、持续演化，并逐渐趋于稳定。\n\n我们期待与全球用户和开发者一起，在开源、可复用、可组合的基础设施之上，共同探索智能上限。欢迎大家用 DeepSeek Harness 将想法变成现实，与社区一起丰富插件生态。", "ClawClaw \u5c06\u5bf9\u8bdd"],
  ])('brands the welcome notice as separate paragraphs', (body, expectedStart) => {
    const overlay = document.createElement('div')
    overlay.dataset.slot = 'shell.overlay'
    for (const paragraph of body.split('\n\n')) {
      const p = document.createElement('p')
      p.textContent = paragraph
      overlay.append(p)
    }
    document.body.append(overlay)
    mount()
    expect(overlay.textContent).not.toContain('DeepSeek Harness')
    expect(overlay.firstChild?.textContent).toMatch(new RegExp(`^${expectedStart}`))
    expect(overlay.children).toHaveLength(2)
  })

  it('brands real hero structure and account copy while preserving provider names', () => {
    document.body.innerHTML = `<div data-conversation-region="composer"><div><span><span data-slot="conversation.hero.brand.mark"></span></span>
      <span><span id="hero">探索未至之境</span><span id="preview">预览版</span></span></div>
      <button id="workspace">DSH</button></div>
      <div data-slot="shell.overlay"><button id="back">返回 DeepSeek Harness</button></div>
      <div data-slot="settings.section"><p id="account">当前未登录 DeepSeek Harness 账号</p><p id="provider">DeepSeek</p><p id="other-preview">Preview</p></div>`
    mount()
    expect(document.getElementById('hero')?.textContent).toBe('ClawClaw，万物皆有回响')
    expect(document.getElementById('preview')?.style.display).toBe('none')
    expect(document.getElementById('workspace')?.textContent).toBe('DSH')
    expect(document.getElementById('back')?.textContent).toBe('返回 ClawClaw')
    expect(document.getElementById('account')?.textContent).toBe('当前未登录 DeepSeek 账号')
    expect(document.getElementById('provider')?.textContent).toBe('DeepSeek')
    expect(document.getElementById('other-preview')?.style.display).toBe('')
  })
})
