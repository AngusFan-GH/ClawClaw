import { describe, expect, it, vi } from 'vitest'
import { createDesktopMcpApi, parseDesktopMcpView } from '../src/client/mcp-api.ts'

const view = { mcpServers: [{ serverName: 'local', transport: 'stdio' as const, command: 'node', args: ['server.js'], cwd: '', env: {}, timeoutMs: 60_000,
  reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 }, credentialsReady: true,
  enabled: true, state: 'running' as const, tools: [{ name: 'mcp__local__search', description: 'Search' }],
  diagnostic: { code: 'ready' as const, stage: 'ready' as const, checkedAt: 1, lastSuccessfulAt: 1 } }], catalog: [] }

describe('Desktop MCP client API', () => {
  it('validates an independent MCP response', () => {
    expect(parseDesktopMcpView(view)).toEqual(view)
    expect(() => parseDesktopMcpView({ mcpServers: [...view.mcpServers, view.mcpServers[0]] })).toThrow(/duplicate/)
    expect(() => parseDesktopMcpView({ ...view, skills: [] })).not.toThrow()
    expect(() => parseDesktopMcpView({ ...view, mcpServers: [{ ...view.mcpServers[0], diagnostic: { code: 'unknown', stage: 'ready' } }] })).toThrow(/diagnostic/)
  })

  it('uses only the MCP routes', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(view), { status: 200 }))
    const api = createDesktopMcpApi(fetcher)
    await expect(api.read()).resolves.toEqual(view)
    await api.toggle('local', false)
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/desktop/mcp')
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/desktop/mcp/action')
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ action: 'toggle', serverName: 'local', enabled: false })
  })

  it('starts OAuth only from a validated HTTPS authorization URL', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ authorizationUrl: 'https://identity.example.com/authorize?state=one' }), { status: 200 }))
    const api = createDesktopMcpApi(fetcher)
    await expect(api.authorize('remote')).resolves.toEqual({ authorizationUrl: 'https://identity.example.com/authorize?state=one' })
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ action: 'oauth-start', serverName: 'remote' })
  })
})
