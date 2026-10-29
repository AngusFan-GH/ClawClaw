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
      slots: { inject: (_name: string, register: () => () => void) => register(), register },
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
})
