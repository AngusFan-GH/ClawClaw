import { Session, SessionId, pluginRecordOf } from '@deepseek-ai/dsh-session'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Context } from '@deepseek-ai/cordis'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import AgencyAgentsRemote from '../src/experts/remote.ts'
import { AGENCY_PLUGIN_PACKAGE_SERVICE, apply, type AgencyPluginPackageService } from '../src/experts/index.ts'
import { AGENCY_TEAM_SERVICE, type AgencyTeamLibrary } from '../src/experts/team-library.ts'
import { DESKTOP_MCP_LIFECYCLE_SERVICE, type DesktopMcpView } from '../src/mcp-contract.ts'
import { AGENCY_LIBRARY_SERVICE, type AgencyExpertLibrary } from '../src/experts/expert-library.ts'

const roots: string[] = []
const contexts: Context[] = []
const originalDshHome = process.env.DSH_HOME

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const localized = (zh: string, en: string) => ({ zh, en })
type RegisteredTool = {
  execute(args: Record<string, unknown>, exec: Record<string, unknown>): Promise<Record<string, unknown>>
}

async function writeTeamPackage(home: string, version: string, conversationCreated = false): Promise<string> {
  const root = conversationCreated
    ? join(home, 'plugins/marketplaces/my-experts/plugins/research-team')
    : join(home, 'plugins/marketplaces/research-team', version)
  await Promise.all([
    mkdir(join(root, '.clawclaw-plugin'), { recursive: true }),
    mkdir(join(root, 'agents'), { recursive: true }),
  ])
  const manifest = {
    name: 'research-team', version, description: 'Research workflow', author: { name: 'Test' },
    agents: ['./agents/lead.md', './agents/analyst.md'],
    dependencies: { connectors: ['browser'] }, expertType: 'team', agentName: 'lead',
    profession: localized('研究团队', 'Research Team'),
    displayDescription: localized('规划、研究并汇总', 'Plans, researches, and synthesizes'),
    avatar: 0, categoryId: '05-ResearchAnalysis',
    defaultInitPrompt: localized('开始研究', 'Start research'),
    tags: [localized('研究', 'Research'), localized('证据', 'Evidence'), localized('分析', 'Analysis')],
    quickPrompts: [localized('分析主题', 'Analyze a topic'), localized('核验证据', 'Verify evidence'), localized('汇总结论', 'Synthesize findings')],
    teamInfo: { leadAgent: 'lead', memberAgents: ['analyst'] },
    members: [
      { id: 'lead', profession: localized('研究主理人', 'Research Lead'), avatar: 4, role: 'lead' },
      { id: 'analyst', profession: localized('证据分析师', 'Evidence Analyst'), avatar: 12, role: 'member' },
    ],
  }
  await Promise.all([
    writeFile(join(root, '.clawclaw-plugin/plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(join(root, 'agents/lead.md'), '---\nname: Lead\ndescription: Plans and synthesizes\n---\nLead persona.\n'),
    writeFile(join(root, 'agents/analyst.md'), '---\nname: Analyst\ndescription: Analyzes evidence\n---\nAnalyst persona.\n'),
    ...(conversationCreated ? [writeFile(join(root, '.created-by-session'), 'session-research')] : []),
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
    customExperts: [], customTeams: [],
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
  const createdListeners = new Set<(value: { agent: Agent }) => void>()
  const startActivation = vi.fn(async (spec: { childId: string; request: Record<string, unknown>; delivery: string }) => {
    expect(spec.delivery).toBe('caller')
    const session = Session.create(SessionId(spec.childId))
    const child = { id: spec.childId, session,
      ctx: { systemPrompt: { section: vi.fn(), getSectionOrder: () => 0 }, tools: { restrict: vi.fn() } } } as unknown as Agent
    for (const listener of createdListeners) listener({ agent: child })
    const composition = session.snapshotEvents().map(pluginRecordOf).find(record => record?.type === 'plugin:clawclaw/expert-composition')?.data as { persona: string; deniedTools: string[] }
    starts.push({ ...spec.request, persona: composition.persona, toolFilter: { deny: composition.deniedTools } })
    const text = outputs[starts.length - 1] ?? 'unexpected'
    return { childId: spec.childId, result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text }] }), dispose: vi.fn(async () => {}) }
  })
  const settings = {
    get: (ns: string) => ns === 'locale' ? { preference: 'en' } : ns === 'dsh-desktop-mcp'
      ? { mcpServers: [{ serverName: 'company-browser', connectorId: 'browser', capabilities: [] }, { serverName: 'company-notes', capabilities: ['knowledge.search'] }] } : state,
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
    subagents: { getProvider: () => ({ prepareContinuable: vi.fn(), capabilities: { depthLimit: true } }), startActivation },
    skills: { get: async () => undefined },
    systemPrompt: { section: vi.fn() },
    reflect: { provide: (name: string, value: unknown) => { services.set(name, value) } },
    get: (name: string) => services.get(name),
    on: vi.fn((event: string, callback: (value: { agent: Agent }) => void) => {
      if (event === 'agent/created') createdListeners.add(callback)
      return () => { createdListeners.delete(callback) }
    }), effect: vi.fn(() => () => {}),
    webServer: {}, logger: { warn: vi.fn(), error: vi.fn() },
  } as unknown as Context
  apply(ctx, { root: catalog, provider: 'spawn', divisions: ['research'], maxDepth: 3 })
  const parent = { session: { header: { cwd: root } } } as unknown as Agent
  const execute = async (name: string, args: Record<string, unknown> = {}, agent: Agent = parent) => {
    const tool = tools.get(name)
    if (!tool) throw new Error(`Tool was not registered: ${name}`)
    return tool.execute(args, { agent, signal: new AbortController().signal })
  }
  return { home, ctx, services, tools, starts, execute, setConnectorState: (value: 'running' | 'error') => { connectorState = value } }
}

