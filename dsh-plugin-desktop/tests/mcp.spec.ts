import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { describe, expect, it, vi } from 'vitest'
import {
  DesktopMcpController, importMcpServersDocument, mcpCredentialReference, parseDesktopMcpServer,
  type DesktopMcpSettings,
} from '../src/mcp.ts'

const reconnect = { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 }

function controllerFixture(initial: DesktopMcpSettings, options: { failUpdate?: boolean, failSetRef?: string } = {}) {
  let value = initial
  const stored = new Map<string, string>()
  const schemas = vi.fn<() => { name: string, description?: string }[]>(() => [])
  const set = vi.fn(async (ref: string, secret: string) => {
    if (ref === options.failSetRef) throw new Error('credential write failed')
    stored.set(ref, secret)
  })
  const unset = vi.fn(async (ref: string) => { stored.delete(ref) })
  const update = vi.fn(async (patch: { mcpServers?: DesktopMcpSettings['mcpServers'] }) => {
    if (options.failUpdate) throw new Error('settings update failed')
    if (patch.mcpServers !== undefined) value = { mcpServers: patch.mcpServers }
  })
  const fiber = Object.assign(Promise.resolve(), { dispose: vi.fn(async () => {}) })
  const ctx = { credentials: { resolve: async (ref: string) => {
    const secret = stored.get(ref); return secret === undefined ? undefined : { value: secret, source: 'test' }
  }, set, unset }, tools: { schemas }, plugin: vi.fn(() => fiber), logger: { error: vi.fn() } } as unknown as Context
  const settings = { get: () => value, update, watch: vi.fn(() => () => {}) } as unknown as SettingsScope<DesktopMcpSettings>
  return { controller: new DesktopMcpController(ctx, settings), stored, schemas, set, unset, update }
}

describe('Desktop MCP', () => {
  it('accepts bounded credential-free configurations', () => {
    expect(parseDesktopMcpServer({
      serverName: 'local_files', transport: 'stdio', command: 'node', args: ['server.js'], enabled: true,
    })).toEqual(expect.objectContaining({ serverName: 'local_files', transport: 'stdio', command: 'node', args: ['server.js'], cwd: '', env: {}, timeoutMs: 60_000, enabled: true }))
    expect(parseDesktopMcpServer({
      serverName: 'remote', transport: 'streamable-http', url: 'https://example.com/mcp', enabled: false,
    })).toEqual(expect.objectContaining({ serverName: 'remote', transport: 'streamable-http', url: 'https://example.com/mcp', headers: {}, timeoutMs: 60_000, enabled: false }))
  })

  it('rejects embedded HTTP credentials and invalid namespaces', () => {
    expect(() => parseDesktopMcpServer({
      serverName: 'bad name', transport: 'stdio', command: 'node', args: [], enabled: true,
    })).toThrow()
    expect(() => parseDesktopMcpServer({
      serverName: 'remote', transport: 'streamable-http', url: 'https://user:secret@example.com/mcp', enabled: true,
    })).toThrow(/without embedded credentials/)
  })

  it('imports standard mcpServers JSON without persisting credential values in configuration', () => {
    const imported = importMcpServersDocument({ mcpServers: { github: {
      command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'ghp_example' },
    } } })
    const ref = mcpCredentialReference('github', 'GITHUB_TOKEN')
    expect(imported).toEqual([expect.objectContaining({
      server: expect.objectContaining({ serverName: 'github', env: { GITHUB_TOKEN: ref } }),
      secrets: { [ref]: 'ghp_example' },
    })])
    expect(JSON.stringify(imported[0]?.server)).not.toContain('ghp_example')
  })

  it('keeps normalized credential references distinct', () => {
    expect(mcpCredentialReference('foo-bar', 'TOKEN')).not.toBe(mcpCredentialReference('foo_bar', 'TOKEN'))
    expect(mcpCredentialReference('Foo', 'TOKEN')).not.toBe(mcpCredentialReference('foo', 'TOKEN'))
    expect(mcpCredentialReference('remote', 'X-A')).not.toBe(mcpCredentialReference('remote', 'X_A'))
  })

  it('rolls back earlier credential writes when a later write fails', async () => {
    const first = 'MCP_FIRST'; const second = 'MCP_SECOND'
    const fixture = controllerFixture({ mcpServers: [] }, { failSetRef: second })
    fixture.stored.set(first, 'old-value')
    await expect(fixture.controller.save({
      serverName: 'local', transport: 'stdio', command: 'node', env: { FIRST: first, SECOND: second }, reconnect, enabled: false,
    }, undefined, { [first]: 'new-value', [second]: 'second-value' })).rejects.toThrow('credential write failed')
    expect(fixture.stored.get(first)).toBe('old-value')
    expect(fixture.update).not.toHaveBeenCalled()
  })

  it('rolls back credential writes when settings persistence fails', async () => {
    const ref = 'MCP_TOKEN'
    const fixture = controllerFixture({ mcpServers: [] }, { failUpdate: true })
    await expect(fixture.controller.save({
      serverName: 'local', transport: 'stdio', command: 'node', env: { TOKEN: ref }, reconnect, enabled: false,
    }, undefined, { [ref]: 'secret' })).rejects.toThrow('settings update failed')
    expect(fixture.stored.has(ref)).toBe(false)
    expect(fixture.unset).toHaveBeenCalledWith(ref)
  })

  it('rejects credential values not referenced by the saved server', async () => {
    const fixture = controllerFixture({ mcpServers: [] })
    await expect(fixture.controller.save({
      serverName: 'local', transport: 'stdio', command: 'node', env: {}, reconnect, enabled: false,
    }, undefined, { UNRELATED_SECRET: 'secret' })).rejects.toThrow(/not referenced/)
    expect(fixture.set).not.toHaveBeenCalled()
  })

  it('stops reporting tools after the underlying registration disappears', async () => {
    const server = parseDesktopMcpServer({ serverName: 'local', transport: 'stdio', command: 'node', reconnect, enabled: true })
    const fixture = controllerFixture({ mcpServers: [server] })
    fixture.schemas.mockReturnValue([{ name: 'mcp__local__search', description: 'Search' }])
    await fixture.controller.test('local')
    expect((await fixture.controller.read()).mcpServers[0]?.tools).toHaveLength(1)
    fixture.schemas.mockReturnValue([])
    expect((await fixture.controller.read()).mcpServers[0]?.tools).toEqual([])
    await fixture.controller.dispose()
  })
})
