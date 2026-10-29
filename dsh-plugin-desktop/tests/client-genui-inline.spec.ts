// @vitest-environment jsdom
import { act, createElement, type ComponentType, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ChatNodeViewProps, ChatSnapshot, ToolChatData, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { Context } from '@deepseek-ai/cordis'
import { GenuiAssistantView, GenuiFooterView, installGenuiInline } from '../src/client/genui-inline.tsx'
import { GenuiTurnTail } from '../src/client/genui.tsx'
import { GENUI_FORMAT, GENUI_RENDER_TOOL } from '../src/genui-contract.ts'

const roots: Root[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.replaceChildren(); vi.unstubAllGlobals()
})
const store = <T,>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} })
const visual = { format: GENUI_FORMAT, title: '交互演示', resultId: 'demo', items: [
  { type: 'html', title: '价格计算器', html: '<input value="3"><output>60</output>', fallback: '初始总价 60。' },
] }
function fixture(text = '先讲原理\n\n[[clawclaw-ui:demo]]\n\n再解释结果\n[[clawclaw-ui:demo]]') {
  const result = { kind: 'tool-result', seq: 20, time: 0, callId: 'render-1', name: GENUI_RENDER_TOOL,
    args: {}, call: { name: GENUI_RENDER_TOOL, argsRaw: '{}' }, callTime: 0, content: [{ type: 'text', text: '初始总价 60。' }],
    isError: false, meta: visual, subCalls: [],
  } as unknown as ToolResultNode
  const node = { key: 'assistant-2', kind: 'assistant-step', data: { status: 'settled', turn: 1, step: 2, time: 0,
    blocks: [{ kind: 'text', text }],
  } } as ChatNodeViewProps<'assistant-step'>['node']
  const tools = store<readonly ToolChatData[]>([{ root: result }])
  const assistants = store([node.data])
  const process = store([{ answerStep: 2, answerAnchorSeq: 30 }])
  const snapshot = { nodes: { turnDataSource: (_turn: number, kind: string) => kind === 'tool-call' ? tools
    : kind === 'assistant-step' ? assistants : process } } as unknown as ChatSnapshot
  const chat = store(snapshot)
  const retry = vi.fn(async (_turn: number) => {})
  const Native = vi.fn((props: ChatNodeViewProps<'assistant-step'>) => createElement('div', { 'data-native': true },
    props.node.data.blocks.flatMap(block => block.kind === 'text' ? [block.text] : [])))
  const props = { node, sessionId: 'main', groupPart: 'response', useTurnData: () => ({ answerStep: 2 }), Native,
    genui: { chat, zh: true, retry } } as unknown as Parameters<typeof GenuiAssistantView>[0]
  return { node, props, chat, result, retry, Native }
}
async function mount(element: ReactElement) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array(32).buffer } })
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ state: null }) }))
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); roots.push(root)
  await act(async () => root.render(element))
  return container
}

