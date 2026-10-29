import { Context } from '@deepseek-ai/cordis'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import * as Genui from '../src/genui.ts'
import { GENUI_FORMAT, GENUI_RENDER_TOOL, GENUI_VALIDATE_TOOL } from '../src/genui-contract.ts'
import { validateGenuiDocument } from '../src/genui-core.ts'

const document = { format: GENUI_FORMAT, title: 'Plan', resultId: 'plan', items: [{ type: 'stat', label: 'Files', value: 3 },
  { type: 'html', title: 'Counter', html: '<button onclick="this.textContent++">0</button>', fallback: 'Initial count: 0.' },
  { type: 'chart', kind: 'bar', title: 'Requests', categories: ['API', 'Worker'], series: [{ name: 'Count', values: [20, 4] }] },
] }

async function harness(enabled = false) {
  const ctx = new Context()
  let value = { enabled }
  const listeners = new Set<() => void>()
  ctx.provide('settings', { register: () => ({ get: () => value,
    watch: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }) } as unknown as Context['settings'])
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const plugin = await ctx.plugin(Genui)
  return { ctx, plugin, listeners, set(next: boolean) { value = { enabled: next }; for (const listener of listeners) listener() } }
}

describe('GenUI Host integration', () => {
  it('defaults off and owns tools and prompt across enable, disable, re-enable and unload', async () => {
    expect(Genui.Config({} as { enabled: boolean })).toEqual({ enabled: false })
    const host = await harness()
    try {
      expect(host.ctx.tools.get(GENUI_RENDER_TOOL)).toBeUndefined()
      expect(renderPrompt(await host.ctx.systemPrompt.assemble())).not.toContain(Genui.GENUI_PROMPT)
      host.set(true)
      expect(host.ctx.tools.get(GENUI_RENDER_TOOL)).toBeDefined()
      expect(host.ctx.tools.get(GENUI_VALIDATE_TOOL)).toBeDefined()
      expect(renderPrompt(await host.ctx.systemPrompt.assemble())).toContain(Genui.GENUI_PROMPT)
      host.set(true)
      expect(host.ctx.tools.schemas().filter(tool => tool.name === GENUI_RENDER_TOOL)).toHaveLength(1)
      host.set(false)
      expect(host.ctx.tools.get(GENUI_RENDER_TOOL)).toBeUndefined()
      expect(renderPrompt(await host.ctx.systemPrompt.assemble())).not.toContain(Genui.GENUI_PROMPT)
      host.set(true)
      await host.plugin.dispose()
      expect(host.ctx.tools.get(GENUI_RENDER_TOOL)).toBeUndefined()
      expect(host.listeners.size).toBe(0)
      expect(renderPrompt(await host.ctx.systemPrompt.assemble())).not.toContain(Genui.GENUI_PROMPT)
    } finally { await host.ctx.fiber.dispose() }
  })

  it('uses the real tool output pipeline and restores identical metadata from a serialized Session', async () => {
    const host = await harness(true)
    try {
      const callId = ToolCallId('genui-call-1')
      const result = await host.ctx.tools.execute({ callId, name: GENUI_RENDER_TOOL,
        arguments: { document }, signal: new AbortController().signal })
      expect(result.isError).toBe(false)
      expect(result.content).toEqual([{ type: 'text', text: 'Plan\nFiles: 3\nCounter\nInitial count: 0.\nRequests\nCount\nAPI: 20\nWorker: 4' }])
      expect(result.meta).toEqual(document)
      const session = Session.create(SessionId('genui-parent'))
      session.append('tool/call', { turn: 1, step: 1, callId, name: GENUI_RENDER_TOOL, arguments: JSON.stringify({ document }) })
      session.append('tool/result', { turn: 1, step: 1,
        message: createToolResultMessage({ callId, content: result.content, isError: result.isError }), meta: result.meta! }, { surfaceOp: 'append' })
      await host.plugin.dispose()
      const restored = Session.create(session.id, JSON.parse(JSON.stringify(session.snapshotEvents())), session.header)
      const event = restored.snapshotEvents().find(event => event.type === 'tool/result')
      if (event?.type !== 'tool/result') throw new Error('Missing restored tool result')
      expect(event.data.meta).toEqual(document)
      expect(validateGenuiDocument(event.data.meta).ok).toBe(true)
      expect(event.data.message.content).toEqual(result.content)
      const child = Session.create(SessionId('genui-child'))
      expect(child.snapshotEvents()).toHaveLength(0)
      expect(restored.id).toBe(session.id)
    } finally { await host.ctx.fiber.dispose() }
  })

  it('preserves HTML and nested arrays through the preferred string parameter and rejects the observed item wrapper', async () => {
    const host = await harness(true)
    try {
      const invoke = (name: string, args: Record<string, unknown>) => host.ctx.tools.execute({ callId: ToolCallId('wire-replay'), name,
        arguments: args as never, signal: new AbortController().signal })
      const broken = { ...document, items: { item: document.items } }
      const rejected = await invoke(GENUI_VALIDATE_TOOL, { document: broken })
      expect(JSON.stringify(rejected.content)).toContain('$.items')
      expect(JSON.stringify(rejected.content)).toContain('document_json')
      expect(JSON.stringify(rejected.content)).toContain('Do not open a browser')
      const checked = await invoke(GENUI_VALIDATE_TOOL, { document_json: JSON.stringify(document) })
      expect(JSON.parse((checked.content[0] as { text: string }).text)).toMatchObject({ ok: true, format: GENUI_FORMAT, next_step: expect.stringContaining('Call clawclaw_render_ui now') })
      const rendered = await invoke(GENUI_RENDER_TOOL, { document_json: JSON.stringify(document) })
      expect(rendered.isError).toBe(false)
      expect(rendered.meta).toEqual(document)
      expect(Array.isArray((rendered.meta as typeof document).items)).toBe(true)
      const legacyString = await invoke(GENUI_RENDER_TOOL, { document: JSON.stringify(document) })
      expect(legacyString.meta).toEqual(document)
      const schema = host.ctx.tools.schemas().find(tool => tool.name === GENUI_RENDER_TOOL)!
      expect(schema.parameters).toMatchObject({ properties: { document_json: { type: 'string' }, document: expect.any(Object) } })
    } finally { await host.ctx.fiber.dispose() }
  })
  it('rejects malformed JSON, ambiguous arguments and over-budget strings without silently repairing them', async () => {
    const host = await harness(true)
    try {
      for (const args of [{}, { document, document_json: JSON.stringify(document) },
        { document_json: '{bad json' }, { document_json: ' '.repeat(65537) },
        { document_json: JSON.stringify({ ...document, items: { item: document.items } }) }]) {
        const result = await host.ctx.tools.execute({ callId: ToolCallId('bad-wire'), name: GENUI_RENDER_TOOL,
          arguments: args, signal: new AbortController().signal })
        expect(result.isError).toBe(true)
        expect(result.meta).toBeUndefined()
        expect(JSON.stringify(result.content)).toContain('document_json')
      }
    } finally { await host.ctx.fiber.dispose() }
  })

  it('returns diagnostics without displaying invalid documents and rejects disabled or aborted work', async () => {
    const host = await harness(true)
    try {
      const execute = (name: string, document: unknown) => host.ctx.tools.execute({ callId: ToolCallId('check'), name,
        arguments: { document }, signal: new AbortController().signal })
      const invalid = { ...document, items: [{ type: 'input' }] }
      const checked = await execute(GENUI_VALIDATE_TOOL, invalid)
      expect(checked.isError).toBe(false)
      expect(JSON.stringify(checked.content)).toContain('$.items[0].type')
      const rejected = await execute(GENUI_RENDER_TOOL, invalid)
      expect(rejected.isError).toBe(true)
      expect(rejected.meta).toBeUndefined()
      host.set(false)
      expect((await execute(GENUI_RENDER_TOOL, document)).isError).toBe(true)
      // A previously captured definition must also fail after disabling.
      const stale = Genui.createGenuiTool('render', () => false)
      await expect(stale.execute({ document }, { signal: new AbortController().signal } as never)).rejects.toThrow('disabled')
      const controller = new AbortController(); controller.abort()
      const body = vi.fn(stale.execute)
      await expect(body({ document }, { signal: controller.signal } as never)).rejects.toThrow()
    } finally { await host.ctx.fiber.dispose() }
  })
})