async function writeAgentPackage(home: string, personal = true): Promise<string> {
  const root = join(home, 'plugins/marketplaces', personal ? 'my-experts/plugins/react-architect' : 'react-architect/1.0.0')
  await mkdir(join(root, '.clawclaw-plugin'), { recursive: true })
  await mkdir(join(root, 'agents'), { recursive: true })
  await writeFile(join(root, '.clawclaw-plugin/plugin.json'), JSON.stringify({
    name: 'react-architect', version: '1.0.0', description: 'React architecture', author: 'Test',
    agents: ['./agents/react-architect.md'], expertType: 'agent', agentName: 'react-architect',
    profession: localized('React 架构师', 'React Architect'), avatar: 0, categoryId: '02-SoftwareDevelopment',
    defaultInitPrompt: localized('设计 React 应用', 'Design a React application'),
  }))
  await writeFile(join(root, 'agents/react-architect.md'), '---\nname: React Architect\ndescription: React architecture\n---\nReact persona.\n')
  return root
}

async function expertGateway(fixture: Awaited<ReturnType<typeof hostFixture>>) {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('settings', fixture.ctx.settings)
  for (const [name, value] of fixture.services) ctx.reflect.provide(name, value)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(RemoteAccessService)
  await ctx.plugin(TypertGateway)
  new AgencyAgentsRemote(ctx)
  const peer = new Peer(ctx, { principal: { kind: 'owner' } })
  return (method: string, args: Record<string, unknown>) => ctx.typertGateway.invoke({ namespace: 'agencyAgents', method, args, peer })
}

const legacyExpertInput = {
  name: 'Legacy custom expert', description: 'A custom expert stored in settings', division: 'research', prompt: 'Legacy persona.',
}

