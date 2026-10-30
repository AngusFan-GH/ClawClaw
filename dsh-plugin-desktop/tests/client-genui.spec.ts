// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyDesktopGenui, GenuiResultView, GenuiToolView, type GenuiResultViewProps } from '../src/client/genui.tsx'
import { GENUI_FORMAT, GENUI_RENDER_TOOL } from '../src/genui-contract.ts'

const roots: Root[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.replaceChildren()
  document.head.querySelectorAll('style[data-claw-genui]').forEach(style => style.remove())
  vi.unstubAllGlobals()
})

async function mount(props: GenuiResultViewProps) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const element = document.createElement('div'); document.body.append(element)
  const root = createRoot(element); roots.push(root)
  await act(async () => root.render(createElement(GenuiResultView, props)))
  return { element, root }
}

const meta = { format: GENUI_FORMAT, title: 'Services', items: [
  { type: 'table', columns: ['Name', 'Count'], rows: [['Ten', 10], ['Two', 2], ['Zero', 0]] },
  { type: 'progress', label: 'Done', value: 25 },
  { type: 'callout', content: '<img src=x onerror=alert(1)>', tone: 'warning' },
] }
const props: GenuiResultViewProps = { sessionId: 'main', callId: 'call-1', meta, text: 'Saved fallback', isError: false }

