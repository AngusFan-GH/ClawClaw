// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { GenuiHtmlView } from '../src/client/genui-html.tsx'
import { createGenuiHtmlDocument, genuiHtmlDownloadName, GENUI_HTML_CHANNEL, GENUI_HTML_CSP } from '../src/client/genui-html-document.ts'
const node = { type: 'html' as const, title: 'Counter', html: '<button id="count" onclick="this.textContent++">0</button>', fallback: 'Initial count is zero.' }
let root: Root | undefined
const cleanups: Array<() => void> = []
function fullscreenMock(element: HTMLElement) {
  const current = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
  const exit = Object.getOwnPropertyDescriptor(document, 'exitFullscreen')
  let active: Element | null = null
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => active })
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: async () => {
    active = null; document.dispatchEvent(new Event('fullscreenchange'))
  } })
  element.requestFullscreen = async () => { active = element; document.dispatchEvent(new Event('fullscreenchange')) }
  cleanups.push(() => {
    if (current) Object.defineProperty(document, 'fullscreenElement', current); else Reflect.deleteProperty(document, 'fullscreenElement')
    if (exit) Object.defineProperty(document, 'exitFullscreen', exit); else Reflect.deleteProperty(document, 'exitFullscreen')
  })
}
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
  for (const cleanup of cleanups.splice(0)) cleanup()
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
  it('exposes fallback on runtime failure; Reset creates fresh local state and ignores the retired frame', async () => {
    const element = await mount()
    const frame = element.querySelector('iframe')!
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'error', value: true })
    expect(element.querySelector('details')?.open).toBe(true)
    expect(element.textContent).toContain(node.fallback)
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
    const button = [...element.querySelectorAll('button')].find(button => button.textContent === '请求重新生成')!
    await act(async () => button.click())
    expect(element.textContent).toContain('重新生成请求发送失败')
    await act(async () => button.click())
    expect(button.textContent).toBe('已发送请求')
    expect(button.disabled).toBe(true)
    expect(repair).toHaveBeenCalledTimes(2)
    expect(element.textContent).toContain('请在后续回答中查看')
    expect(element.querySelector('iframe')).toBe(frame)
  })
  it('restores persisted inputs and saves bounded state without reloading; Reset explicitly clears', async () => {
    const saved = { controls: [{ index: 0, value: '42' }], custom: { total: 42 } }
    const storage = { load: vi.fn(async () => saved), save: vi.fn(async () => {}), clear: vi.fn(async () => {}) }
    const element = await mount(storage)
    expect(element.querySelector('iframe')!.srcdoc).toContain('"value":"42"')
    const changed = { controls: [{ index: 0, value: '99' }], custom: { total: 99 } }
    const frame = element.querySelector('iframe')!
    const source = frame.srcdoc
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'state', value: changed })
    expect(storage.save).toHaveBeenCalledWith(changed)
    expect(element.querySelector('iframe')).toBe(frame)
    expect(frame.srcdoc).toBe(source)
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
    expect([...element.querySelectorAll('button')].some(button => button.textContent === '重新读取输入')).toBe(true)
  })

  it('accepts bounded content widths only from the owning frame without restarting it', async () => {
    const element = await mount()
    const section = element.querySelector<HTMLElement>('.clawGenuiHtml')!
    const frame = element.querySelector('iframe')!
    const source = frame.srcdoc
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'width', value: 500 }, 'https://attacker.test')
    expect(section.style.maxWidth).toBe('640px')
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'width', value: 200 })
    expect(section.style.maxWidth).toBe('320px')
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'width', value: 99999 })
    expect(section.style.maxWidth).toBe('960px')
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'width', value: NaN })
    expect(section.style.maxWidth).toBe('960px')
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'width', value: null })
    expect(section.style.maxWidth).toBe('')
    expect(element.querySelector('iframe')).toBe(frame)
    expect(frame.srcdoc).toBe(source)
  })

  it('provides only fullscreen/download in the toolbar and expands the same live iframe', async () => {
    const element = await mount()
    expect(element.querySelector('.clawGenuiHtmlToolbar')!.textContent).not.toContain('恢复初始值')
    expect(element.querySelector('details')!.open).toBe(false)
    expect(element.querySelector('.clawGenuiHtmlReset')!.getAttribute('title')).toContain('清除保存的输入')
    const viewport = element.querySelector<HTMLElement>('.clawGenuiHtmlViewport')!
    const section = element.querySelector<HTMLElement>('.clawGenuiHtml')!
    expect(viewport.style.height).toBe('240px')
    const frame = element.querySelector('iframe')!
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'height', value: 420 })
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'ready', value: true })
    const source = frame.srcdoc
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'width', value: 488 })
    expect(section.style.maxWidth).toBe('488px')
    fullscreenMock(element.querySelector('section')!)
    expect([...element.querySelectorAll('.clawGenuiHtmlToolbar button')].map(button => button.getAttribute('aria-label'))).toEqual(['全屏', '下载 HTML'])
    const toggle = element.querySelector<HTMLButtonElement>('.clawGenuiHtmlToolbar button')!
    await act(async () => toggle.click())
    expect(frame.style.height).toBe('100%')
    expect(section.style.maxWidth).toBe('')
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'width', value: 960 })
    expect(toggle.getAttribute('aria-label')).toBe('退出全屏')
    expect(element.querySelector('iframe')).toBe(frame)
    expect(frame.srcdoc).toBe(source)
    expect(element.querySelector('details')!.open).toBe(false)
    expect(element.querySelector('.clawGenuiHtmlToolbar button')).toBe(toggle)
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'height', value: 700 })
    await act(async () => toggle.click())
    expect(viewport.style.height).toBe('420px')
    expect(section.style.maxWidth).toBe('488px')
    expect(frame.style.visibility).toBe('visible')
    expect(element.querySelector('iframe')).toBe(frame)
  })

  it('downloads self-contained HTML with bounded current state without restarting the live fragment', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Blob', NodeBlob)
    let exported: Blob | undefined
    const revoke = vi.fn()
    const NativeUrl = URL
    vi.stubGlobal('URL', class extends NativeUrl {
      static override createObjectURL(blob: Blob) { exported = blob; return 'blob:download' }
      static override revokeObjectURL = revoke
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('Counter.html')
      expect(this.href).toBe('blob:download')
    })
    const element = await mount()
    const frame = element.querySelector('iframe')!
    const source = frame.srcdoc
    const state = { controls: [{ index: 0, value: '99' }], custom: { total: 100 } }
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'state', value: state })
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="下载 HTML"]')!.click())
    const html = await exported!.text()
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('"total":100')
    expect(html).toContain('const send=()=>{}')
    expect(html).toContain('getState:')
    expect(html).not.toContain('/api/desktop/')
    expect(element.querySelector('iframe')).toBe(frame)
    expect(frame.srcdoc).toBe(source)
    expect(click).toHaveBeenCalledOnce()
    await act(async () => vi.advanceTimersByTime(1000))
    expect(revoke).toHaveBeenCalledWith('blob:download')
  })
  it.each([['../实验/π', '-实验-π.html'], ['CON', 'visualization-CON.html'], [' ', 'visualization.html']])('uses a portable download name for %s', (title, expected) => {
    expect(genuiHtmlDownloadName(title)).toBe(expected)
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
    expect(element.querySelector('.clawGenuiHtmlNotice button')?.textContent).toBe('重试保存')
    await act(async () => element.querySelector<HTMLButtonElement>('.clawGenuiHtmlNotice button')!.click())
    expect(storage.save).toHaveBeenLastCalledWith(saved)
    expect(storage.save).toHaveBeenCalledTimes(2)
    expect(element.querySelector('.clawGenuiHtmlNotice')).toBeNull()
    expect(element.querySelector('iframe')).toBe(frame)
  })
  it('distinguishes retrying a failed reset from saving, reloading and model regeneration', async () => {
    const reset = Promise.withResolvers<void>()
    const repair = vi.fn(async () => {})
    const storage = { load: vi.fn(async () => null), save: vi.fn(async () => {}),
      clear: vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(() => reset.promise) }
    const element = await mount(storage, repair)
    const frame = element.querySelector('iframe')!
    await act(async () => element.querySelector<HTMLButtonElement>('.clawGenuiHtmlReset')!.click())
    const retry = element.querySelector<HTMLButtonElement>('.clawGenuiHtmlNotice button')!
    expect(retry.textContent).toBe('重试恢复')
    await act(async () => retry.click())
    expect(retry.textContent).toBe('正在恢复…')
    expect(retry.disabled).toBe(true)
    expect(element.querySelector('iframe')).toBe(frame)
    expect(repair).not.toHaveBeenCalled()
    expect(storage.save).not.toHaveBeenCalled()
    await act(async () => reset.resolve())
    expect(storage.clear).toHaveBeenCalledTimes(2)
    expect(element.querySelector('.clawGenuiHtmlNotice')).toBeNull()
    expect(element.querySelector('iframe')).not.toBe(frame)
  })

  it('reloads a failed runtime with its current inputs rather than clearing storage', async () => {
    const saved = { controls: [{ index: 0, value: '99' }], custom: null }
    const storage = { load: vi.fn(async () => saved), save: vi.fn(async () => {}), clear: vi.fn(async () => {}) }
    const element = await mount(storage)
    const frame = element.querySelector('iframe')!
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'error', value: true })
    const reload = [...element.querySelectorAll('button')].find(button => button.textContent === '重新加载内容')!
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
