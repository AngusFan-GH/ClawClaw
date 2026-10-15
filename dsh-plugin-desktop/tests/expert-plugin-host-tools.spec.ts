import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/experts/index.ts'
import { AGENCY_PLUGIN_TEAM_SERVICE, type AgencyPluginTeamLibrary } from '../src/experts/plugin-team-library.ts'
import { DESKTOP_MCP_LIFECYCLE_SERVICE, type DesktopMcpView } from '../src/mcp-contract.ts'

const roots: string[] = []
const originalDshHome = process.env.DSH_HOME

afterEach(async () => {
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const localized = (zh: string, en: string) => ({ zh, en })
type RegisteredTool = {
  execute(args: Record<string, unknown>, exec: Record<string, unknown>): Promise<Record<string, unknown>>
}

async function writeTeamPackage(home: string, version: string): Promise<string> {
  const root = join(home, 'plugins/marketplaces/research-team', version)
  await Promise.all([
    mkdir(join(root, '.clawclaw-plugin'), { recursive: true }),
    mkdir(join(root, 'agents'), { recursive: true }),
    mkdir(join(root, 'avatars'), { recursive: true }),
  ])
  const manifest = {
    name: 'research-team', version, description: 'Research workflow', author: { name: 'Test' },
    agents: ['./agents/lead.md', './agents/analyst.md'],
    dependencies: { connectors: ['browser'] }, expertType: 'team', agentName: 'lead',
    displayName: localized('研究团队', 'Research Team'), profession: localized('研究主理人', 'Research Lead'),
    displayDescription: localized('规划、研究并汇总', 'Plans, researches, and synthesizes'),
    avatar: './avatars/team.png', categoryId: '05-ResearchAnalysis',
    defaultInitPrompt: localized('开始研究', 'Start research'),
    tags: [localized('研究', 'Research'), localized('证据', 'Evidence'), localized('分析', 'Analysis')],
    quickPrompts: [localized('分析主题', 'Analyze a topic'), localized('核验证据', 'Verify evidence'), localized('汇总结论', 'Synthesize findings')],
    teamInfo: { leadAgent: 'lead', memberAgents: ['analyst'] },
    members: [
      { id: 'lead', name: localized('主理人', 'Lead'), profession: localized('规划与汇总', 'Planning and synthesis'), avatar: './avatars/lead.png', role: 'lead' },
      { id: 'analyst', name: localized('分析师', 'Analyst'), profession: localized('证据分析', 'Evidence analysis'), avatar: './avatars/analyst.png', role: 'member' },
    ],
  }
  await Promise.all([
    writeFile(join(root, '.clawclaw-plugin/plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(join(root, 'agents/lead.md'), '---\nname: Lead\ndescription: Plans and synthesizes\n---\nLead persona.\n'),
    writeFile(join(root, 'agents/analyst.md'), '---\nname: Analyst\ndescription: Analyzes evidence\n---\nAnalyst persona.\n'),
    writeFile(join(root, 'avatars/team.png'), 'team'),
    writeFile(join(root, 'avatars/lead.png'), 'lead'),
    writeFile(join(root, 'avatars/analyst.png'), 'analyst'),
  ])
  return root
}

async function hostFixture() {
  const root = await mkdtemp(join(tmpdir(), 'clawclaw-host-tools-'))
  roots.push(root)
  const home = join(root, 'home')
  const catalog = join(root, 'catalog')
  await mkdir(join(catalog, 'research'), { recursive: true })
  await writeFile(join(catalog, 'research/base.md'), '---\nname: Base Researcher\ndescription: Base catalog entry\n---\nBase persona.\n')
  process.env.DSH_HOME = home

  let revision = 7
  let state = {
    enabled: ['research-team--lead', 'research-team--analyst'],
    customExperts: [], customTeams: [], enabledTeams: [],
    pluginTeamStates: [{ packageName: 'research-team', enabled: true }],
  }
  let connectorState: 'running' | 'error' = 'running'
  const connectorView = (): DesktopMcpView => ({
    mcpServers: [{
      serverName: 'company-browser', connectorId: 'browser', transport: 'stdio', command: 'browser', args: [], cwd: '', env: {}, timeoutMs: 60_000,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 }, enabled: true,
      capabilities: [], managedCredentialRefs: [], state: connectorState, tools: connectorState === 'running' ? [{ name: 'mcp__company-browser__search', description: '' }] : [],
      credentialsReady: true, diagnostic: { code: connectorState === 'running' ? 'ready' : 'connection-failed', stage: connectorState === 'running' ? 'ready' : 'connection' },
    }],
    catalog: [],
  })
  const services = new Map<string, unknown>([[DESKTOP_MCP_LIFECYCLE_SERVICE, {
    read: async () => connectorView(), toggle: vi.fn(), test: vi.fn(), install: vi.fn(),
  }]])
  const tools = new Map<string, RegisteredTool>()
  const outputs = ['lead plan', 'member evidence', 'lead final']
  const starts: Array<Record<string, unknown>> = []
  const start = vi.fn(async (_provider: string, options: Record<string, unknown>) => {
    starts.push(options)
    const text = outputs[starts.length - 1] ?? 'unexpected'
    return { result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text }] }), dispose: vi.fn(async () => {}) }
  })
  const settings = {
    get: (ns: string) => ns === 'locale' ? { preference: 'en' } : ns === 'dsh-desktop-mcp'
      ? { mcpServers: [{ serverName: 'company-browser', connectorId: 'browser', capabilities: [] }] } : state,
    describe: () => [{ ns: 'clawclaw-experts', revision, value: state }, { ns: 'locale', revision: 1, value: { preference: 'en' } }],
    installSection: (_owner: unknown, _ns: unknown, _schema: unknown, _entry: unknown, hooks: { setSource(value: () => typeof state): void }) => hooks.setSource(() => state),
    mutate: async (_ns: string, ops: Array<{ op: string; path: unknown[]; value: unknown }>, expected: number) => {
      expect(expected).toBe(revision)
      for (const op of ops) state = { ...state, [String(op.path[0])]: structuredClone(op.value) }
      revision++
    },
  }
  const ctx = {
    settings,
    tools: {
      register: (tool: RegisteredTool & { name: string }) => { tools.set(tool.name, tool) },
      schemas: () => [{ name: 'mcp__company-browser__search' }],
    },
    subagents: { getProvider: () => ({ capabilities: { persona: true, toolFilter: true, depthLimit: true } }), start },
    skills: { get: async () => undefined },
    systemPrompt: { section: vi.fn() },
    reflect: { provide: (name: string, value: unknown) => { services.set(name, value) } },
    get: (name: string) => services.get(name),
    on: vi.fn(() => () => {}), effect: vi.fn(() => () => {}),
    webServer: {}, logger: { warn: vi.fn(), error: vi.fn() },
  } as unknown as Context
  apply(ctx, { root: catalog, provider: 'spawn', divisions: ['research'], maxDepth: 3 })
  const parent = { session: { header: { cwd: root } } } as unknown as Agent
  const execute = async (name: string, args: Record<string, unknown> = {}, agent: Agent = parent) => {
    const tool = tools.get(name)
    if (!tool) throw new Error(`Tool was not registered: ${name}`)
    return tool.execute(args, { agent, signal: new AbortController().signal })
  }
  return { home, services, tools, starts, execute, setConnectorState: (value: 'running' | 'error') => { connectorState = value } }
}

