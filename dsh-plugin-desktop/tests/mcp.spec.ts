import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { describe, expect, it, vi } from 'vitest'
import {
  DesktopMcpController, DesktopMcpSettingsSchema, importMcpServersDocument, materializeCatalogConnector, mcpCredentialReference, parseDesktopMcpServer,
  type DesktopMcpSettings,
} from '../src/mcp.ts'
import { DESKTOP_MCP_CATALOG } from '../src/mcp-catalog.ts'
import { MCP_CAPABILITY_IDS } from '../src/mcp-capabilities.ts'

const reconnect = { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 }

function controllerFixture(initial: DesktopMcpSettings, options: { failUpdate?: boolean, failSetRef?: string, validateSchema?: boolean } = {}) {
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
    if (patch.mcpServers !== undefined) {
      const next = { mcpServers: patch.mcpServers }
      if (options.validateSchema) DesktopMcpSettingsSchema(next)
      value = next
    }
  })
  const fiber = Object.assign(Promise.resolve(), { dispose: vi.fn(async () => {}) })
  const plugin = vi.fn(() => fiber)
  const ctx = { credentials: { resolve: async (ref: string) => {
    const secret = stored.get(ref); return secret === undefined ? undefined : { value: secret, source: 'test' }
  }, set, unset }, tools: { schemas }, plugin, logger: { error: vi.fn() } } as unknown as Context
  const settings = { get: () => value, update, watch: vi.fn(() => () => {}) } as unknown as SettingsScope<DesktopMcpSettings>
  return { controller: new DesktopMcpController(ctx, settings), stored, schemas, set, unset, update, plugin }
}

