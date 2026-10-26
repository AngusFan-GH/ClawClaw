import { createServer } from 'node:http'
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { expect, it } from 'vitest'
import { DesktopMcpController, type DesktopMcpSettings } from '../src/mcp.ts'

it('saves an HTTP endpoint, discovers and calls tools with a bearer header without TLS', async () => {
  const host = process.env.CLAWCLAW_MCP_TEST_HOST ?? '127.0.0.1'
  const headers: Array<string | undefined> = []
  const server = createServer(async (req, res) => {
    headers.push(req.headers.authorization)
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const message = JSON.parse(Buffer.concat(chunks).toString())
    if (!Object.hasOwn(message, 'id')) { res.writeHead(202); res.end(); return }
    let result: object
    switch (message.method) {
      case 'initialize': result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'http-fixture', version: '1' } }; break
      case 'tools/list': result = { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] }; break
      case 'tools/call': result = { content: [{ type: 'text', text: message.params.arguments.text }] }; break
      default: result = {}
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
  })
  server.listen(0, host); await once(server, 'listening')
  const ctx = new Context()
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const credentials = new Map<string, string>()
  ctx.reflect.provide('credentials', {
    resolve: async (ref: string) => credentials.has(ref) ? { value: credentials.get(ref)! } : undefined,
    set: async (ref: string, value: string) => { credentials.set(ref, value) },
    unset: async (ref: string) => { credentials.delete(ref) },
  })
  let value: DesktopMcpSettings = { mcpServers: [] }
  const settings = { get: () => value, update: async (patch: Partial<DesktopMcpSettings>) => { value = { ...value, ...patch } } } as unknown as SettingsScope<DesktopMcpSettings>
  const controller = new DesktopMcpController(ctx, settings)
  try {
    const view = await controller.save({ serverName: 'http', transport: 'streamable-http',
      url: `http://${host}:${(server.address() as { port: number }).port}/mcp`, headers: { Authorization: 'HTTP_TOKEN' },
      reconnect: { enabled: false, initialDelayMs: 100, maxDelayMs: 200, maxAttempts: 1 } }, undefined, { HTTP_TOKEN: 'Bearer fixture-token' })
    expect(view.mcpServers[0]).toMatchObject({ state: 'running', diagnostic: { code: 'ready' } })
    const result = await ctx.tools.execute({ name: 'mcp__http__echo', arguments: { text: 'HTTP works' }, callId: ToolCallId('http'), signal: new AbortController().signal })
    expect(result).toMatchObject({ isError: false, value: { content: [{ type: 'text', text: 'HTTP works' }] } })
    await controller.toggle('http', false)
    expect(ctx.tools.schemas().some(tool => tool.name === 'mcp__http__echo')).toBe(false)
    expect((await controller.read()).mcpServers[0]).toMatchObject({ state: 'disabled' })
    await controller.toggle('http', true)
    expect((await controller.read()).mcpServers[0]).toMatchObject({ state: 'running', diagnostic: { code: 'ready' } })
    const reconnected = await ctx.tools.execute({ name: 'mcp__http__echo', arguments: { text: 'Reconnected' }, callId: ToolCallId('http-reconnected'), signal: new AbortController().signal })
    expect(reconnected).toMatchObject({ isError: false, value: { content: [{ type: 'text', text: 'Reconnected' }] } })
    expect(value.mcpServers[0]).toMatchObject({ url: `http://${host}:${(server.address() as { port: number }).port}/mcp`, headers: { Authorization: 'HTTP_TOKEN' } })
    await controller.dispose()
    expect(ctx.tools.schemas().some(tool => tool.name === 'mcp__http__echo')).toBe(false)
    const restored = new DesktopMcpController(ctx, settings)
    try {
      await restored.test('http')
      expect((await restored.read()).mcpServers[0]).toMatchObject({ diagnostic: { code: 'ready' } })
      const restoredResult = await ctx.tools.execute({ name: 'mcp__http__echo', arguments: { text: 'Restored' }, callId: ToolCallId('http-restored'), signal: new AbortController().signal })
      expect(restoredResult).toMatchObject({ isError: false, value: { content: [{ type: 'text', text: 'Restored' }] } })
    } finally { await restored.dispose() }
    expect(headers.length).toBeGreaterThanOrEqual(12)
    expect(headers.every(header => header === 'Bearer fixture-token')).toBe(true)
  } finally {
    await controller.dispose(); await ctx.fiber.dispose()
    server.closeAllConnections(); await new Promise<void>(resolve => { server.close(() => { resolve() }) })
  }
}, 10_000)
