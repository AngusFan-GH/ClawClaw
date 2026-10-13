export const MCP_CAPABILITY_IDS = [
  'source-control.github',
  'work-management.issues',
  'knowledge.search',
  'database.sql',
  'browser.automation',
  'communication.team',
  'market-data.finance',
  'diagram.authoring',
  'public-data.research',
  'scientific-data.protein',
  'developer.documentation',
  'commerce.shopline',
] as const

export type McpCapabilityId = typeof MCP_CAPABILITY_IDS[number]

export interface McpCapabilityServer {
  readonly serverName: string
  readonly capabilities?: readonly string[]
}

const CAPABILITY_ALIASES: Readonly<Record<McpCapabilityId, readonly string[]>> = {
  'source-control.github': ['github', 'gitlab', 'gitee', 'coding'],
  'work-management.issues': ['jira', 'linear', 'asana', 'trello'],
  'knowledge.search': ['notion', 'confluence', 'lark', 'feishu'],
  'database.sql': ['postgres', 'postgresql', 'mysql', 'sqlite', 'snowflake', 'bigquery'],
  'browser.automation': ['browser', 'playwright', 'chrome', 'search', 'web'],
  'communication.team': ['slack', 'teams', 'lark', 'feishu'],
  'market-data.finance': ['market', 'market-data', 'finance', 'stocks', 'tdx'],
  'diagram.authoring': ['drawio', 'draw-io', 'diagrams'],
  'public-data.research': ['world-bank-data360', 'data360', 'public-data'],
  'scientific-data.protein': ['rcsb-pdb', 'pdb', 'protein-data'],
  'developer.documentation': ['context7', 'developer-docs', 'api-docs'],
  'commerce.shopline': ['shopline-developer-mcp', 'shopline'],
}

export const MCP_CAPABILITY_DEFAULT_SERVER: Readonly<Record<McpCapabilityId, string>> = {
  'source-control.github': 'github',
  'work-management.issues': 'jira',
  'knowledge.search': 'notion',
  'database.sql': 'postgresql',
  'browser.automation': 'playwright',
  'communication.team': 'slack',
  'market-data.finance': 'market-data',
  'diagram.authoring': 'drawio',
  'public-data.research': 'world-bank-data360',
  'scientific-data.protein': 'rcsb-pdb',
  'developer.documentation': 'context7',
  'commerce.shopline': 'shopline-developer-mcp',
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll('_', '-')
}

/** Resolve a stable product capability to a configured server, retaining legacy name aliases as a fallback. */
export function resolveMcpCapabilityServer(
  capability: McpCapabilityId,
  configured: readonly (string | McpCapabilityServer)[],
): string {
  const servers = configured.map(item => typeof item === 'string'
    ? { serverName: item, capabilities: [] as readonly string[] }
    : item)
  const declared = servers.find(server => server.capabilities?.includes(capability))
  if (declared !== undefined) return declared.serverName
  const aliases = new Set(CAPABILITY_ALIASES[capability].map(normalize))
  return servers.find(server => aliases.has(normalize(server.serverName)))?.serverName
    ?? MCP_CAPABILITY_DEFAULT_SERVER[capability]
}
