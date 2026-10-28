// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenuiHtmlView } from '../src/client/genui-html.tsx'
import { createGenuiHtmlDocument, GENUI_HTML_CHANNEL, GENUI_HTML_CSP } from '../src/client/genui-html-document.ts'
const node = { type: 'html' as const, title: 'Counter', html: '<button id="count" onclick="this.textContent++">0</button>', fallback: 'Initial count is zero.' }
let root: Root | undefined
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const element = document.createElement('div'); document.body.append(element)
  root = createRoot(element)
  await act(async () => root!.render(createElement(GenuiHtmlView, { node, zh: true })))
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
    await act(async () => [...element.querySelectorAll('button')].find(button => button.textContent === '停止')!.click())
    expect(element.querySelector('iframe')).toBeNull()
    await act(async () => [...element.querySelectorAll('button')].find(button => button.textContent === '重置')!.click())
    expect(element.querySelector('iframe')).not.toBe(frame)
    await send(frame, { channel: GENUI_HTML_CHANNEL, type: 'error', value: true })
    expect(element.textContent).not.toContain('未能正常运行')
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