describe('GenUI result card', () => {
  it('renders durable data as text, exposes accessible controls and sorts numbers locally', async () => {
    const { element } = await mount(props)
    expect(element.querySelector('section')?.getAttribute('data-genui-session')).toBe('main')
    expect(element.querySelector('progress')?.getAttribute('aria-label')).toBe('Done')
    expect(element.querySelector('img')).toBeNull()
    expect(element.textContent).toContain('<img src=x onerror=alert(1)>')
    const button = element.querySelectorAll('button')[1]!
    await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(Array.from(element.querySelectorAll('tbody tr')).map(row => row.textContent)).toEqual(['Zero0', 'Two2', 'Ten10'])
    expect(element.querySelectorAll('th')[1]?.getAttribute('aria-sort')).toBe('ascending')
    await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(Array.from(element.querySelectorAll('tbody tr')).map(row => row.textContent)).toEqual(['Ten10', 'Two2', 'Zero0'])
    expect(element.querySelectorAll('th')[1]?.getAttribute('aria-sort')).toBe('descending')
    expect(meta.items[0]?.rows).toEqual([['Ten', 10], ['Two', 2], ['Zero', 0]])
  })

  it('isolates identical cards in main and child views and reconstructs original order on remount', async () => {
    const main = await mount(props)
    const child = await mount({ ...props, sessionId: 'child' })
    await act(async () => main.element.querySelectorAll('button')[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(main.element.querySelector('tbody tr')?.textContent).toBe('Zero0')
    expect(child.element.querySelector('tbody tr')?.textContent).toBe('Ten10')
    const reopened = await mount({ ...props, meta: JSON.parse(JSON.stringify(meta)) })
    expect(reopened.element.querySelector('tbody tr')?.textContent).toBe('Ten10')
    expect(child.element.querySelector('section')?.getAttribute('data-genui-session')).toBe('child')
  })

  it.each([undefined, { ...meta, format: 'future/v2' }, { ...meta, items: [{ type: 'button', action: 'execute' }] }])(
    'falls back to saved text for missing, future or invalid metadata', async invalid => {
      const { element } = await mount({ ...props, meta: invalid, zh: true })
      expect(element.textContent).toContain('保存的文本结果')
      expect(element.querySelector('pre')?.textContent).toBe('Saved fallback')
      expect(element.querySelector('button')).toBeNull()
    },
  )

  it('does not turn an error or incomplete arguments into a result card', async () => {
    const { element, root } = await mount({ ...props, isError: true, text: 'Validation failed' })
    expect(element.textContent).toBe('Validation failed')
    await act(async () => root.render(createElement(GenuiToolView, { phase: 'preparing', block: { args: meta }, zh: true } as never)))
    expect(element.querySelector('[role="status"]')?.textContent).toBe('正在生成交互内容…')
    expect(element.querySelector('table')).toBeNull()
  })

  it('follows confirmed Host enablement and removes slot/style on disable and disposal', () => {
    let enabled = false
    let cleanup: (() => void) | undefined
    const listeners = new Set<() => void>()
    const removeView = vi.fn()
    const register = vi.fn((_options: unknown, _component: unknown) => removeView)
    const scope = {
      locale: { getSnapshot: () => ({ active: 'zh-CN' }) },
      on: () => () => {},
      slots: { entries: () => [], inject: (_name: string, register: () => () => void) => register(), register },
      configForms: { get: () => ({ getSnapshot: () => ({ value: { enabled } }), subscribe: (callback: () => void) => {
        listeners.add(callback); return () => { listeners.delete(callback) }
      } }) },
      effect: (install: () => () => void) => { cleanup = install() },
    }
    applyDesktopGenui({ inject: (_deps: string[], install: (scope: unknown) => void) => install(scope) } as unknown as Context)
    const sync = () => { for (const listener of listeners) listener() }
    expect(register).not.toHaveBeenCalled()
    expect(document.head.querySelector('style[data-claw-genui]')).toBeNull()
    enabled = true; sync(); sync()
    expect(register).toHaveBeenCalledTimes(2)
    expect(register.mock.calls[0]?.[0]).toMatchObject({ name: 'tool.call.toolview', key: GENUI_RENDER_TOOL })
    expect(register.mock.calls[1]?.[0]).toMatchObject({ name: 'conversation.chat.turnTail', id: 'desktop-genui' })
    expect(document.head.querySelectorAll('style[data-claw-genui]')).toHaveLength(1)
    enabled = false; sync()
    expect(removeView).toHaveBeenCalledTimes(2)
    expect(document.head.querySelector('style[data-claw-genui]')).toBeNull()
    enabled = true; sync()
    cleanup?.()
    expect(removeView).toHaveBeenCalledTimes(4)
    expect(listeners.size).toBe(0)
    expect(document.head.querySelector('style[data-claw-genui]')).toBeNull()
  })

  it('renders HTML and explicit cards as independent siblings in a mixed result', async () => {
    vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array(32).buffer } })
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ state: null }) }))
    const { element } = await mount({ ...props, meta: { format: GENUI_FORMAT, title: '独立展示', items: [
      { type: 'card', title: '统计', items: [{ type: 'stat', label: '样本', value: 100 }] },
      { type: 'html', title: '交互模拟', html: '<button>运行</button>', fallback: '点击运行模拟。' },
      { type: 'card', title: '结论', items: [{ type: 'text', content: '样本更多时通常更准确。' }] },
    ] } })
    const result = element.querySelector('.clawGenuiResult')!
    expect([...result.children].map(child => child.getAttribute('aria-label'))).toEqual(['统计', '交互模拟', '结论'])
    expect(result.querySelectorAll('.clawGenuiSurface')).toHaveLength(0)
    expect(result.querySelectorAll('.clawGenuiCard')).toHaveLength(1)
    expect(result.querySelector('.clawGenuiProse')?.textContent).toContain('结论')
    expect(result.querySelectorAll('iframe')).toHaveLength(1)
    expect(result.querySelector('.clawGenuiHtml')?.parentElement).toBe(result)
  })

  it.each([true, false])('lifts nested HTML and retains state address and prose context (zh=%s)', async zh => {
    vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array(32).buffer } })
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ state: null }) }))
    vi.stubGlobal('fetch', fetch)
    const nested = { format: GENUI_FORMAT, title: '旧版结果', items: [{ type: 'card', title: '说明', items: [
      { type: 'text', content: '先讲原理' },
      { type: 'row', items: [{ type: 'html', title: '计算器', html: '<input value="3">', fallback: '输入数字。' }] },
      { type: 'text', content: '再解释结果' },
    ] }] }
    const saved = JSON.stringify(nested)
    const { element } = await mount({ ...props, meta: nested, zh })
    const result = element.querySelector('.clawGenuiResult')!
    expect([...result.children].map(child => child.getAttribute('aria-label'))).toEqual(['说明', '计算器', '说明'])
    const html = result.querySelector('.clawGenuiHtml')!
    expect(html.parentElement).toBe(result)
    expect(html.closest('.clawGenuiCard')).toBeNull()
    expect(html.closest('.clawGenuiSurface')).toBeNull()
    expect(html.closest('.clawGenuiRow')).toBeNull()
    expect(result.querySelectorAll('h3')).toHaveLength(3)
    expect(result.textContent).toContain(zh ? '说明（续）' : '说明 (continued)')
    expect(result.querySelectorAll('.clawGenuiCard')).toHaveLength(0)
    expect(result.querySelectorAll('.clawGenuiSurface')).toHaveLength(0)
    expect(result.textContent!.indexOf('先讲原理')).toBeLessThan(result.textContent!.indexOf('计算器'))
    expect(result.textContent!.indexOf('计算器')).toBeLessThan(result.textContent!.indexOf('再解释结果'))
    expect(JSON.parse((fetch.mock.calls as unknown as [string, RequestInit][])[0]![1].body as string)).toMatchObject({
      sessionId: 'main', callId: 'call-1', path: '0.1.0', action: 'load',
    })
    expect(JSON.stringify(nested)).toBe(saved)
  })

  it('shows tool history as a compact record without executing another interactive copy', async () => {
    const { element, root } = await mount(props)
    await act(async () => root.render(createElement(GenuiToolView, { phase: 'result', zh: true,
      sessionId: 'main', callId: 'old-attempt', block: { meta: { ...meta, items: [{ type: 'html', title: 'Old simulation',
        html: '<button onclick="missing()">Reset</button>', fallback: 'Old source' }] }, isError: false,
        content: [{ type: 'text', text: 'Old simulation text' }] } } as never)))
    expect(element.querySelector('iframe')).toBeNull()
    expect(element.querySelector('.clawGenui')).toBeNull()
    expect(element.querySelector('details')?.open).toBe(false)
    expect(element.textContent).toContain('本轮回答')
    expect(element.querySelector('pre')?.textContent).toBe('Old simulation text')
  })
})