describe('Expert deletion through the strict Remote gateway', () => {
  it('deletes a personal Agent package by its package slug while retaining other experts and history', async () => {
    const fixture = await hostFixture()
    const root = await writeAgentPackage(fixture.home)
    const library = fixture.services.get(AGENCY_LIBRARY_SERVICE) as AgencyExpertLibrary
    const saved = await library.saveCustom(legacyExpertInput, true, 7)
    const legacySlug = saved.enabled[0]!
    const enabled = await library.setEnabled([legacySlug, 'react-architect'], saved.revision)
    expect(saved.experts.find(expert => expert.slug === 'react-architect')).toMatchObject({ conversationCreated: true, packageType: 'agent' })
    const history = join(fixture.home, 'history.jsonl')
    await writeFile(history, 'retained conversation\n')
    const invoke = await expertGateway(fixture)

    await expect(invoke('deleteCustomExpert', { slug: 'react-architect', expectedRevision: enabled.revision })).resolves.toMatchObject({
      enabled: [legacySlug], experts: expect.arrayContaining([expect.objectContaining({ slug: legacySlug }), expect.objectContaining({ slug: 'base' })]),
    })
    expect((await library.catalog()).experts.some(expert => expert.slug === 'react-architect')).toBe(false)
    await expect(stat(root)).rejects.toThrow()
    expect(await readFile(history, 'utf8')).toBe('retained conversation\n')
  })

  it('continues to delete legacy custom UUID experts', async () => {
    const fixture = await hostFixture()
    const library = fixture.services.get(AGENCY_LIBRARY_SERVICE) as AgencyExpertLibrary
    const saved = await library.saveCustom(legacyExpertInput, true, 7)
    const invoke = await expertGateway(fixture)
    await expect(invoke('deleteCustomExpert', { slug: saved.enabled[0], expectedRevision: saved.revision })).resolves.toMatchObject({ enabled: [] })
    expect((await library.catalog()).experts.some(expert => expert.custom)).toBe(false)
  })

  it('refuses built-in and externally installed experts and keeps package editing restricted', async () => {
    const fixture = await hostFixture()
    const root = await writeAgentPackage(fixture.home, false)
    const invoke = await expertGateway(fixture)
    for (const slug of ['base', 'react-architect']) {
      await expect(invoke('deleteCustomExpert', { slug, expectedRevision: 7 })).rejects.toThrow('read-only')
    }
    await expect(invoke('getCustomExpert', { slug: 'react-architect' })).rejects.toMatchObject({ code: 'gateway/input-invalid' })
    await expect(stat(root)).resolves.toBeDefined()
  })

  it('refuses stale revisions before removing a personal package', async () => {
    const fixture = await hostFixture()
    const root = await writeAgentPackage(fixture.home)
    const invoke = await expertGateway(fixture)
    await expect(invoke('deleteCustomExpert', { slug: 'react-architect', expectedRevision: 6 })).rejects.toThrow()
    await expect(stat(root)).resolves.toBeDefined()
  })

  it.each(['../react-architect', '/react-architect', 'react/architect', ' react-architect', 'react-architect--lead', ''])('rejects unsafe or member slugs at the boundary: %j', async slug => {
    const fixture = await hostFixture()
    const invoke = await expertGateway(fixture)
    await expect(invoke('deleteCustomExpert', { slug, expectedRevision: 7 })).rejects.toMatchObject({ code: 'gateway/input-invalid' })
  })
})

