export const DESKTOP_MCP_PATH = '/api/desktop/mcp'
export const DESKTOP_MCP_ACTION_PATH = '/api/desktop/mcp/action'
export const DESKTOP_MCP_OAUTH_CALLBACK_PATH = '/api/desktop/mcp/oauth/callback'

export interface DesktopMcpOAuthConfig {
  /** Optional explicit issuer. When omitted, it is discovered from the MCP protected resource. */
  readonly issuer?: string
  readonly scope: string
  readonly resource?: string
}

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
  readonly connectorId?: string
  readonly capabilities?: readonly string[]
} | {
  readonly serverName: string
  readonly transport: 'streamable-http'
  readonly url: string
  /** HTTP header to credential-reference mapping; values never leave the Host. */
  readonly headers: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly reconnect: DesktopMcpReconnect
  readonly enabled: boolean
  readonly connectorId?: string
  readonly capabilities?: readonly string[]
  readonly oauth?: DesktopMcpOAuthConfig
}

export interface DesktopMcpReconnect {
  readonly enabled: boolean
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly maxAttempts: number
}

export interface DesktopMcpToolView { readonly name: string, readonly description: string }
export type DesktopMcpDiagnosticCode = 'disabled' | 'connecting' | 'credentials-missing' | 'authorization-required' | 'connection-failed' | 'tools-pending' | 'ready'
export interface DesktopMcpDiagnosticView {
  readonly code: DesktopMcpDiagnosticCode
  readonly stage: 'configuration' | 'credentials' | 'authorization' | 'connection' | 'discovery' | 'ready'
  readonly checkedAt?: number
  readonly lastSuccessfulAt?: number
}
export type DesktopMcpServerView = DesktopMcpServerConfig & {
  readonly state: 'disabled' | 'starting' | 'running' | 'error'
  readonly tools: readonly DesktopMcpToolView[]
  readonly error?: string
  /** Credential references which currently resolve, never credential values. */
  readonly credentialsReady: boolean
  readonly diagnostic: DesktopMcpDiagnosticView
}
export interface DesktopMcpCatalogCredential {
  readonly id: string
  readonly label: string
  readonly target: 'env' | 'header'
  readonly targetName: string
  readonly secret: boolean
  readonly required: boolean
}
export interface DesktopMcpCatalogEntry {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly category: string
  readonly sourceUrl: string
  readonly license: string
  readonly capabilities: readonly string[]
  readonly credentials: readonly DesktopMcpCatalogCredential[]
  readonly server: DesktopMcpServerConfig
  readonly installedServerName?: string
}
export interface DesktopMcpView {
  readonly mcpServers: readonly DesktopMcpServerView[]
  readonly catalog: readonly DesktopMcpCatalogEntry[]
}
