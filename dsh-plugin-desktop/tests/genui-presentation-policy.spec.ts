import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import Tools, { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { genuiPresentationGuard, inlinePresentationReason } from '../src/genui-presentation-policy.ts'

const request = '在对话里用交互式卡片讲解拉格朗日中值定理。'
const navigate = 'mcp__playwright__browser_navigate'
describe('explicit inline presentation routing', () => {
  it.each(['file:///tmp/lmt-explorer.html', 'http://127.0.0.1:8931/lmt-explorer.html', 'http://localhost:8931/'])('blocks the observed local-page fallback %s', url => {
    expect(inlinePresentationReason(request, navigate, { url })).toContain('clawclaw_render_ui')
  })
  it.each(['把现有 HTML 显示在对话里', '请直接内联展示这个计算器', 'Show this calculator in the chat'])('recognizes explicit inline wording: %s', text => {
    expect(inlinePresentationReason(text, navigate, { url: 'http://localhost:8931/' })).toBeDefined()
  })
  it.each([
    ['请在浏览器中打开这个计算器', navigate, { url: 'http://127.0.0.1:8931/' }],
    [request + '，并用浏览器验证', navigate, { url: 'http://127.0.0.1:8931/' }],
    [request, navigate, { url: 'https://en.wikipedia.org/wiki/Mean_value_theorem' }],
    ['开发一个网站并测试', navigate, { url: 'http://localhost:3000/' }],
    [request, 'clawclaw_render_ui', { url: 'file:///tmp/inline.html' }],
  ])('preserves explicit browser tasks, ordinary development and source research', (text, name, args) => {
    expect(inlinePresentationReason(text, name, args)).toBeUndefined()
  })
  it('does not mistake a negative browser instruction for browser authorization', () => {
    expect(inlinePresentationReason(request + '，不要打开浏览器', navigate, { url: 'http://localhost:8931/' })).toBeDefined()
  })
  it('reads only the latest human request, ignoring runtime context and prior inline requests', () => {
    let events = [{ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: request }] } },
      { type: 'user/message', data: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: '打开浏览器' }] } }]
    const exec = { name: navigate, arguments: { url: 'file:///tmp/lmt.html' }, agent: { session: { snapshotEvents: () => events } } } as unknown as ToolExecution
    expect(genuiPresentationGuard(exec)).toBeDefined()
    events = [...events, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '现在打开浏览器测试网页' }] } }]
    expect(genuiPresentationGuard(exec)).toBeUndefined()
    expect(genuiPresentationGuard({ ...exec, agent: undefined } as unknown as ToolExecution)).toBeUndefined()
  })
  it('denies execution before the browser body and releases the guard on disposal', async () => {
    const ctx = new Context(); await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
    const body = vi.fn(async () => 'opened')
    ctx.tools.register(defineTool({ name: navigate, description: 'browser fixture', parameters: { url: { type: 'string', required: true } }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: body }))
    const stop = ctx.tools.guard(exec => inlinePresentationReason(request, exec.name, exec.arguments))
    try {
      const invoke = () => ctx.tools.execute({ callId: ToolCallId('navigation'), name: navigate,
        arguments: { url: 'http://127.0.0.1:8931/lmt-explorer.html' }, signal: new AbortController().signal })
      const denied = await invoke()
      expect(denied.isError).toBe(true)
      expect(JSON.stringify(denied.content)).toContain('clawclaw_render_ui')
      expect(body).not.toHaveBeenCalled()
      stop(); expect((await invoke()).isError).toBe(false); expect(body).toHaveBeenCalledOnce()
    } finally { await ctx.fiber.dispose() }
  })
})