describe('Desktop MCP', () => {
  it('keeps every catalog connector valid, unique, and reference-only', () => {
    const capabilities = new Set<string>(MCP_CAPABILITY_IDS)
    expect(new Set(DESKTOP_MCP_CATALOG.map(entry => entry.id)).size).toBe(DESKTOP_MCP_CATALOG.length)
    expect(new Set(DESKTOP_MCP_CATALOG.map(entry => entry.server.serverName)).size).toBe(DESKTOP_MCP_CATALOG.length)
    for (const entry of DESKTOP_MCP_CATALOG) {
      expect(entry.server.connectorId).toBe(entry.id)
      expect(entry.server.capabilities).toEqual(entry.capabilities)
      expect(entry.capabilities.every(capability => capabilities.has(capability))).toBe(true)
      expect(() => new URL(entry.sourceUrl)).not.toThrow()
      expect(entry.credentials.every(field => field.target === (entry.server.transport === 'stdio' ? 'env' : 'header'))).toBe(true)
      const values = Object.fromEntries(entry.credentials.map(field => [field.id, `secret-${entry.id}-${field.id}`]))
      const materialized = materializeCatalogConnector(entry, values)
      expect(() => parseDesktopMcpServer(materialized.server)).not.toThrow()
      expect(JSON.stringify(materialized.server)).not.toContain(`secret-${entry.id}`)
      expect(Object.keys(materialized.secrets)).toHaveLength(entry.credentials.length)
    }
  })

  it('installs every catalog connector through the real settings schema', async () => {
    const fixture = controllerFixture({ mcpServers: [] }, { validateSchema: true })
    for (const entry of DESKTOP_MCP_CATALOG) {
      const values = Object.fromEntries(entry.credentials.map(field => [field.id, `secret-${entry.id}-${field.id}`]))
      const view = await fixture.controller.install(entry.id, values)
      expect(view.mcpServers.find(server => server.connectorId === entry.id)).toBeDefined()
      expect(view.catalog.find(item => item.id === entry.id)?.installedServerName).toBe(entry.server.serverName)
    }
    expect(fixture.update).toHaveBeenCalledTimes(DESKTOP_MCP_CATALOG.length)
    await fixture.controller.dispose()
  })

  it('installs PostgreSQL without an inline connection string for local profile discovery', () => {
    const postgres = DESKTOP_MCP_CATALOG.find(entry => entry.id === 'postgresql')!
    const materialized = materializeCatalogConnector(postgres, {})
    expect(materialized.server).toEqual(expect.objectContaining({
      serverName: 'postgresql',
      command: 'npx',
      args: ['-y', '@microsoft/postgres-mcp@0.2.0', 'run'],
      env: {},
      capabilities: ['database.sql'],
    }))
    expect(materialized.secrets).toEqual({})
  })

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
    expect(() => parseDesktopMcpServer({
      serverName: 'remote', transport: 'streamable-http', url: 'http://example.com/mcp', enabled: true,
    })).toThrow(/must use HTTPS/)
    expect(() => parseDesktopMcpServer({
      serverName: 'deceptive', transport: 'streamable-http', url: 'http://127.example.com/mcp', enabled: true,
    })).toThrow(/must use HTTPS/)
    expect(() => parseDesktopMcpServer({
      serverName: 'local_http', transport: 'streamable-http', url: 'http://127.0.0.1:3000/mcp', enabled: true,
    })).not.toThrow()
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

  it.each(['sse', 'streamable-http'] as const)('validates %s URLs and reports configuration mistakes without exposing secrets', transport => {
    const valid = { serverName: 'kb-matrix', transport, url: 'http://127.0.0.1:6061/sse', headers: { Authorization: 'MCP_TOKEN' } }
    expect(parseDesktopMcpServer(valid)).toMatchObject({ transport, headers: { Authorization: 'MCP_TOKEN' } })
    expect(() => parseDesktopMcpServer({ ...valid, url: 'http://remote.example/sse' })).toThrow(/HTTPS/)
    expect(() => parseDesktopMcpServer({ ...valid, url: 'https://user:secret@example.com/sse' })).toThrow(/embedded credentials/)
    expect(() => parseDesktopMcpServer({ ...valid, serverName: '数据库和术语库' })).toThrow(/serverName must contain/)
    expect(() => parseDesktopMcpServer({ ...valid, headers: { Authorization: 'Bearer sensitive-value' } })).toThrow(/credential reference names/)
    try { parseDesktopMcpServer({ ...valid, headers: { Authorization: 'Bearer sensitive-value' } }) } catch (cause) {
      expect(String(cause)).not.toContain('sensitive-value')
    }
  })

  it.each([{ type: 'sse' }, { transport: 'sse' }, { type: 'http' }, {}])('imports remote transport %j and stores header secrets separately', declaration => {
    const [imported] = importMcpServersDocument({ mcpServers: { kb: { ...declaration, url: 'https://example.com/sse', headers: { Authorization: 'Bearer test-value' } } } })
    expect(imported?.server).toMatchObject({ transport: Object.values(declaration)[0] === 'sse' ? 'sse' : 'streamable-http',
      headers: { Authorization: mcpCredentialReference('kb', 'Authorization') } })
    expect(imported?.secrets).toEqual({ [mcpCredentialReference('kb', 'Authorization')]: 'Bearer test-value' })
    expect(JSON.stringify(imported?.server)).not.toContain('test-value')
  })

  it.each([{ type: 'websocket' }, { type: 'sse', transport: 'stdio' }, { type: 'sse', command: 'node' }])('rejects ambiguous or unsupported imports %j', declaration => {
    expect(() => importMcpServersDocument({ mcpServers: { kb: { ...declaration, url: 'https://example.com/sse' } } })).toThrow()
  })

  it('starts SSE through the desktop bridge with resolved headers and preserves its saved transport', async () => {
    const fixture = controllerFixture({ mcpServers: [] }, { validateSchema: true })
    const view = await fixture.controller.save({ serverName: 'sse-test', transport: 'sse', url: 'https://example.com/sse', headers: { Authorization: 'MCP_TOKEN' } }, undefined, { MCP_TOKEN: 'Bearer test-secret' })
    expect(view.mcpServers[0]).toMatchObject({ transport: 'sse', state: 'running', headers: { Authorization: 'MCP_TOKEN' } })
    expect(fixture.plugin).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ transport: 'stdio', command: process.execPath,
      args: [expect.stringContaining('mcp-sse-bridge.js')], env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1', CLAWCLAW_MCP_SSE_HEADERS: JSON.stringify({ Authorization: 'Bearer test-secret' }) }) }))
    expect(JSON.stringify(view)).not.toContain('test-secret')
    await fixture.controller.dispose()
  })

  it('keeps normalized credential references distinct', () => {
    expect(mcpCredentialReference('foo-bar', 'TOKEN')).not.toBe(mcpCredentialReference('foo_bar', 'TOKEN'))
    expect(mcpCredentialReference('Foo', 'TOKEN')).not.toBe(mcpCredentialReference('foo', 'TOKEN'))
    expect(mcpCredentialReference('remote', 'X-A')).not.toBe(mcpCredentialReference('remote', 'X_A'))
  })

  it('materializes catalog credentials as references without persisting the raw token in settings', () => {
    const github = DESKTOP_MCP_CATALOG.find(entry => entry.id === 'github')!
    const installed = materializeCatalogConnector(github, { token: 'github-secret' })
    expect(installed.server).toEqual(expect.objectContaining({ connectorId: 'github', capabilities: ['source-control.github'],
      headers: { Authorization: expect.stringMatching(/^MCP_GITHUB_AUTHORIZATION_/u) } }))
    expect(JSON.stringify(installed.server)).not.toContain('github-secret')
    expect(Object.values(installed.secrets)).toEqual(['Bearer github-secret'])
  })

  it('installs a catalog connector through the single desktop controller', async () => {
    const fixture = controllerFixture({ mcpServers: [] })
    const view = await fixture.controller.install('playwright', {})
    expect(view.mcpServers).toEqual([expect.objectContaining({ serverName: 'playwright', connectorId: 'playwright', capabilities: ['browser.automation'] })])
    expect(view.catalog.find(entry => entry.id === 'playwright')?.installedServerName).toBe('playwright')
  })

  it('persists a GitHub catalog connector through the real settings schema', async () => {
    const fixture = controllerFixture({ mcpServers: [] }, { validateSchema: true })
    const view = await fixture.controller.install('github', { token: 'github-secret' })
    const ref = mcpCredentialReference('github', 'Authorization')
    expect(view.mcpServers).toEqual([expect.objectContaining({
      serverName: 'github', connectorId: 'github', headers: { Authorization: ref }, capabilities: ['source-control.github'],
    })])
    expect(fixture.stored.get(ref)).toBe('Bearer github-secret')
    expect(JSON.stringify(fixture.update.mock.calls)).not.toContain('github-secret')
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

  it('cleans up only MCP-managed credentials after edit and removal', async () => {
    const fixture = controllerFixture({ mcpServers: [] })
    await fixture.controller.save({
      serverName: 'local', transport: 'stdio', command: 'node', env: { TOKEN: 'OWNED_TOKEN', SHARED: 'SHARED_TOKEN' }, reconnect, enabled: false,
    }, undefined, { OWNED_TOKEN: 'owned', SHARED_TOKEN: 'shared' })
    await fixture.controller.save({
      serverName: 'consumer', transport: 'stdio', command: 'node', env: { TOKEN: 'SHARED_TOKEN' }, reconnect, enabled: false,
    })
    await fixture.controller.save({
      serverName: 'local', transport: 'stdio', command: 'node', env: {}, reconnect, enabled: false,
    }, 'local')
    expect(fixture.stored.has('OWNED_TOKEN')).toBe(false)
    expect(fixture.stored.get('SHARED_TOKEN')).toBe('shared')
    await fixture.controller.remove('consumer')
    expect(fixture.stored.has('SHARED_TOKEN')).toBe(false)
  })

  it('removes managed credentials when their owning MCP server is removed', async () => {
    const fixture = controllerFixture({ mcpServers: [] })
    await fixture.controller.save({
      serverName: 'local', transport: 'stdio', command: 'node', env: { TOKEN: 'OWNED_TOKEN' }, reconnect, enabled: false,
    }, undefined, { OWNED_TOKEN: 'owned' })
    expect((await fixture.controller.read()).mcpServers[0]?.managedCredentialRefs).toEqual(['OWNED_TOKEN'])
    await fixture.controller.remove('local')
    expect(fixture.stored.has('OWNED_TOKEN')).toBe(false)
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

  it('reports discovery readiness and restores disabled state after a successful probe', async () => {
    const server = parseDesktopMcpServer({ serverName: 'local', transport: 'stdio', command: 'node', reconnect, enabled: false })
    const fixture = controllerFixture({ mcpServers: [server] })
    fixture.schemas.mockReturnValue([{ name: 'mcp__local__search', description: 'Search' }])
    const view = await fixture.controller.test('local')
    expect(view.mcpServers[0]).toMatchObject({ enabled: false, state: 'disabled', diagnostic: {
      code: 'disabled', stage: 'configuration', checkedAt: expect.any(Number), lastSuccessfulAt: expect.any(Number),
    } })
    await fixture.controller.dispose()
  })

  it('distinguishes a live connection that is still waiting for tool discovery', async () => {
    const server = parseDesktopMcpServer({ serverName: 'local', transport: 'stdio', command: 'node', reconnect, enabled: true })
    const fixture = controllerFixture({ mcpServers: [server] })
    await fixture.controller.test('local')
    expect((await fixture.controller.read()).mcpServers[0]?.diagnostic).toMatchObject({ code: 'tools-pending', stage: 'discovery' })
    await fixture.controller.dispose()
  })

  it.each(['streamable-http', 'sse'] as const)('completes %s OAuth PKCE into the credential store and injects only a runtime bearer header', async transport => {
    const server = parseDesktopMcpServer({ serverName: 'oauth', transport, url: 'https://mcp.example.com/mcp', headers: {},
      oauth: { issuer: 'https://identity.example.com', scope: 'mcp:tools', resource: 'https://mcp.example.com/' }, reconnect, enabled: true })
    const fixture = controllerFixture({ mcpServers: [server] })
    expect((await fixture.controller.test('oauth')).mcpServers[0]?.diagnostic.code).toBe('authorization-required')
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('.well-known')) return new Response(JSON.stringify({ issuer: 'https://identity.example.com',
        authorization_endpoint: 'https://identity.example.com/authorize', token_endpoint: 'https://identity.example.com/token',
        registration_endpoint: 'https://identity.example.com/register', code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'] }), { status: 200 })
      if (url.endsWith('/register')) return new Response(JSON.stringify({ client_id: 'client-id', token_endpoint_auth_method: 'none' }), { status: 200 })
      return new Response(JSON.stringify({ access_token: 'access-secret', refresh_token: 'refresh-secret', token_type: 'Bearer', expires_in: 3600 }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const started = await fixture.controller.beginOAuth('oauth', 'http://127.0.0.1:3210/api/desktop/mcp/oauth/callback')
    const state = new URL(started.authorizationUrl).searchParams.get('state')!
    await fixture.controller.completeOAuth(state, 'authorization-code')
    const storedGrant = fixture.stored.get(mcpCredentialReference('oauth', 'OAUTH_GRANT'))!
    expect(storedGrant).toContain('access-secret')
    expect(JSON.stringify(server)).not.toMatch(/access-secret|refresh-secret/u)
    expect(fixture.plugin).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining(transport === 'sse'
      ? { env: expect.objectContaining({ CLAWCLAW_MCP_SSE_HEADERS: JSON.stringify({ Authorization: 'Bearer access-secret' }) }) }
      : { headers: { Authorization: 'Bearer access-secret' } }))
    await fixture.controller.dispose()
    vi.unstubAllGlobals()
  })

  it('discovers an omitted OAuth issuer from the MCP protected resource', async () => {
    const server = parseDesktopMcpServer({ serverName: 'oauth', transport: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: {},
      oauth: { scope: 'mcp:tools' }, reconnect, enabled: false })
    const fixture = controllerFixture({ mcpServers: [server] })
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url === 'https://mcp.example.com/mcp') return new Response('', { status: 401,
        headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"' } })
      if (url.includes('oauth-protected-resource')) return new Response(JSON.stringify({ resource: 'https://mcp.example.com/',
        authorization_servers: ['https://identity.example.com'] }), { status: 200 })
      if (url.includes('.well-known/oauth-authorization-server')) return new Response(JSON.stringify({ issuer: 'https://identity.example.com',
        authorization_endpoint: 'https://identity.example.com/authorize', token_endpoint: 'https://identity.example.com/token',
        registration_endpoint: 'https://identity.example.com/register', code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'] }), { status: 200 })
      return new Response(JSON.stringify({ client_id: 'client-id', token_endpoint_auth_method: 'none' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const started = await fixture.controller.beginOAuth('oauth', 'http://127.0.0.1:3210/api/desktop/mcp/oauth/callback')
    expect(started.authorizationUrl).toMatch(/^https:\/\/identity\.example\.com\/authorize/u)
    expect(new URL(started.authorizationUrl).searchParams.get('resource')).toBe('https://mcp.example.com/')
    vi.unstubAllGlobals()
  })

  it('uses a pre-registered OAuth client when dynamic registration is unavailable', async () => {
    const secretRef = 'MCP_OAUTH_CLIENT_SECRET'
    const server = parseDesktopMcpServer({ serverName: 'oauth', transport: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: {},
      oauth: { issuer: 'https://identity.example.com', scope: 'mcp:tools', clientId: 'desktop-client',
        clientSecretRef: secretRef, tokenEndpointAuthMethod: 'client_secret_basic' }, reconnect, enabled: false })
    const fixture = controllerFixture({ mcpServers: [server] })
    fixture.stored.set(secretRef, 'client-secret')
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('.well-known')) return new Response(JSON.stringify({ issuer: 'https://identity.example.com',
        authorization_endpoint: 'https://identity.example.com/authorize', token_endpoint: 'https://identity.example.com/token',
        code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_basic'] }), { status: 200 })
      expect(init?.headers).toMatchObject({ Authorization: expect.stringMatching(/^Basic /u) })
      return new Response(JSON.stringify({ access_token: 'access-secret', token_type: 'Bearer', expires_in: 3600 }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const started = await fixture.controller.beginOAuth('oauth', 'http://127.0.0.1:3210/api/desktop/mcp/oauth/callback')
    expect(new URL(started.authorizationUrl).searchParams.get('client_id')).toBe('desktop-client')
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/register'))).toBe(false)
    await fixture.controller.completeOAuth(new URL(started.authorizationUrl).searchParams.get('state')!, 'code')
    expect(fixture.stored.get(mcpCredentialReference('oauth', 'OAUTH_GRANT'))).toContain('access-secret')
    vi.unstubAllGlobals()
  })

  it('revokes and removes the stored grant when an OAuth server is disconnected', async () => {
    const server = parseDesktopMcpServer({ serverName: 'oauth', transport: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: {},
      oauth: { issuer: 'https://identity.example.com', scope: 'mcp:tools' }, reconnect, enabled: true })
    const fixture = controllerFixture({ mcpServers: [server] })
    fixture.stored.set(mcpCredentialReference('oauth', 'OAUTH_GRANT'), JSON.stringify({ issuer: 'https://identity.example.com',
      tokenEndpoint: 'https://identity.example.com/token', revocationEndpoint: 'https://identity.example.com/revoke',
      clientId: 'client-id', tokenEndpointAuthMethod: 'none', accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 60_000 }))
    const fetcher = vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    await fixture.controller.toggle('oauth', false)
    expect(fetcher).toHaveBeenCalledWith('https://identity.example.com/revoke', expect.objectContaining({ method: 'POST',
      body: expect.stringContaining('token=refresh') }))
    expect(fixture.stored.has(mcpCredentialReference('oauth', 'OAUTH_GRANT'))).toBe(false)
    expect(fixture.unset).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('still clears local authorization when remote revocation is unavailable', async () => {
    const server = parseDesktopMcpServer({ serverName: 'oauth', transport: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: {},
      oauth: { issuer: 'https://identity.example.com', scope: 'mcp:tools' }, reconnect, enabled: true })
    const fixture = controllerFixture({ mcpServers: [server] })
    const ref = mcpCredentialReference('oauth', 'OAUTH_GRANT')
    fixture.stored.set(ref, JSON.stringify({ issuer: 'https://identity.example.com', tokenEndpoint: 'https://identity.example.com/token',
      revocationEndpoint: 'https://identity.example.com/revoke', clientId: 'client-id', tokenEndpointAuthMethod: 'none', accessToken: 'access' }))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(fixture.controller.toggle('oauth', false)).resolves.toBeDefined()
    expect(fixture.stored.has(ref)).toBe(false)
    vi.unstubAllGlobals()
  })

  it('backs off and retries a temporary OAuth refresh failure', async () => {
    vi.useFakeTimers()
    const server = parseDesktopMcpServer({ serverName: 'oauth', transport: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: {},
      oauth: { issuer: 'https://identity.example.com', scope: 'mcp:tools' }, reconnect, enabled: true })
    const fixture = controllerFixture({ mcpServers: [server] })
    fixture.stored.set(mcpCredentialReference('oauth', 'OAUTH_GRANT'), JSON.stringify({ issuer: 'https://identity.example.com',
      tokenEndpoint: 'https://identity.example.com/token', clientId: 'client-id', tokenEndpointAuthMethod: 'none',
      accessToken: 'expired', refreshToken: 'refresh', expiresAt: Date.now() - 1 }))
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'temporarily_unavailable' }), { status: 503,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '1' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'fresh', token_type: 'Bearer', expires_in: 3_600 }), { status: 200,
        headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    expect((await fixture.controller.test('oauth')).mcpServers[0]?.diagnostic.code).toBe('connection-failed')
    expect(fixture.plugin).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => { expect(fixture.plugin).toHaveBeenCalled() })
    expect((await fixture.controller.read()).mcpServers[0]?.diagnostic.code).toBe('tools-pending')
    await fixture.controller.dispose()
    vi.useRealTimers(); vi.unstubAllGlobals()
  })
})