it('places one live card between native prose segments and removes its duplicate from the tail', async () => {
  const f = fixture()
  const view = await mount(createElement('div', {}, createElement(GenuiAssistantView, f.props), createElement(GenuiTurnTail, {
    chat: f.chat, sessionId: 'main', turn: { turn: 1, status: 'closed' }, zh: true, placement: store(true),
  } as never)))
  const answer = view.querySelector('.clawGenuiInlineAnswer')!
  expect([...answer.children].map(child => child.getAttribute('data-native') ? child.textContent?.trim() : child.getAttribute('data-genui-call')))
    .toEqual(['先讲原理', 'render-1', '再解释结果'])
  expect(view.querySelectorAll('iframe')).toHaveLength(1)
  expect(view.querySelector('.clawGenuiResults')).toBeNull()
  expect(view.textContent).not.toContain('[[clawclaw-ui:')
  expect(f.node.data.blocks[0]).toEqual({ kind: 'text', text: '先讲原理\n\n[[clawclaw-ui:demo]]\n\n再解释结果\n[[clawclaw-ui:demo]]' })
  expect(f.retry).not.toHaveBeenCalled()
})
it('does not consume a card from an interim assistant step or a reasoning-only view', async () => {
  const f = fixture()
  const interim = await mount(createElement(GenuiAssistantView, { ...f.props, useTurnData: () => ({ answerStep: 3 }) } as never))
  expect(interim.querySelector('iframe')).toBeNull()
  expect(interim.textContent).not.toContain('[[clawclaw-ui:')
  const reasoning = await mount(createElement(GenuiAssistantView, { ...f.props, groupPart: 'reasoning' } as never))
  expect(reasoning.querySelector('iframe')).toBeNull()
})
it('keeps ordinary assistant rendering on the original native path', async () => {
  const f = fixture('普通回答，包含公式与代码。')
  const view = await mount(createElement(GenuiAssistantView, f.props))
  expect(view.querySelector('.clawGenuiInlineAnswer')).toBeNull()
  expect(f.Native.mock.calls[0]![0].node).toBe(f.node)
})
it('uses readable saved result text for copying, without changing the durable answer', async () => {
  const f = fixture()
  const Native = ((props: ChatNodeViewProps<'turn-tail'>) => createElement('output', {}, props.node.data.closing?.blocks.flatMap(block =>
    block.kind === 'text' ? [block.text] : []).join('\n'))) as ComponentType<ChatNodeViewProps<'turn-tail'>>
  const footer = { ...f.props, Native, node: { kind: 'turn-tail', data: { turn: 1, closing: f.node.data } } }
  const view = await mount(createElement(GenuiFooterView, footer as never))
  expect(view.textContent).toContain('初始总价 60。')
  expect(view.textContent).not.toContain('[[clawclaw-ui:')
  expect(f.node.data.blocks[0]).toMatchObject({ text: expect.stringContaining('[[clawclaw-ui:demo]]') })
})

it('preserves native child-slot ownership in the real registry and restores renderers on disable', () => {
  const core = new SlotCore()
  core.register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } } } as never, () => null)
  let changed: ((key: string) => void) | undefined
  const stop = vi.fn()
  const ctx = { slots: { entries: core.entries.bind(core), register: core.register.bind(core),
    inject: (_name: string, setup: () => () => void) => setup() }, on: (_event: string, listener: (key: string) => void) => {
    changed = listener; return () => { stop(); changed = undefined }
  } } as unknown as Context
  core.onMutate(key => changed?.(key))
  const inline = installGenuiInline(ctx, async () => {})
  expect(inline.available.getSnapshot()).toBe(false)
  const Native = () => null
  const inject = () => ({ hooks: { presentation: store({}) } })
  core.register({ name: 'conversation.chat.node', key: 'assistant-step', locale: 'chat', inject,
    children: { 'conversation.chat.reasoning.body': { kind: 'single', scope: 'session' },
      'conversation.chat.message.images': { kind: 'single', scope: 'session' } },
  } as never, Native)
  const entry = core.entries('conversation.chat.node').find(row => row.options.key === 'assistant-step')!
  expect(entry.component).not.toBe(Native)
  expect(inline.available.getSnapshot()).toBe(true)
  expect(entry.inject).toBe(inject)
  expect(entry.locale).toBe('chat')
  expect(entry.children).toHaveProperty('conversation.chat.message.images')
  expect(core.entriesOfSlot('conversation.chat.node').find(row => row.options.key === 'assistant-step')).toBe(entry)
  const body = core.register({ name: 'conversation.chat.reasoning.body' } as never, () => null)
  inline.dispose()
  expect(entry.component).toBe(Native)
  expect(inline.available.getSnapshot()).toBe(false)
  expect(core.specDynamic('conversation.chat.reasoning.body')).toBeDefined()
  expect(core.entries('conversation.chat.reasoning.body')).toHaveLength(1)
  expect(stop).toHaveBeenCalledOnce()
  body()
})
