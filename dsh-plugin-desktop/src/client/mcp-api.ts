import {
  DESKTOP_MCP_ACTION_PATH, DESKTOP_MCP_PATH,
  type DesktopMcpCatalogEntry, type DesktopMcpServerConfig, type DesktopMcpServerView, type DesktopMcpView,
} from '../mcp-contract.ts'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function text(value: unknown, max = 16_384): value is string { return typeof value === 'string' && value.length <= max }
function stringArray(value: unknown, max = 32): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every(item => text(item, 128))
}
function parseDiagnostic(value: unknown): DesktopMcpServerView['diagnostic'] {
  const codes = ['disabled', 'connecting', 'credentials-missing', 'authorization-required', 'connection-failed', 'tools-pending', 'ready']
  const stages = ['configuration', 'credentials', 'authorization', 'connection', 'discovery', 'ready']
  if (!isRecord(value) || !codes.includes(String(value.code)) || !stages.includes(String(value.stage))
    || (value.checkedAt !== undefined && (!Number.isFinite(value.checkedAt) || (value.checkedAt as number) < 0))
    || (value.lastSuccessfulAt !== undefined && (!Number.isFinite(value.lastSuccessfulAt) || (value.lastSuccessfulAt as number) < 0))) {
    throw new Error('dsh-plugin-desktop: invalid MCP diagnostic response')
  }
  return Object.freeze({ code: value.code as DesktopMcpServerView['diagnostic']['code'], stage: value.stage as DesktopMcpServerView['diagnostic']['stage'],
    ...(value.checkedAt === undefined ? {} : { checkedAt: value.checkedAt as number }),
    ...(value.lastSuccessfulAt === undefined ? {} : { lastSuccessfulAt: value.lastSuccessfulAt as number }) })
}
function parseMcpServer(value: unknown): DesktopMcpServerView {
  if (!isRecord(value) || !text(value.serverName, 32) || value.serverName.length === 0
    || (value.transport !== 'stdio' && value.transport !== 'streamable-http') || typeof value.enabled !== 'boolean'
    || !['disabled', 'starting', 'running', 'error'].includes(String(value.state)) || !Array.isArray(value.tools) || value.tools.length > 1_024
    || (value.command !== undefined && !text(value.command, 2_048)) || (value.url !== undefined && !text(value.url, 4_096))
    || (value.error !== undefined && !text(value.error)) || (value.args !== undefined && (!Array.isArray(value.args)
      || value.args.length > 128 || value.args.some(arg => !text(arg, 4_096))))
    || (value.transport === 'stdio' && (!text(value.command, 2_048) || !Array.isArray(value.args)))
    || (value.transport === 'streamable-http' && !text(value.url, 4_096))) throw new Error('dsh-plugin-desktop: invalid MCP response')
  const tools = value.tools.map((tool) => {
    if (!isRecord(tool) || !text(tool.name, 256) || !text(tool.description)) throw new Error('dsh-plugin-desktop: invalid MCP tool response')
    return Object.freeze({ name: tool.name, description: tool.description })
  })
  const refs = (raw: unknown): Readonly<Record<string, string>> => {
    if (!isRecord(raw) || Object.keys(raw).length > 64 || Object.values(raw).some(item => !text(item, 256))) throw new Error('dsh-plugin-desktop: invalid MCP credential references')
    return Object.freeze(Object.fromEntries(Object.entries(raw) as [string, string][]))
  }
  if (!isRecord(value.reconnect) || typeof value.reconnect.enabled !== 'boolean' || !Number.isFinite(value.reconnect.initialDelayMs)
    || !Number.isFinite(value.reconnect.maxDelayMs) || !Number.isFinite(value.reconnect.maxAttempts) || !Number.isFinite(value.timeoutMs)
    || typeof value.credentialsReady !== 'boolean') throw new Error('dsh-plugin-desktop: invalid MCP connection response')
  const reconnect = Object.freeze({ enabled: value.reconnect.enabled, initialDelayMs: value.reconnect.initialDelayMs as number,
    maxDelayMs: value.reconnect.maxDelayMs as number, maxAttempts: value.reconnect.maxAttempts as number })
  if (value.connectorId !== undefined && !text(value.connectorId, 128)) throw new Error('dsh-plugin-desktop: invalid MCP connector identity')
  if (value.capabilities !== undefined && !stringArray(value.capabilities)) throw new Error('dsh-plugin-desktop: invalid MCP capabilities')
  if (value.oauth !== undefined && (!isRecord(value.oauth) || (value.oauth.issuer !== undefined && !text(value.oauth.issuer, 4_096)) || !text(value.oauth.scope, 2_048)
    || (value.oauth.resource !== undefined && !text(value.oauth.resource, 4_096)))) throw new Error('dsh-plugin-desktop: invalid MCP OAuth configuration')
  const metadata = { ...(value.connectorId === undefined ? {} : { connectorId: value.connectorId }),
    ...(value.capabilities === undefined ? {} : { capabilities: Object.freeze([...(value.capabilities as string[])]) }),
    ...(value.oauth === undefined ? {} : { oauth: Object.freeze({
      ...(value.oauth.issuer === undefined ? {} : { issuer: value.oauth.issuer as string }), scope: value.oauth.scope as string,
      ...(value.oauth.resource === undefined ? {} : { resource: value.oauth.resource as string }) }) }) }
  const status = { state: value.state as DesktopMcpServerView['state'], tools: Object.freeze(tools), credentialsReady: value.credentialsReady,
    diagnostic: parseDiagnostic(value.diagnostic),
    ...(value.error === undefined ? {} : { error: value.error }) }
  return Object.freeze(value.transport === 'stdio'
    ? { serverName: value.serverName, transport: value.transport, command: value.command as string,
        args: Object.freeze([...(value.args as string[])]), cwd: text(value.cwd, 8_192) ? value.cwd : '', env: refs(value.env ?? {}),
        timeoutMs: value.timeoutMs as number, reconnect, enabled: value.enabled, ...metadata, ...status }
    : { serverName: value.serverName, transport: value.transport, url: value.url as string, headers: refs(value.headers ?? {}),
        timeoutMs: value.timeoutMs as number, reconnect, enabled: value.enabled, ...metadata, ...status })
}
function parseCatalogEntry(value: unknown): DesktopMcpCatalogEntry {
  if (!isRecord(value) || !text(value.id, 128) || !text(value.name, 256) || !text(value.description)
    || !text(value.category, 128) || !text(value.sourceUrl, 4_096) || !text(value.license, 128)
    || !stringArray(value.capabilities) || !Array.isArray(value.credentials) || value.credentials.length > 32 || !isRecord(value.server)
    || (value.installedServerName !== undefined && !text(value.installedServerName, 32))) {
    throw new Error('dsh-plugin-desktop: invalid MCP catalog entry')
  }
  const credentials = value.credentials.map(field => {
    if (!isRecord(field) || !text(field.id, 128) || !text(field.label, 256)
      || (field.target !== 'env' && field.target !== 'header') || !text(field.targetName, 256)
      || typeof field.secret !== 'boolean' || typeof field.required !== 'boolean') throw new Error('dsh-plugin-desktop: invalid MCP catalog credential')
    return Object.freeze({ id: field.id, label: field.label, target: field.target, targetName: field.targetName, secret: field.secret, required: field.required })
  })
  const config = value.server
  const stateful = { ...config, state: 'disabled', tools: [], credentialsReady: true, enabled: config.enabled ?? true,
    diagnostic: { code: 'disabled', stage: 'configuration' } }
  const parsed = parseMcpServer(stateful)
  const { state: _state, tools: _tools, credentialsReady: _ready, diagnostic: _diagnostic, error: _error, ...server } = parsed
  return Object.freeze({ id: value.id, name: value.name, description: value.description, category: value.category,
    sourceUrl: value.sourceUrl, license: value.license, capabilities: Object.freeze([...value.capabilities]),
    credentials: Object.freeze(credentials), server, ...(value.installedServerName === undefined ? {} : { installedServerName: value.installedServerName }) })
}
export function parseDesktopMcpView(value: unknown): DesktopMcpView {
  if (!isRecord(value) || !Array.isArray(value.mcpServers) || value.mcpServers.length > 64) {
    throw new Error('dsh-plugin-desktop: invalid MCP response')
  }
  const mcpServers = value.mcpServers.map(parseMcpServer)
  if (new Set(mcpServers.map(server => server.serverName)).size !== mcpServers.length) {
    throw new Error('dsh-plugin-desktop: duplicate MCP response row')
  }
  const rawCatalog = value.catalog ?? []
  if (!Array.isArray(rawCatalog) || rawCatalog.length > 256) throw new Error('dsh-plugin-desktop: invalid MCP catalog response')
  const catalog = rawCatalog.map(parseCatalogEntry)
  if (new Set(catalog.map(entry => entry.id)).size !== catalog.length) throw new Error('dsh-plugin-desktop: duplicate MCP catalog entry')
  return Object.freeze({ mcpServers: Object.freeze(mcpServers), catalog: Object.freeze(catalog) })
}
async function readResponse(response: Response): Promise<unknown> {
  let value: unknown
  try { value = await response.json() as unknown } catch { throw new Error('MCP response was not JSON') }
  if (!response.ok) throw new Error(isRecord(value) && typeof value.error === 'string' ? value.error : `HTTP ${String(response.status)}`)
  return value
}
export interface DesktopMcpApi {
  read(): Promise<DesktopMcpView>
  save(server: DesktopMcpServerConfig, previousName?: string, secrets?: Readonly<Record<string, string>>): Promise<readonly DesktopMcpServerView[]>
  remove(serverName: string): Promise<readonly DesktopMcpServerView[]>
  toggle(serverName: string, enabled: boolean): Promise<readonly DesktopMcpServerView[]>
  test(serverName: string): Promise<readonly DesktopMcpServerView[]>
  import(document: unknown): Promise<readonly DesktopMcpServerView[]>
  install(connectorId: string, values?: Readonly<Record<string, string>>): Promise<DesktopMcpView>
  authorize(serverName: string): Promise<{ readonly authorizationUrl: string }>
}
export function createDesktopMcpApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): DesktopMcpApi {
  const postView = async (body: object): Promise<DesktopMcpView> => parseDesktopMcpView(await readResponse(await fetcher(
    DESKTOP_MCP_ACTION_PATH, { method: 'POST', credentials: 'same-origin', redirect: 'error',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  )))
  const post = async (body: object): Promise<readonly DesktopMcpServerView[]> => (await postView(body)).mcpServers
  return Object.freeze({
    async read() {
      const value = await readResponse(await fetcher(DESKTOP_MCP_PATH, { method: 'GET', credentials: 'same-origin',
        redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } }))
      return parseDesktopMcpView(value)
    },
    save: (server: DesktopMcpServerConfig, previousName?: string, secrets?: Readonly<Record<string, string>>) => post({ action: 'save', server, ...(previousName === undefined ? {} : { previousName }), ...(secrets === undefined ? {} : { secrets }) }),
    remove: (serverName: string) => post({ action: 'remove', serverName }),
    toggle: (serverName: string, enabled: boolean) => post({ action: 'toggle', serverName, enabled }),
    test: (serverName: string) => post({ action: 'test', serverName }),
    import: (document: unknown) => post({ action: 'import', document }),
    install: (connectorId: string, values: Readonly<Record<string, string>> = {}) => postView({ action: 'install', connectorId, values }),
    async authorize(serverName: string) {
      const value = await readResponse(await fetcher(DESKTOP_MCP_ACTION_PATH, { method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'oauth-start', serverName }) }))
      if (!isRecord(value) || !text(value.authorizationUrl, 8_192)) throw new Error('dsh-plugin-desktop: invalid MCP OAuth response')
      const url = new URL(value.authorizationUrl)
      if (url.protocol !== 'https:') throw new Error('dsh-plugin-desktop: insecure MCP OAuth response')
      return Object.freeze({ authorizationUrl: url.href })
    },
  })
}
