// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ChatSnapshot, ToolChatData, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenuiTurnTail, genuiResults, latestGenuiResult, type GenuiTurnTailProps } from '../src/client/genui.tsx'
import { GENUI_FORMAT, GENUI_RENDER_TOOL, GENUI_ROUTING_MARKER } from '../src/genui-contract.ts'

const document = { format: GENUI_FORMAT, title: '服务状态', items: [
  { type: 'stat', label: '健康服务数', value: 3 },
  { type: 'table', columns: ['服务', '数值'], rows: [['API', 20], ['Worker', 4], ['Cache', 100]] },
  { type: 'progress', label: '检查进度', value: 50 },
] }

function result(seq = 24, patch: Partial<ToolResultNode> = {}): ToolResultNode {
  return { kind: 'tool-result', seq, time: 0, callId: `card-${seq}`, name: GENUI_RENDER_TOOL,
    args: {} as ToolResultNode['args'], call: { name: GENUI_RENDER_TOOL, argsRaw: '{}' }, callTime: 0,
    content: [{ type: 'text', text: '保存的服务状态文本' }], isError: false, meta: document, subCalls: [], ...patch }
}

function store<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return { getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next: T) { value = next; for (const listener of listeners) listener() },
    get listeners() { return listeners.size },
  }
}

function chatFor(turns: Record<number, ObservableSnapshot<readonly ToolChatData[]>>): ChatSnapshot {
  return { nodes: { turnDataSource: (turn: number, kind: string) => {
    if (kind !== 'tool-call') return store([])
    return turns[turn]
  } } } as unknown as ChatSnapshot
}

const roots: Root[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  globalThis.document.body.replaceChildren()
  vi.unstubAllGlobals()
})

async function mount(chat: GenuiTurnTailProps['chat'], turn = 1, sessionId = 'main', extra: Partial<GenuiTurnTailProps> = {}) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const element = globalThis.document.createElement('div'); globalThis.document.body.append(element)
  const root = createRoot(element); roots.push(root)
  await act(async () => root.render(createElement(GenuiTurnTail, { chat, turn: { turn }, sessionId, zh: true, ...extra } as GenuiTurnTailProps)))
  return { element, root }
}

