import { describe, expect, it, vi } from 'vitest'
import { createTeamLibrary } from '../src/experts/team-library.ts'
import type { AgencySettings, ExpertSettingsStore } from '../src/experts/expert-library.ts'
import type { ExpertPluginTeamDefinition } from '../src/experts/expert-plugin-package.ts'
import type { DesktopMcpView } from '../src/mcp-contract.ts'

const definition: ExpertPluginTeamDefinition = {
  id: 'plugin-team:research-pack',
  packageName: 'research-pack',
  packageVersion: '1.2.3',
  name: { zh: '研究团队', en: 'Research Team' },
  description: { zh: '完整研究工作流', en: 'Full research workflow' },
  defaultInitPrompt: { zh: '开始研究', en: 'Start research' },
  tags: [{ zh: '研究', en: 'Research' }],
  quickPrompts: [{ zh: '分析这个主题', en: 'Analyze this topic' }],
  leadAgentSlug: 'research-pack--lead',
  memberAgentSlugs: ['research-pack--analyst'],
  skills: [{ name: 'web-research', required: true, enabled: true }],
  connectors: [{ name: 'browser', required: true, enabled: true }],
}

const experts = [
  { slug: 'research-pack--lead', name: '主理人', nameEn: 'Lead', description: '规划', descriptionEn: 'Plans', emoji: '', division: 'research', divisionZh: '研究', custom: false, skills: [], mcpServers: [], packageType: 'team' as const, packageAgentId: 'lead', packageRole: 'lead' as const },
  { slug: 'research-pack--analyst', name: '分析师', nameEn: 'Analyst', description: '分析', descriptionEn: 'Analyzes', emoji: '', division: 'research', divisionZh: '研究', custom: false, skills: [], mcpServers: [], packageType: 'team' as const, packageAgentId: 'analyst', packageRole: 'member' as const },
]

function fixture(initial: AgencySettings = { enabled: [] }, connector?: {
  view: DesktopMcpView
  toggle(serverName: string, enabled: boolean): Promise<DesktopMcpView>
  test(serverName: string): Promise<DesktopMcpView>
  install(connectorId: string, values: Readonly<Record<string, string>>): Promise<DesktopMcpView>
}) {
  let state = structuredClone(initial)
  let revision = 4
  const store: ExpertSettingsStore = {
    read: () => state,
    revision: () => revision,
    async mutate(ops, expected) {
      expect(expected).toBe(revision)
      for (const op of ops) {
        if (op.op !== 'set') throw new Error('unexpected operation')
        ;(state as unknown as Record<string, unknown>)[String(op.path[0])] = structuredClone(op.value)
      }
      revision++
    },
  }
  const library = createTeamLibrary(async () => ({ experts, enabled: state.enabled, revision }), store, () => 'zh', async () => [definition], connector === undefined ? undefined : () => ({
    read: async () => connector.view,
    toggle: connector.toggle,
    test: connector.test,
    install: connector.install,
  }))
  return { library, state: () => state }
}

describe('unified team library', () => {
  it('projects packaged teams into the single team catalog', async () => {
    const { library } = fixture()
    const snapshot = await library.snapshot()
    const team = snapshot.teams.find(item => item.id === definition.id)
    expect(team).toMatchObject({
      id: 'plugin-team:research-pack', builtin: true,
      provenance: { packageName: 'research-pack', packageVersion: '1.2.3', source: 'local' },
      runtime: { mode: 'lead', leadExpertSlug: 'research-pack--lead' },
    })
    expect(team?.members).toHaveLength(2)
  })

  it('does not persist an independent team enablement state', async () => {
    const { library, state } = fixture()
    const snapshot = await library.snapshot()
    expect(snapshot).not.toHaveProperty('enabledTeams')
    expect(library).not.toHaveProperty('setEnabled')
    expect(state().enabled).toEqual([])
  })

  it('exposes expert readiness without duplicating it as team state', async () => {
    const { library } = fixture({ enabled: ['research-pack--lead', 'research-pack--analyst'] })
    const snapshot = await library.snapshot()
    expect(snapshot.enabledExperts).toEqual(['research-pack--lead', 'research-pack--analyst'])
    expect(snapshot).not.toHaveProperty('enabledTeams')
  })

  it('projects and controls declared Connector dependencies through the Host lifecycle', async () => {
    const server = {
      serverName: 'company-browser', connectorId: 'browser', transport: 'stdio' as const, command: 'browser', args: [], cwd: '', env: {}, timeoutMs: 60_000,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 }, enabled: true,
      capabilities: [], managedCredentialRefs: [], state: 'running' as const, tools: [], credentialsReady: true,
      diagnostic: { code: 'ready' as const, stage: 'ready' as const },
    }
    const view: DesktopMcpView = {
      mcpServers: [server],
      catalog: [{ id: 'browser', name: 'Browser', description: '', category: 'research', sourceUrl: '', license: '', capabilities: [], credentials: [], server }],
    }
    const lifecycle = {
      view,
      toggle: vi.fn(async (_serverName: string, _enabled: boolean) => view),
      test: vi.fn(async (_serverName: string) => view),
      install: vi.fn(async (_connectorId: string, _values: Readonly<Record<string, string>>) => view),
    }
    const { library } = fixture({ enabled: experts.map(expert => expert.slug) }, lifecycle)

    const team = (await library.snapshot()).teams.find(item => item.id === definition.id)
    expect(team && 'connectorStates' in team ? team.connectorStates : undefined).toEqual([
      expect.objectContaining({ dependency: 'browser', serverName: 'company-browser', connectorId: 'browser', installed: true, state: 'running' }),
    ])
    await library.setConnectorEnabled(definition.id, 'browser', false)
    await library.testConnector(definition.id, 'browser')
    await library.installConnector(definition.id, 'browser', {})
    expect(lifecycle.toggle).toHaveBeenCalledWith('company-browser', false)
    expect(lifecycle.test).toHaveBeenCalledWith('company-browser')
    expect(lifecycle.install).toHaveBeenCalledWith('browser', {})
    await expect(library.testConnector(definition.id, 'undeclared')).rejects.toThrow('dependency does not exist')
  })
})
