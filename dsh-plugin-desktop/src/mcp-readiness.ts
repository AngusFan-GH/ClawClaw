/** Configuration alone does not establish a usable MCP connection. */
export function isMcpServerReady(server: {
  readonly enabled: boolean
  readonly state: string
  readonly credentialsReady: boolean
  readonly tools: readonly unknown[]
}): boolean {
  return server.enabled && server.state === 'running' && server.credentialsReady && server.tools.length > 0
}