describe('GenUI cards outside collapsed tool process', () => {
  it('shows the saved card through the completed-Turn tail without mounting a toolview', async () => {
    const tools = store<readonly ToolChatData[]>([{ root: result() }])
    const chat = store<ChatSnapshot | undefined>(chatFor({ 1: tools }))
    const { element, root } = await mount(chat)
    expect(element.querySelector('h3')?.textContent).toBe('服务状态')
    expect(element.querySelector('table')?.textContent).toContain('API20')
    expect(element.querySelector('progress')?.getAttribute('value')).toBe('50')
    expect(element.querySelector('[data-genui-session]')?.getAttribute('data-genui-session')).toBe('main')
    await act(async () => root.unmount()); roots.splice(roots.indexOf(root), 1)
    expect(chat.listeners).toBe(0)
    expect(tools.listeners).toBe(0)
    const restored = store<readonly ToolChatData[]>(JSON.parse(JSON.stringify(tools.getSnapshot())))
    const reopened = await mount(store(chatFor({ 1: restored })))
    expect(reopened.element.querySelector('table')?.textContent).toContain('Worker4')
  })

  it('embeds interactive HTML directly in the chat Turn without tool details, links or an outer result card', async () => {
    vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array(32).buffer } })
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ state: null }) }))
    const meta = { format: GENUI_FORMAT, title: '交互示例', items: [{ type: 'html', title: '价格计算器',
      html: '<label>数量<input type="number" value="3"></label><output>60</output>', fallback: '初始总价 60。调整数量可本地计算。' }] }
    const tools = store<readonly ToolChatData[]>([{ root: result(24, { meta }) }])
    const { element } = await mount(store(chatFor({ 1: tools })))
    expect(element.querySelector('.clawGenuiResults iframe')?.getAttribute('title')).toBe('价格计算器')
    expect(element.querySelector('[data-genui-session]')?.classList.contains('clawGenuiInline')).toBe(true)
    expect(element.querySelector('h3')).toBeNull()
    expect(element.querySelector('h4')?.textContent).toBe('价格计算器')
    expect(element.querySelector('a')).toBeNull()
    expect(element.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts')
    const restored = await mount(store(chatFor({ 1: store(JSON.parse(JSON.stringify(tools.getSnapshot()))) })))
    expect(restored.element.querySelector('iframe')?.getAttribute('srcdoc')).toContain('<output>60</output>')
  })

  it('shows real preparation and replaces it with the saved result when it arrives', async () => {
    const running = { phase: 'start' as const, callId: 'rendering', name: GENUI_RENDER_TOOL, turn: 1, step: 1,
      time: 0, args: result().args, argsRaw: '{}', subCalls: [] }
    const tools = store<readonly ToolChatData[]>([{ root: running }])
    const { element } = await mount(store(chatFor({ 1: tools })))
    expect(element.querySelector('[role="status"]')?.textContent).toBe('正在生成交互内容…')
    expect(element.querySelector('.clawGenui')).toBeNull()
    await act(async () => tools.set([{ root: result() }]))
    expect(element.querySelector('[role="status"]')).toBeNull()
    expect(element.querySelector('h3')?.textContent).toBe('服务状态')
  })
  it('explains an inline-routing correction without displaying raw tool denial text', async () => {
    const tools = store<readonly ToolChatData[]>([{ root: result(10, { name: 'mcp__playwright__browser_navigate', isError: true,
      content: [{ type: 'text', text: `${GENUI_ROUTING_MARKER} tool denied: internal corrective instructions` }] }) }])
    const { element } = await mount(store(chatFor({ 1: tools })))
    expect(element.textContent).toBe('正在改为对话内展示…')
    expect(element.textContent).not.toContain('denied')
  })
  it('provides one explicit scoped retry for a completed failure and reports submission errors', async () => {
    const tools = store<readonly ToolChatData[]>([{ root: result(10, { isError: true, content: [{ type: 'text', text: 'internal error' }] }) }])
    const retry = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const { element } = await mount(store(chatFor({ 1: tools })), 1, 'main', { retry, turn: { turn: 1, status: 'closed' } as GenuiTurnTailProps['turn'] })
    expect(element.textContent).toContain('交互内容未能显示')
    expect(element.textContent).not.toContain('internal error')
    const button = element.querySelector('button')!
    await act(async () => button.click())
    expect(element.textContent).toContain('重试未能提交')
    await act(async () => button.click())
    expect(retry).toHaveBeenLastCalledWith(1)
    expect(button.textContent).toBe('已提交重试')
    expect(button.disabled).toBe(true)
    expect(retry).toHaveBeenCalledTimes(2)
  })
  it('does not count successful validation as displayed UI or leave a completed turn loading', async () => {
    const tools = store<readonly ToolChatData[]>([{ root: result(10, { name: 'clawclaw_validate_ui', meta: null,
      content: [{ type: 'text', text: '{"ok":true}' }] }) }])
    const closed = await mount(store(chatFor({ 1: tools })), 1, 'main', { turn: { turn: 1, status: 'closed' } as GenuiTurnTailProps['turn'] })
    expect(closed.element.textContent).toContain('交互内容未能显示')
    expect(closed.element.querySelector('.clawGenui')).toBeNull()
    const open = await mount(store(chatFor({ 1: tools })))
    expect(open.element.textContent).toBe('正在生成交互内容…')
  })

  it('recovers the saved Fourier explanation after a failed render and an empty closing response', async () => {
    const failed = result(19, { isError: true })
    const assistants = store([{ blocks: [{ kind: 'text', text: '## 傅里叶变换\n将信号拆分为不同频率的正弦波。' },
      { kind: 'reasoning', text: 'Internal analysis must remain private.' }] }, { blocks: [] }])
    const process = store<Array<{ answerAnchorSeq: number | null }>>([{ answerAnchorSeq: null }])
    const snapshot = { nodes: { turnDataSource: (_turn: number, kind: string) => kind === 'tool-call'
      ? store([{ root: failed }]) : kind === 'assistant-step' ? assistants : process } } as unknown as ChatSnapshot
    const { element } = await mount(store(snapshot), 1, 'main', { turn: { turn: 1, status: 'closed' } as GenuiTurnTailProps['turn'] })
    expect(element.querySelector('h2')?.textContent).toBe('傅里叶变换')
    expect(element.textContent).not.toContain('Internal analysis')
    expect(element.textContent).toContain('交互内容未能显示')
    await act(async () => process.set([{ answerAnchorSeq: 17 }]))
    expect(element.querySelector('h2')).toBeNull()
  })

  it('does not show an endless generation notice for an incomplete historical turn', async () => {
    const tools = store<readonly ToolChatData[]>([{ root: result(10, { name: 'clawclaw_validate_ui', meta: null }) }])
    const { element } = await mount(store(chatFor({ 1: tools })), 1, 'main', { turn: { turn: 1, status: 'unknown' } as GenuiTurnTailProps['turn'] })
    expect(element.textContent).toBe('')
  })

  it('selects only the latest successful render, including PTC children, without using validation results', () => {
    const old = result(10)
    const child = result(24)
    const parent = result(30, { name: 'run_code', subCalls: [child] })
    expect(latestGenuiResult([{ root: old }, { root: parent },
      { root: result(40, { name: 'clawclaw_validate_ui' }) }, { root: result(50, { isError: true }) }])).toBe(child)
    expect(latestGenuiResult([{ root: { phase: 'start', callId: 'running', name: 'run_code', turn: 1, step: 1,
      time: 0, args: old.args, argsRaw: '{}', subCalls: [child] } }])).toBe(child)
  })

  it('retains independent results, updates explicit IDs in place and ignores failed updates', async () => {
    const first = result(1, { meta: { ...document, title: '初始状态', resultId: 'status' } })
    const plan = result(2, { meta: { ...document, title: '排查计划' } })
    const revised = result(3, { meta: { ...document, title: '更新状态', resultId: 'status' } })
    const failed = result(4, { isError: true, meta: { ...document, resultId: 'status' } })
    const parent = result(5, { name: 'run_code', subCalls: [revised, failed] })
    const tools = store<readonly ToolChatData[]>([{ root: plan }, { root: first }, { root: parent }, { root: revised }])
    expect(genuiResults(tools.getSnapshot())).toEqual([revised, plan])
    const { element } = await mount(store(chatFor({ 1: tools })))
    expect([...element.querySelectorAll('h3')].map(h => h.textContent)).toEqual(['更新状态', '排查计划'])
    const reopened = await mount(store(chatFor({ 1: store(JSON.parse(JSON.stringify(tools.getSnapshot()))) })))
    expect([...reopened.element.querySelectorAll('h3')].map(h => h.textContent)).toEqual(['更新状态', '排查计划'])
    const invalid = result(6, { meta: { ...document, resultId: 'status', items: [{ type: 'unknown' }] } })
    expect(genuiResults([{ root: revised }, { root: invalid }])).toEqual([revised, invalid])
  })

  it('isolates Turns and Sessions and reacts to late projection or result arrival', async () => {
    const turn1 = store<readonly ToolChatData[]>([])
    const turn2 = store<readonly ToolChatData[]>([{ root: result(60, { meta: { ...document, title: '第二轮' } }) }])
    const chat = store<ChatSnapshot | undefined>(undefined)
    const main = await mount(chat)
    expect(main.element.textContent).toBe('')
    await act(async () => chat.set(chatFor({ 1: turn1, 2: turn2 })))
    expect(main.element.textContent).toBe('')
    const second = await mount(chat, 2)
    const child = await mount(store(chatFor({ 1: store<readonly ToolChatData[]>([]) })), 1, 'child')
    await act(async () => turn1.set([{ root: result() }]))
    expect(main.element.textContent).toContain('服务状态')
    expect(second.element.textContent).toContain('第二轮')
    expect(second.element.textContent).not.toContain('服务状态')
    expect(child.element.textContent).toBe('')
  })

  it('replays repeated unnamed Monte Carlo attempts as one interactive result, including title changes', async () => {
    const html = { type: 'html', title: '撒点估 π', html: '<canvas></canvas>', fallback: 'Estimate pi with random samples.' }
    const attempts = [1, 2, 3, 6].map(seq => result(seq, { meta: { ...document,
      title: seq < 6 ? '蒙特卡罗互动演示 · 撒点估算圆周率' : '蒙特卡罗互动演示 · 撒点估算 π',
      items: [{ type: 'text', content: '撒点估算圆周率' }, html] } }))
    const failed = [4, 5].map(seq => result(seq, { isError: true }))
    const explicit = result(7, { meta: { ...document, resultId: 'independent', items: [html] } })
    const tools = [...attempts, ...failed, explicit].map(root => ({ root }))
    expect(genuiResults(tools)).toEqual([attempts[3], explicit])
    const { element } = await mount(store(chatFor({ 1: store(tools) })))
    expect(element.querySelectorAll('[data-genui-call]')).toHaveLength(2)
    expect(element.querySelector('[data-genui-call]')?.getAttribute('data-genui-call')).toBe('card-6')
    const reopened = await mount(store(chatFor({ 1: store(JSON.parse(JSON.stringify(tools))) })))
    expect(reopened.element.querySelectorAll('[data-genui-call]')).toHaveLength(2)
  })

  it('retains the saved text when metadata is missing or from a future version', async () => {
    const tools = store<readonly ToolChatData[]>([{ root: result(24, { meta: { format: 'future/v2' } }) }])
    const { element } = await mount(store(chatFor({ 1: tools })))
    expect(element.querySelector('pre')?.textContent).toBe('保存的服务状态文本')
    expect(element.querySelector('table')).toBeNull()
  })
})
