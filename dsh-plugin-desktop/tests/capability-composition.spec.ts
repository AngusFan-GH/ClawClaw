import { describe, expect, it } from 'vitest'
import { mergeCapabilityBindings, teamCapabilityBindings } from '../src/experts/capability-composition.ts'
import { projectTeamCapabilityRecord } from '../src/experts/team-library.ts'
import { expertCapabilityCatalog, expertCapabilityHealth, selectableExpertCapabilities } from '../src/experts/client/capability-options.ts'
import { teamRepairIssue } from '../src/experts/client/team-shared.tsx'
import { BUILTIN_TEAMS } from '../src/experts/team-contract.ts'
import type { ExpertSummary } from '../src/experts/expert-contract.ts'
import type { DesktopMcpServerView } from '../src/mcp-contract.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { DESKTOP_MCP_LIFECYCLE_SERVICE } from '../src/mcp-contract.ts'
import { resolveExpertComposition } from '../src/experts/index.ts'

const bind = (name: string, required = true, enabled = true) => ({ name, required, enabled })
const server: DesktopMcpServerView = {
  serverName: 'company-db', connectorId: 'postgresql', transport: 'stdio', command: 'db', args: [], cwd: '', env: {}, timeoutMs: 1000,
  reconnect: { enabled: false, initialDelayMs: 100, maxDelayMs: 1000, maxAttempts: 1 },
  enabled: true, state: 'running', credentialsReady: true, tools: [{ name: 'mcp__company-db__query', description: '' }],
  diagnostic: { code: 'ready', stage: 'ready' },
}
const experts: ExpertSummary[] = ['analyst', 'reviewer'].map(slug => ({
  slug, name: slug, nameEn: slug, description: '', descriptionEn: '', emoji: '', division: 'support', divisionZh: '支持', custom: false,
  skills: [bind('data-analysis')], mcpServers: [bind('company-db')],
}))
const team = { ...structuredClone(BUILTIN_TEAMS[0]!), members: experts.map(expert => ({ expertSlug: expert.slug, duty: 'Review', instructions: 'Check evidence' })) }

describe('shared Team Skill MCP readiness', () => {
  it('unions member requirements without escalating disabled requirements or mutating members', () => {
    expect(mergeCapabilityBindings([bind('docs', true, false)], [bind('docs', false)])).toEqual([bind('docs', false)])
    expect(mergeCapabilityBindings([bind('docs', false)], [bind('docs')])).toEqual([bind('docs')])
    expect(teamCapabilityBindings(team, experts)).toEqual({ skills: [bind('data-analysis')], mcpServers: [bind('company-db')] })
    expect(team.skills).toEqual([])
  })

  it('projects builtin/custom teams with member dependencies, credentials and discovered tool counts', () => {
    const projected = projectTeamCapabilityRecord(team, experts, { mcpServers: [server], catalog: [] })
    expect(projected.skills).toEqual([bind('data-analysis')])
    expect(projected.connectors).toEqual([bind('company-db')])
    expect(projected.connectorStates).toEqual([expect.objectContaining({ dependency: 'company-db', credentialsReady: true, toolCount: 1 })])
    expect(teamRepairIssue(projected, experts)).toBeUndefined()
  })

  it('deduplicates a package connector id and its configured member server alias', () => {
    const projected = projectTeamCapabilityRecord({ ...team, connectors: [bind('postgresql')] }, experts, { mcpServers: [server], catalog: [] })
    expect(projected.connectors).toEqual([bind('postgresql')])
    expect(projected.connectorStates[0]).toMatchObject({ dependency: 'postgresql', serverName: 'company-db', toolCount: 1 })
  })

  it.each([
    { enabled: false }, { credentialsReady: false }, { tools: [] }, { state: 'starting' as const }, { state: 'error' as const },
  ])('does not advertise or select a connector that is not usable: %j', override => {
    const item = { ...server, ...override }
    const projected = projectTeamCapabilityRecord(team, experts, { mcpServers: [item], catalog: [] })
    const catalog = expertCapabilityCatalog([], [item])
    expect(catalog.mcpServers[0]?.available).toBe(false)
    expect(selectableExpertCapabilities([], [item]).mcpServers).toEqual([])
    expect(teamRepairIssue(projected, experts)).toBe('必需连接器未就绪')
  })

  it.each([{ enabled: false }, { credentialsReady: false }, { tools: [] }])('rejects stale schemas when managed connection readiness is invalid: %j', async override => {
    const ctx = {
      get: (name: string) => name === DESKTOP_MCP_LIFECYCLE_SERVICE ? { read: async () => ({ mcpServers: [{ ...server, ...override }], catalog: [] }) } : undefined,
      tools: { schemas: () => [{ name: 'mcp__company-db__query' }, { name: 'mcp__other__query' }] },
    } as unknown as Context
    const parent = { session: { header: { cwd: '/workspace' } } } as unknown as Agent
    await expect(resolveExpertComposition(ctx, { skills: [], mcpServers: [bind('company-db')] }, parent, '')).rejects.toThrow('MCP server unavailable: company-db')
    const optional = await resolveExpertComposition(ctx, { skills: [], mcpServers: [bind('company-db', false)] }, parent, '')
    expect(optional.diagnostics).toEqual(['MCP server unavailable: company-db'])
    expect(optional.deniedTools).toEqual(expect.arrayContaining(['mcp__company-db__query', 'mcp__other__query']))
  })

  it('keeps optional access gaps usable but blocks required Skills and unknown state', () => {
    const catalog = expertCapabilityCatalog([], [])
    expect(expertCapabilityHealth({ skills: [], mcpServers: [bind('company-db', false)] }, catalog).state).toBe('degraded')
    const health = expertCapabilityHealth({ skills: [bind('data-analysis')], mcpServers: [] }, catalog)
    expect(teamRepairIssue(team, experts, health)).toBe('必需能力未就绪')
    expect(teamRepairIssue(team, experts, { ...health, state: 'unknown' })).toBe('能力检查中')
  })
})
