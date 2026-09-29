import {
  DESKTOP_MCP_ACTION_PATH, DESKTOP_MCP_PATH,
  type DesktopMcpServerConfig, type DesktopMcpServerView, type DesktopMcpView,
} from '../mcp-contract.ts'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function text(value: unknown, max = 16_384): value is string { return typeof value === 'string' && value.length <= max }
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
  const status = { state: value.state as DesktopMcpServerView['state'], tools: Object.freeze(tools), credentialsReady: value.credentialsReady,
    ...(value.error === undefined ? {} : { error: value.error }) }
  return Object.freeze(value.transport === 'stdio'
    ? { serverName: value.serverName, transport: value.transport, command: value.command as string,
        args: Object.freeze([...(value.args as string[])]), cwd: text(value.cwd, 8_192) ? value.cwd : '', env: refs(value.env ?? {}),
        timeoutMs: value.timeoutMs as number, reconnect, enabled: value.enabled, ...status }
    : { serverName: value.serverName, transport: value.transport, url: value.url as string, headers: refs(value.headers ?? {}),
        timeoutMs: value.timeoutMs as number, reconnect, enabled: value.enabled, ...status })
}
export function parseDesktopMcpView(value: unknown): DesktopMcpView {
  if (!isRecord(value) || !Array.isArray(value.mcpServers) || value.mcpServers.length > 64) {
    throw new Error('dsh-plugin-desktop: invalid MCP response')
  }
  const mcpServers = value.mcpServers.map(parseMcpServer)
  if (new Set(mcpServers.map(server => server.serverName)).size !== mcpServers.length) {
    throw new Error('dsh-plugin-desktop: duplicate MCP response row')
  }
  return Object.freeze({ mcpServers: Object.freeze(mcpServers) })
}
async function readResponse(response: Response): Promise<unknown> {
  let value: unknown
  try { value = await response.json() as unknown } catch { throw new Error('MCP response was not JSON') }
  if (!response.ok) throw new Error(isRecord(value) && typeof value.error === 'string' ? value.error : `HTTP ${String(response.status)}`)
  return value
}
export interface DesktopMcpApi {
  read(): Promise<readonly DesktopMcpServerView[]>
  save(server: DesktopMcpServerConfig, previousName?: string, secrets?: Readonly<Record<string, string>>): Promise<readonly DesktopMcpServerView[]>
  remove(serverName: string): Promise<readonly DesktopMcpServerView[]>
  toggle(serverName: string, enabled: boolean): Promise<readonly DesktopMcpServerView[]>
  test(serverName: string): Promise<readonly DesktopMcpServerView[]>
  import(document: unknown): Promise<readonly DesktopMcpServerView[]>
}
export function createDesktopMcpApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): DesktopMcpApi {
  const post = async (body: object): Promise<readonly DesktopMcpServerView[]> => parseDesktopMcpView(await readResponse(await fetcher(
    DESKTOP_MCP_ACTION_PATH, { method: 'POST', credentials: 'same-origin', redirect: 'error',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  ))).mcpServers
  return Object.freeze({
    async read() {
      const value = await readResponse(await fetcher(DESKTOP_MCP_PATH, { method: 'GET', credentials: 'same-origin',
        redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } }))
      return parseDesktopMcpView(value).mcpServers
    },
    save: (server: DesktopMcpServerConfig, previousName?: string, secrets?: Readonly<Record<string, string>>) => post({ action: 'save', server, ...(previousName === undefined ? {} : { previousName }), ...(secrets === undefined ? {} : { secrets }) }),
    remove: (serverName: string) => post({ action: 'remove', serverName }),
    toggle: (serverName: string, enabled: boolean) => post({ action: 'toggle', serverName, enabled }),
    test: (serverName: string) => post({ action: 'test', serverName }),
    import: (document: unknown) => post({ action: 'import', document }),
  })
}