describe('Plugin Team Host tools', () => {
  it('refreshes added, changed, and removed packages without restarting the Host', async () => {
    const fixture = await hostFixture()
    expect(JSON.parse(String((await fixture.execute('list_expert_teams')).report))).toEqual([])

    const first = await writeTeamPackage(fixture.home, '1.0.0')
    const listed = JSON.parse(String((await fixture.execute('list_expert_teams')).report))
    expect(listed).toEqual([expect.objectContaining({ id: 'plugin-team:research-team', installedVersion: '1.0.0', runtime: 'plugin-lead' })])

    await rm(first, { recursive: true, force: true })
    await writeTeamPackage(fixture.home, '2.0.0')
    const updated = JSON.parse(String((await fixture.execute('get_expert_team', { team: 'plugin-team:research-team' })).report))
    expect(updated).toMatchObject({ packageVersion: '2.0.0', runtime: 'plugin-lead', connectorStates: [expect.objectContaining({ serverName: 'company-browser', state: 'running' })] })

    await rm(join(fixture.home, 'plugins/marketplaces/research-team'), { recursive: true, force: true })
    expect(JSON.parse(String((await fixture.execute('list_expert_teams')).report))).toEqual([])
  })

  it('runs Lead, members, and Lead synthesis through registered Host tools', async () => {
    const fixture = await hostFixture()
    await writeTeamPackage(fixture.home, '1.0.0')
    const result = JSON.parse(String((await fixture.execute('summon_expert_team', { team: 'plugin-team:research-team', task: 'Investigate the evidence.' })).report))

    expect(result).toMatchObject({ runtime: 'plugin-lead', plan: 'lead plan', answer: 'lead final', members: [{ ok: true, answer: 'member evidence' }] })
    expect(fixture.starts).toHaveLength(3)
    expect(fixture.starts.map(call => String((call.prompt as Array<{ text: string }>)[0]?.text))).toEqual([
      expect.stringContaining('Create a concise execution plan'),
      expect.stringContaining('Lead plan:\nlead plan'),
      expect.stringContaining('Member evidence:\n##'),
    ])
    expect(fixture.starts.every(call => (call.toolFilter as { deny: string[] }).deny.includes('summon_expert_team'))).toBe(true)

    const child = { session: { header: { parentSession: 'parent' } } } as unknown as Agent
    await expect(fixture.execute('summon_expert_team', { team: 'plugin-team:research-team', task: 'Nested.' }, child)).rejects.toThrow('cannot invoke additional teams')

    const library = fixture.services.get(AGENCY_PLUGIN_TEAM_SERVICE) as AgencyPluginTeamLibrary
    await library.setEnabled('plugin-team:research-team', false, 7)
    await expect(fixture.execute('summon_expert_team', { team: 'plugin-team:research-team', task: 'Disabled.' })).rejects.toThrow('missing, conflicting, or disabled')
    await library.setEnabled('plugin-team:research-team', true, 8)

    fixture.setConnectorState('error')
    await expect(fixture.execute('summon_expert_team', { team: 'plugin-team:research-team', task: 'Blocked.' })).rejects.toThrow('Required Team Connectors are not ready')
  })

  it('registers the Plugin Team library as a first-class Host service', async () => {
    const fixture = await hostFixture()
    await writeTeamPackage(fixture.home, '1.0.0')
    const library = fixture.services.get(AGENCY_PLUGIN_TEAM_SERVICE) as AgencyPluginTeamLibrary
    expect((await library.snapshot()).teams.find(team => team.id === 'plugin-team:research-team')).toMatchObject({ id: 'plugin-team:research-team', runtime: 'plugin-lead' })
    expect([...fixture.tools.keys()]).toEqual(expect.arrayContaining(['list_expert_teams', 'get_expert_team', 'summon_expert_team']))
  })
})
