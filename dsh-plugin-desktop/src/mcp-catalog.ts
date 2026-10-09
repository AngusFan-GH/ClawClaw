import type { DesktopMcpCatalogEntry } from './mcp-contract.ts'

export interface DesktopMcpCatalogDefinition extends Omit<DesktopMcpCatalogEntry, 'installedServerName'> {
  readonly credentialPrefix?: Readonly<Record<string, string>>
}

export const DESKTOP_MCP_CATALOG: readonly DesktopMcpCatalogDefinition[] = Object.freeze([
  Object.freeze({
    id: 'playwright',
    name: 'Playwright Browser',
    description: 'Browser automation for navigation, inspection, screenshots, and web workflows.',
    category: 'development',
    sourceUrl: 'https://github.com/microsoft/playwright-mcp',
    license: 'Apache-2.0',
    capabilities: Object.freeze(['browser.automation']),
    credentials: Object.freeze([]),
    server: Object.freeze({
      serverName: 'playwright', transport: 'stdio', command: 'npx', args: Object.freeze(['-y', '@playwright/mcp@0.0.83']),
      cwd: '', env: Object.freeze({}), timeoutMs: 60_000,
      reconnect: Object.freeze({ enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 }), enabled: true,
      connectorId: 'playwright', capabilities: Object.freeze(['browser.automation']),
    }),
  }),
  Object.freeze({
    id: 'github',
    name: 'GitHub',
    description: 'Repository, issue, pull request, and source-control operations through GitHub MCP.',
    category: 'development',
    sourceUrl: 'https://github.com/github/github-mcp-server',
    license: 'MIT',
    capabilities: Object.freeze(['source-control.github']),
    credentials: Object.freeze([
      Object.freeze({ id: 'token', label: 'Personal access token', target: 'header', targetName: 'Authorization', secret: true, required: true }),
    ]),
    credentialPrefix: Object.freeze({ token: 'Bearer ' }),
    server: Object.freeze({
      serverName: 'github', transport: 'streamable-http', url: 'https://api.githubcopilot.com/mcp/', headers: Object.freeze({}),
      timeoutMs: 60_000, reconnect: Object.freeze({ enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 }), enabled: true,
      connectorId: 'github', capabilities: Object.freeze(['source-control.github']),
    }),
  }),
])