describe('Plugin Team Host tools', () => {
  it('replaces legacy placeholder MCP names with configured capability aliases', async () => {
    const fixture = await hostFixture()
    const library = fixture.services.get(AGENCY_LIBRARY_SERVICE) as AgencyExpertLibrary
    const expert = (await library.catalog()).experts.find(item => item.slug === 'base')!
    expect(expert.mcpServers.map(item => item.name)).toEqual(['company-notes', 'company-browser'])
    expect(expert.mcpServers.some(item => item.name === 'notion')).toBe(false)
  })

  it('rejects a required missing Skill before starting even the team lead', async () => {
    const fixture = await hostFixture()
    const root = await writeTeamPackage(fixture.home, '1.0.0')
    const { readFile } = await import('node:fs/promises')
    const manifestPath = join(root, '.clawclaw-plugin/plugin.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.skills = ['./skills/required-check']
    await mkdir(join(root, 'skills/required-check'), { recursive: true })
    await writeFile(join(root, 'skills/required-check/SKILL.md'), '---\nname: required-check\ndescription: Check evidence\n---\nCheck it.\n')
    await writeFile(manifestPath, JSON.stringify(manifest))
    await expect(fixture.execute('summon_expert_team', { team: 'plugin-team:research-team', task: 'Investigate.' })).rejects.toThrow('Skill unavailable: required-check')
    expect(fixture.starts).toHaveLength(0)
  })
  it('refreshes added, changed, and removed packages without restarting the Host', async () => {
    const fixture = await hostFixture()
    expect(JSON.parse(String((await fixture.execute('list_expert_teams')).report))).toEqual([])

    const first = await writeTeamPackage(fixture.home, '1.0.0')
    const listed = JSON.parse(String((await fixture.execute('list_expert_teams')).report))
    expect(listed).toEqual([expect.objectContaining({ id: 'plugin-team:research-team', provenance: expect.objectContaining({ packageVersion: '1.0.0' }), runtime: 'lead' })])

    await rm(first, { recursive: true, force: true })
    await writeTeamPackage(fixture.home, '2.0.0')
    const updated = JSON.parse(String((await fixture.execute('get_expert_team', { team: 'plugin-team:research-team' })).report))
    expect(updated).toMatchObject({ provenance: { packageVersion: '2.0.0' }, runtime: { mode: 'lead' }, connectorStates: [expect.objectContaining({ serverName: 'company-browser', state: 'running' })] })

    await rm(join(fixture.home, 'plugins/marketplaces/research-team'), { recursive: true, force: true })
    expect(JSON.parse(String((await fixture.execute('list_expert_teams')).report))).toEqual([])
  })

  it('runs Lead, members, and Lead synthesis through registered Host tools', async () => {
    const fixture = await hostFixture()
    await writeTeamPackage(fixture.home, '1.0.0')
    const result = JSON.parse(String((await fixture.execute('summon_expert_team', { team: 'plugin-team:research-team', task: 'Investigate the evidence.' })).report))

    expect(result).toMatchObject({ runtime: 'lead', plan: 'lead plan', answer: 'lead final', members: [{ ok: true, answer: 'member evidence' }] })
    expect(fixture.starts).toHaveLength(3)
    expect(fixture.starts.map(call => String((call.prompt as Array<{ text: string }>)[0]?.text))).toEqual([
      expect.stringContaining('Create a concise execution plan'),
      expect.stringContaining('Lead plan:\nlead plan'),
      expect.stringContaining('Member evidence:\n##'),
    ])
    expect(fixture.starts.every(call => (call.toolFilter as { deny: string[] }).deny.includes('summon_expert_team'))).toBe(true)

    const child = { session: { header: { parentSession: 'parent' } } } as unknown as Agent
    await expect(fixture.execute('summon_expert_team', { team: 'plugin-team:research-team', task: 'Nested.' }, child)).rejects.toThrow('cannot invoke additional teams')

    fixture.setConnectorState('error')
    await expect(fixture.execute('summon_expert_team', { team: 'plugin-team:research-team', task: 'Blocked.' })).rejects.toThrow('Required Team Connectors are not ready')
  })

  it('registers the Plugin Team library as a first-class Host service', async () => {
    const fixture = await hostFixture()
    await writeTeamPackage(fixture.home, '1.0.0')
    const library = fixture.services.get(AGENCY_TEAM_SERVICE) as AgencyTeamLibrary
    expect((await library.snapshot()).teams.find(team => team.id === 'plugin-team:research-team')).toMatchObject({ id: 'plugin-team:research-team', runtime: { mode: 'lead' } })
    expect([...fixture.tools.keys()]).toEqual(expect.arrayContaining(['list_expert_teams', 'get_expert_team', 'summon_expert_team']))
  })

  it('removes a conversation-created Team package and its enabled members', async () => {
    const fixture = await hostFixture()
    const root = await writeTeamPackage(fixture.home, '1.0.0', true)
    const service = fixture.services.get(AGENCY_PLUGIN_PACKAGE_SERVICE) as AgencyPluginPackageService
    const result = await service.removeConversationPackage('research-team', 7)

    expect(result.catalog.experts.some(expert => expert.packageName === 'research-team')).toBe(false)
    expect(result.catalog.enabled).toEqual([])
    expect(result.teams.teams.some(team => team.id === 'plugin-team:research-team')).toBe(false)
    await expect(stat(root)).rejects.toThrow()
  })
})
