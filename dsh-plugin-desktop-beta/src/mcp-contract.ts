export const DESKTOP_MCP_PATH = '/api/desktop/mcp'
export const DESKTOP_MCP_ACTION_PATH = '/api/desktop/mcp/action'

export type DesktopMcpServerConfig = {
  readonly serverName: string
  readonly transport: 'stdio'
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  /** Child environment variable to credential-reference mapping; values never leave the Host. */
  readonly env: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly reconnect: DesktopMcpReconnect
  readonly enabled: boolean
} | {
  readonly serverName: string
  readonly transport: 'streamable-http'
  readonly url: string
  /** HTTP header to credential-reference mapping; values never leave the Host. */
  readonly headers: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly reconnect: DesktopMcpReconnect
  readonly enabled: boolean
}

export interface DesktopMcpReconnect {
  readonly enabled: boolean
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly maxAttempts: number
}

export interface DesktopMcpToolView { readonly name: string, readonly description: string }
export type DesktopMcpServerView = DesktopMcpServerConfig & {
  readonly state: 'disabled' | 'starting' | 'running' | 'error'
  readonly tools: readonly DesktopMcpToolView[]
  readonly error?: string
  /** Credential references which currently resolve, never credential values. */
  readonly credentialsReady: boolean
}
export interface DesktopMcpView { readonly mcpServers: readonly DesktopMcpServerView[] }
