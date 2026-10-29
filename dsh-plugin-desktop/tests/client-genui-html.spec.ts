// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenuiHtmlView } from '../src/client/genui-html.tsx'
import { createGenuiHtmlDocument, GENUI_HTML_CHANNEL, GENUI_HTML_CSP } from '../src/client/genui-html-document.ts'
const node = { type: 'html' as const, title: 'Counter', html: '<button id="count" onclick="this.textContent++">0</button>', fallback: 'Initial count is zero.' }
let root: Root | undefined
async function mount(storage?: import('../src/client/genui-html-state.ts').HtmlStateStorage, repair?: () => Promise<void>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const element = document.createElement('div'); document.body.append(element)
  root = createRoot(element)
  await act(async () => root!.render(createElement(GenuiHtmlView, { node, zh: true, ...(repair === undefined ? {} : { repair }), ...(storage ? { storage } : {}) })))
  return element
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount()); root = undefined
  document.body.replaceChildren(); document.body.removeAttribute('data-ds-dark-theme')
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
const send = async (frame: HTMLIFrameElement, data: unknown, origin = 'null', source: MessageEventSource | null = frame.contentWindow) => {
  await act(async () => window.dispatchEvent(new MessageEvent('message', { origin, source, data })))
}

describe('isolated interactive HTML', () => {
  it('keeps the restrictive policy before untrusted markup and disables network, frames, forms and eval', () => {
    const source = createGenuiHtmlDocument('<meta http-equiv="Content-Security-Policy" content="default-src *"><script>window.bad=true</script>', { dark: true, zh: true })
    const parsed = new DOMParser().parseFromString(source, 'text/html')
    expect(parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toBe(GENUI_HTML_CSP)
    for (const rule of ["connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'", "worker-src 'none'"]) expect(GENUI_HTML_CSP).toContain(rule)
    expect(GENUI_HTML_CSP).not.toContain('unsafe-eval')
    expect(source).toContain('color-scheme:dark')
    expect(source).toContain('lang="zh-CN"')
    const saved = { controls: [], custom: '</script><script>evil()</script>' }
    const restored = createGenuiHtmlDocument('', { dark: false, zh: false, state: saved })
    const literal = restored.match(/const initialState=(.*?);const send=/)![1]!
    expect(literal).not.toContain('<')
    expect(JSON.parse(literal)).toEqual(saved)
  })
  it('never mounts user code in the host, accepts only its own opaque-frame messages and clamps layout', async () => {
    const element = await mount()
    const frame = element.querySelector('iframe')!
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(element.querySelector('#count')).toBeNull()
    const message = { channel: GENUI_HTML_CHANNEL, type: 'ready', value: true }
    await send(frame, message, 'https://attacker.test')
    await send(frame, message, 'null', window)
    expect(element.textContent).toContain('正在准备')
    await send(frame, message)
    expect(element.textContent).not.toContain('正在准备')
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'height', value: 100000 })
    expect(frame.style.height).toBe('720px')
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'height', value: NaN })
    expect(frame.style.height).toBe('720px')
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'height', value: 1 })
    expect(frame.style.height).toBe('120px')
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'execute', value: 'ignore' })
    expect(element.querySelector('iframe')).toBe(frame)
  })
  it('exposes fallback on runtime failure and unmounts on Stop; Reset creates fresh local state', async () => {
    const element = await mount()
    const frame = element.querySelector('iframe')!
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'error', value: true })
    expect(element.querySelector('details')?.open).toBe(true)
    expect(element.textContent).toContain(node.fallback)
    await act(async () => [...element.querySelectorAll('button')].find(button => button.textContent === '暂停')!.click())
    expect(element.querySelector('iframe')).toBeNull()
    await act(async () => [...element.querySelectorAll('button')].find(button => button.textContent === '恢复初始值')!.click())
    expect(element.querySelector('iframe')).not.toBe(frame)
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'error', value: true })
    expect(element.textContent).not.toContain('未能正常运行')
  })
  it('keeps a running simulation visible when a button throws and offers an explicit repair', async () => {
    const repair = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const element = await mount(undefined, repair)
    const frame = element.querySelector('iframe')!
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'ready', value: true })
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'error', value: true })
    expect(frame.style.visibility).toBe('visible')
    expect(element.querySelector('iframe')).toBe(frame)
    expect(element.textContent).toContain('部分操作执行出错')
    expect(element.querySelector('details')?.open).toBe(true)
    expect(repair).not.toHaveBeenCalled()
    const button = [...element.querySelectorAll('button')].find(button => button.textContent === '重新生成')!
    await act(async () => button.click())
    expect(element.textContent).toContain('修复请求未能提交')
    await act(async () => button.click())
    expect(button.textContent).toBe('已提交修复')
    expect(button.disabled).toBe(true)
    expect(repair).toHaveBeenCalledTimes(2)
  })
  it('restores persisted inputs, saves bounded state and resumes without clearing; Reset explicitly clears', async () => {
    const saved = { controls: [{ index: 0, value: '42' }], custom: { total: 42 } }
    const storage = { load: vi.fn(async () => saved), save: vi.fn(async () => {}), clear: vi.fn(async () => {}) }
    const element = await mount(storage)
    expect(element.querySelector('iframe')!.srcdoc).toContain('"value":"42"')
    const changed = { controls: [{ index: 0, value: '99' }], custom: { total: 99 } }
    await send(element.querySelector('iframe')!, { channel: GENUI_HTML_CHANNEL, type: 'state', value: changed })
    expect(storage.save).toHaveBeenCalledWith(changed)
    await act(async () => [...element.querySelectorAll('button')].find(b => b.textContent === '暂停')!.click())
    await act(async () => [...element.querySelectorAll('button')].find(b => b.textContent === '继续运行')!.click())
    expect(element.querySelector('iframe')!.srcdoc).toContain('"value":"99"')
    expect(storage.clear).not.toHaveBeenCalled()
    await act(async () => [...element.querySelectorAll('button')].find(b => b.textContent === '恢复初始值')!.click())
    expect(storage.clear).toHaveBeenCalledOnce()
    expect(element.querySelector('iframe')!.srcdoc).not.toContain('"value":"99"')
  })
  it('does not overwrite saved data when loading fails, and exposes a retry', async () => {
    const storage = { load: vi.fn(async () => { throw new Error('offline') }), save: vi.fn(async () => {}), clear: vi.fn(async () => {}) }
    const element = await mount(storage)
    expect(element.querySelector('iframe')).toBeNull()
    expect(element.textContent).toContain('无法读取已保存的输入')
    expect(storage.save).not.toHaveBeenCalled()
  })

  it('keeps reset secondary and reserves the measured height through pause and resume', async () => {
    const element = await mount()
    expect(element.querySelector('.clawGenuiHtmlToolbar')!.textContent).not.toContain('恢复初始值')
    expect(element.querySelector('details')!.open).toBe(false)
    expect(element.querySelector('.clawGenuiHtmlReset')!.getAttribute('title')).toContain('清除保存的输入')
    const viewport = element.querySelector<HTMLElement>('.clawGenuiHtmlViewport')!
    expect(viewport.style.height).toBe('240px')
    const frame = element.querySelector('iframe')!
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'height', value: 420 })
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'ready', value: true })
    const toggle = element.querySelector<HTMLButtonElement>('.clawGenuiHtmlToolbar button')!
    await act(async () => toggle.click())
    expect(viewport.style.height).toBe('420px')
    expect(element.querySelector('iframe')).toBeNull()
    expect(element.querySelector('details')!.open).toBe(false)
    expect(element.querySelector('.clawGenuiHtmlToolbar button')).toBe(toggle)
    await act(async () => toggle.click())
    expect(viewport.style.height).toBe('420px')
    expect(element.querySelector('iframe')!.style.visibility).toBe('hidden')
  })
  it('reserves space during saved-input loading instead of inserting a new result area later', async () => {
    const load = Promise.withResolvers<null>()
    const element = await mount({ load: () => load.promise, save: async () => {}, clear: async () => {} })
    const viewport = element.querySelector<HTMLElement>('.clawGenuiHtmlViewport')!
    expect(viewport.style.height).toBe('240px')
    expect(element.querySelector('iframe')).toBeNull()
    await act(async () => load.resolve(null))
    expect(element.querySelector('.clawGenuiHtmlViewport')).toBe(viewport)
    expect(viewport.style.height).toBe('240px')
    expect(element.querySelector('iframe')).not.toBeNull()
  })
  it('retries saving the current inputs without reloading the fragment', async () => {
    const saved = { controls: [{ index: 0, value: '99' }], custom: null }
    const storage = { load: vi.fn(async () => null), save: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined), clear: vi.fn(async () => {}) }
    const element = await mount(storage)
    const frame = element.querySelector('iframe')!
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'state', value: saved })
    expect(element.querySelector('.clawGenuiHtmlNotice')!.textContent).toContain('保存失败')
    await act(async () => element.querySelector<HTMLButtonElement>('.clawGenuiHtmlNotice button')!.click())
    expect(storage.save).toHaveBeenLastCalledWith(saved)
    expect(storage.save).toHaveBeenCalledTimes(2)
    expect(element.querySelector('.clawGenuiHtmlNotice')).toBeNull()
    expect(element.querySelector('iframe')).toBe(frame)
  })
  it('reloads a failed runtime with its current inputs rather than clearing storage', async () => {
    const saved = { controls: [{ index: 0, value: '99' }], custom: null }
    const storage = { load: vi.fn(async () => saved), save: vi.fn(async () => {}), clear: vi.fn(async () => {}) }
    const element = await mount(storage)
    const frame = element.querySelector('iframe')!
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'error', value: true })
    const reload = [...element.querySelectorAll('button')].find(button => button.textContent === '重新加载')!
    await act(async () => reload.click())
    expect(element.querySelector('iframe')).not.toBe(frame)
    expect(element.querySelector('iframe')!.srcdoc).toContain('"value":"99"')
    expect(storage.clear).not.toHaveBeenCalled()
  })

  it('uses a timed fallback if the frame never starts and updates the theme without discarding local state', async () => {
    vi.useFakeTimers()
    const schedule = vi.spyOn(window, 'setTimeout')
    const clear = vi.spyOn(window, 'clearTimeout')
    const element = await mount()
    const timer = schedule.mock.results[schedule.mock.calls.findIndex(call => call[1] === 8000)]!.value
    await act(async () => vi.advanceTimersByTime(8000))
    expect(element.querySelector('details')?.open).toBe(true)
    const frame = element.querySelector('iframe')!
    const source = frame.srcdoc
    const post = vi.spyOn(frame.contentWindow!, 'postMessage')
    await act(async () => document.body.setAttribute('data-ds-dark-theme', ''))
    expect(frame.srcdoc).toBe(source)
    expect(post).toHaveBeenCalledWith({ channel: GENUI_HTML_CHANNEL, type: 'theme', value: true }, '*')
    await act(async () => root!.unmount()); root = undefined
    expect(clear).toHaveBeenCalledWith(timer)
  })
})
