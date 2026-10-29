import { describe, expect, it, vi } from 'vitest'
import { createTeamLibrary } from '../src/experts/team-library.ts'
import type { AgencySettings, ExpertSettingsStore } from '../src/experts/expert-library.ts'
import type { ExpertPluginTeamDefinition } from '../src/experts/expert-plugin-package.ts'
import type { DesktopMcpView } from '../src/mcp-contract.ts'
import { agencySettingsFromLegacyDocument, readAgencySettings } from '../src/experts/settings-compat.ts'
import { teamSnapshotSchema } from '../src/experts/team-contract.ts'

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
}, teamDefinitions: readonly ExpertPluginTeamDefinition[] = [definition]) {
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
  const library = createTeamLibrary(async () => ({ experts, enabled: state.enabled, revision }), store, () => 'zh', async () => teamDefinitions, connector === undefined ? undefined : () => ({
    read: async () => connector.view,
    toggle: connector.toggle,
    test: connector.test,
    install: connector.install,
  }))
  return { library, state: () => state }
}

describe('unified team library', () => {
  it('keeps pipeline strategy and a fallback example in the strict client snapshot', async () => {
    const { library } = fixture(undefined, undefined, [{ ...definition, quickPrompts: [], execution: 'pipeline' }])
    const snapshot = teamSnapshotSchema.parse(await library.snapshot())
    expect(snapshot.teams.find(team => team.id === definition.id)).toMatchObject({ runtime: { execution: 'pipeline' }, examples: ['开始研究'] })
  })
  it.each(['研究团队', 'Research Team'])('rejects custom team names colliding with packaged teams: %s', async name => {
    const { library, state } = fixture()
    const team = (await library.snapshot()).teams.find(team => team.id === definition.id)!
    const { id: _id, builtin: _builtin, runtime: _runtime, skills: _skills, connectors: _connectors, connectorStates: _states, provenance: _provenance, ...input } = team
    await expect(library.save({ ...input, name, builtin: false }, 4)).rejects.toThrow('团队名称已被使用')
    expect(state().customTeams).toBeUndefined()
  })
  it('reads recall records from live configuration and legacy imports without inferring old records', () => {
    let recalled = [definition.id]
    const config = { enabled: { get: () => experts.map(expert => expert.slug) }, recalledTeams: { get: () => recalled } }
    expect(readAgencySettings(config).recalledTeams).toEqual([definition.id])
    recalled = []
    expect(readAgencySettings(config).recalledTeams).toEqual([])
    expect(readAgencySettings({ enabled: experts.map(expert => expert.slug) }).recalledTeams).toEqual([])
    expect(agencySettingsFromLegacyDocument({ 'clawclaw-experts': { enabled: [], recalledTeams: [definition.id] } })?.recalledTeams).toEqual([definition.id])
  })

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

  it('starts old settings without any implicitly recalled teams', async () => {
    const { library, state } = fixture()
    const snapshot = await library.snapshot()
    expect(snapshot).not.toHaveProperty('enabledTeams')
    expect(snapshot.recalledTeams).toEqual([])
    expect(library).not.toHaveProperty('setEnabled')
    expect(state().enabled).toEqual([])
  })

  it('does not recall a team when all of its experts are individually enabled', async () => {
    const { library } = fixture({ enabled: ['research-pack--lead', 'research-pack--analyst'] })
    const snapshot = await library.snapshot()
    expect(snapshot.enabledExperts).toEqual(['research-pack--lead', 'research-pack--analyst'])
    expect(snapshot).not.toHaveProperty('enabledTeams')
    expect(snapshot.recalledTeams).toEqual([])
  })

  it('recalls a team by enabling all of its experts in one revision', async () => {
    const { library, state } = fixture()
    const snapshot = await library.recall(definition.id, 4)
    expect(state().enabled).toEqual(['research-pack--lead', 'research-pack--analyst'])
    expect(snapshot.enabledExperts).toEqual(['research-pack--lead', 'research-pack--analyst'])
    expect(state().recalledTeams).toEqual([definition.id])
    expect(snapshot.recalledTeams).toEqual([definition.id])
    expect(snapshot.revision).toBe(5)
  })

  it('records an explicit recall even with all members enabled, survives restart and is idempotent', async () => {
    const { library, state } = fixture({ enabled: experts.map(expert => expert.slug) })
    expect((await library.recall(definition.id, 4)).revision).toBe(5)
    expect(state().recalledTeams).toEqual([definition.id])
    expect((await library.recall(definition.id, 5)).revision).toBe(5)
    const restarted = fixture(state())
    expect((await restarted.library.snapshot()).recalledTeams).toEqual([definition.id])
  })

  it('does not implicitly recall another team with identical members', async () => {
    const other = { ...definition, id: 'plugin-team:other', packageName: 'other' }
    const { library } = fixture({ enabled: [] }, undefined, [definition, other])
    const snapshot = await library.recall(definition.id, 4)
    expect(snapshot.enabledExperts).toEqual(experts.map(expert => expert.slug))
    expect(snapshot.recalledTeams).toEqual([definition.id])
    expect(snapshot.teams.some(team => team.id === other.id)).toBe(true)
  })

  it('removes a deleted custom team recall record while keeping its members enabled', async () => {
    const { library, state } = fixture()
    const team = (await library.snapshot()).teams.find(team => team.id === definition.id)!
    const { id: _id, builtin: _builtin, runtime: _runtime, skills: _skills, connectors: _connectors, connectorStates: _connectorStates, provenance: _provenance, ...input } = team
    const saved = await library.save({ ...input, name: 'Temporary team' }, 4)
    const custom = saved.teams.find(team => !team.builtin)!
    await library.recall(custom.id, saved.revision)
    const removed = await library.remove(custom.id, 6)
    expect(removed.recalledTeams).toEqual([])
    expect(state().recalledTeams).toEqual([])
    expect(removed.enabledExperts).toEqual(experts.map(expert => expert.slug))
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
