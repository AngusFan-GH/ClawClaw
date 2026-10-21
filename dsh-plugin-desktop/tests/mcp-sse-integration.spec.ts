import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { describe, expect, it, vi } from 'vitest'
import { DesktopMcpController, parseDesktopMcpServer, type DesktopMcpSettings } from '../src/mcp.ts'

// Real legacy SSE wire protocol: endpoint event, separate POST channel, replies
// and notifications on the GET stream. No graphical process or external server.
describe('desktop SSE runtime', () => {
  it('reports rejected SSE startup and releases the failed connection', async () => {
    let requests = 0
    const server = createServer((_req, res) => { requests++; res.writeHead(401); res.end() })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const ctx = new Context()
    await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
    ctx.reflect.provide('credentials', { resolve: async () => undefined })
    const value: DesktopMcpSettings = { mcpServers: [parseDesktopMcpServer({ serverName: 'rejected', transport: 'sse',
      url: `http://127.0.0.1:${(server.address() as { port: number }).port}/sse`,
      reconnect: { enabled: false, initialDelayMs: 100, maxDelayMs: 200, maxAttempts: 1 } })] }
    const settings = { get: () => value } as unknown as SettingsScope<DesktopMcpSettings>
    const controller = new DesktopMcpController(ctx, settings)
    try {
      const view = await controller.test('rejected')
      expect(view.mcpServers[0]).toMatchObject({ state: 'error', diagnostic: { code: 'connection-failed' }, tools: [] })
      expect(requests).toBeGreaterThan(0)
      expect(ctx.tools.schemas()).toEqual([])
    } finally {
      await controller.dispose(); await ctx.fiber.dispose()
      server.closeAllConnections(); await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    }
  }, 10_000)

  it('discovers, calls, refreshes tools, reconnects, and closes its stream on disable', async () => {
    const streams = new Map<string, ServerResponse>()
    const headers: Array<string | undefined> = []
    let connections = 0
    let includeSecondTool = false
    const server = createServer(async (req, res) => {
      headers.push(req.headers.authorization)
      if (req.method === 'GET') {
        const id = String(++connections)
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        streams.set(id, res)
        res.write(`event: endpoint\ndata: /messages?id=${id}\n\n`)
        res.once('close', () => { streams.delete(id) })
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const message = JSON.parse(Buffer.concat(chunks).toString())
      const stream = streams.get(new URL(req.url!, 'http://localhost').searchParams.get('id')!)
      if (Object.hasOwn(message, 'id')) {
        let result: object
        switch (message.method) {
          case 'initialize': result = { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'sse-fixture', version: '1' } }; break
          case 'tools/list': result = { tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
            ...(includeSecondTool ? [{ name: 'second', inputSchema: { type: 'object' } }] : [])] }; break
          case 'tools/call': result = { content: [{ type: 'text', text: message.params.arguments.text }] }; break
          default: result = {}
        }
        stream?.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`)
      }
      res.writeHead(202); res.end()
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address() as { port: number }
    const ctx = new Context()
    await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
    ctx.reflect.provide('credentials', { resolve: async () => ({ value: 'Bearer fixture-token' }) })
    let value: DesktopMcpSettings = { mcpServers: [parseDesktopMcpServer({ serverName: 'legacy', transport: 'sse', url: `http://127.0.0.1:${address.port}/sse`,
      headers: { Authorization: 'MCP_TOKEN' }, reconnect: { enabled: true, initialDelayMs: 100, maxDelayMs: 200, maxAttempts: 2 } })] }
    const settings = { get: () => value, watch: () => () => {}, update: async (patch: Partial<DesktopMcpSettings>) => { value = { ...value, ...patch } } } as unknown as SettingsScope<DesktopMcpSettings>
    const controller = new DesktopMcpController(ctx, settings)
    try {
      await controller.test('legacy')
      expect((await controller.read()).mcpServers[0]).toMatchObject({ transport: 'sse', diagnostic: { code: 'ready' } })
      const result = await ctx.tools.execute({ name: 'mcp__legacy__echo', arguments: { text: 'SSE works' }, callId: ToolCallId('sse'), signal: new AbortController().signal })
      expect(result).toMatchObject({ isError: false, value: { content: [{ type: 'text', text: 'SSE works' }] } })
      includeSecondTool = true
      streams.values().next().value!.write('event: message\ndata: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n')
      await vi.waitFor(() => { expect(ctx.tools.schemas().some(tool => tool.name === 'mcp__legacy__second')).toBe(true) })
      streams.values().next().value!.end()
      await vi.waitFor(() => { expect(connections).toBe(2); expect(ctx.tools.schemas().some(tool => tool.name === 'mcp__legacy__echo')).toBe(true) }, { timeout: 5_000 })
      expect(headers.length).toBeGreaterThan(4)
      expect(headers.every(header => header === 'Bearer fixture-token')).toBe(true)
      await controller.toggle('legacy', false)
      await vi.waitFor(() => { expect(streams.size).toBe(0) })
      expect(ctx.tools.schemas().filter(tool => tool.name.startsWith('mcp__legacy__'))).toEqual([])
    } finally {
      await controller.dispose(); await ctx.fiber.dispose()
      for (const stream of streams.values()) stream.end()
      server.closeAllConnections(); await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    }
  }, 20_000)
})
