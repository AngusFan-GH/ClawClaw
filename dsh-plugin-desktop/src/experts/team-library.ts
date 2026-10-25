import { teamText, type TeamLocale } from './team-i18n.js'
import { randomUUID } from 'node:crypto'
import { localizeTeam } from './team-content-en.js'
import type { CatalogSnapshot, ExpertSummary } from './expert-contract.js'
import type { ExpertSettingsStore } from './expert-library.js'
import type { ExpertPluginLocalizedText, ExpertPluginTeamDefinition } from './expert-plugin-package.js'
import type { DesktopMcpView } from '../mcp-contract.js'
import { teamCapabilityBindings, mergeCapabilityBindings } from './capability-composition.js'
import {
  BUILTIN_TEAMS,
  TEAM_CUSTOM_ID,
  teamInputSchema,
  teamSchema,
  type TeamInput,
  type TeamSnapshot,
  type ExpertTeam,
} from './team-contract.js'
export const AGENCY_TEAM_SERVICE = 'agencyAgentsTeams'
export interface TeamConnectorLifecycle {
  read(): Promise<DesktopMcpView>
  toggle(serverName: string, enabled: boolean): Promise<DesktopMcpView>
  test(serverName: string): Promise<DesktopMcpView>
  install(connectorId: string, values: Readonly<Record<string, string>>): Promise<DesktopMcpView>
}

const localizedPluginText = (value: ExpertPluginLocalizedText, locale: TeamLocale): string =>
  value[locale] ?? value[locale === 'zh' ? 'en' : 'zh'] ?? ''

export function projectTeamCapabilityRecord(team: ExpertTeam, experts: readonly ExpertSummary[], view?: DesktopMcpView): ExpertTeam {
  const dependencies = teamCapabilityBindings(team, experts)
  const serverFor = (name: string) => view?.mcpServers.find(server => server.serverName === name || server.connectorId === name)
  const connectors = mergeCapabilityBindings(dependencies.mcpServers.map(binding => {
    const server = serverFor(binding.name)
    const declared = server && team.connectors.find(item => serverFor(item.name)?.serverName === server.serverName)
    return { ...binding, name: declared?.name ?? binding.name }
  }))
  return { ...team, skills: dependencies.skills, connectors, connectorStates: connectors.map(binding => {
    const server = serverFor(binding.name)
    const entry = view?.catalog.find(item => item.id === binding.name || item.id === server?.connectorId)
    return {
      dependency: binding.name, installed: server !== undefined, installable: entry !== undefined,
      credentialsRequired: entry?.credentials.some(field => field.required) ?? false,
      ...(server ? { serverName: server.serverName, ...(server.connectorId ? { connectorId: server.connectorId } : {}) } : {}),
      enabled: server?.enabled ?? false, state: server?.state ?? 'missing', credentialsReady: server?.credentialsReady ?? false,
      toolCount: server?.tools.length ?? 0, diagnosticCode: server?.diagnostic.code ?? 'missing',
      ...(server?.error ? { error: server.error } : {}),
    }
  }) }
}

/** Build the runtime/UI team record for one package and only its own members. */
export function projectExpertPluginTeamRecord(
  team: ExpertPluginTeamDefinition,
  experts: readonly ExpertSummary[],
  locale: TeamLocale,
  connectorView?: DesktopMcpView,
): ExpertTeam {
  const bySlug = new Map(experts.map(expert => [expert.slug, expert]))
  const lead = bySlug.get(team.leadAgentSlug)
  const members = team.memberAgentSlugs.map(slug => bySlug.get(slug))
  if (lead === undefined || members.some(member => member === undefined)) throw new Error(`Team package is incomplete: ${team.packageName}`)
  const member = (expert: ExpertSummary, role: 'lead' | 'member') => ({
    expertSlug: expert.slug,
    name: locale === 'en' ? expert.nameEn || expert.name : expert.name || expert.nameEn,
    description: locale === 'en' ? expert.descriptionEn || expert.description : expert.description || expert.descriptionEn,
    role,
  })
  const initPrompt = localizedPluginText(team.defaultInitPrompt, locale)
  return projectTeamCapabilityRecord({
    id: team.id,
    builtin: true,
    runtime: { mode: 'lead', leadExpertSlug: lead.slug, initPrompt },
    provenance: { packageName: team.packageName, packageVersion: team.packageVersion, source: 'local' },
    name: localizedPluginText(team.name, locale),
    description: localizedPluginText(team.description, locale),
    tags: team.tags.map(value => localizedPluginText(value, locale)),
    examples: team.quickPrompts.map(value => localizedPluginText(value, locale)),
    goal: initPrompt,
    constraints: '',
    deliveryRequirements: initPrompt,
    coordinatorMode: 'custom',
    coordinatorTemplateId: 'general',
    coordinatorTemplateVersion: 1,
    coordinatorPrompt: initPrompt,
    members: [member(lead, 'lead'), ...members.map(value => member(value!, 'member'))].map(value => ({
      expertSlug: value.expertSlug,
      duty: value.role === 'lead' ? 'Lead' : value.name,
      instructions: value.description || initPrompt,
    })),
    skills: [...team.skills],
    connectors: [...team.connectors],
    connectorStates: [],
    ...(team.conversationCreated ? { conversationCreated: true } : {}),
  }, experts, connectorView)
}

export function createTeamLibrary(
  catalog: () => Promise<CatalogSnapshot>,
  store: ExpertSettingsStore,
  locale: () => TeamLocale = () => 'zh',
  definitions: () => Promise<readonly ExpertPluginTeamDefinition[]> = async () => [],
  connectors?: () => TeamConnectorLifecycle | undefined,
) {
  const tx = (key: string) => teamText(locale(), key)
  const read = () => ({
    custom: (store.read().customTeams ?? []).map((team) => {
      const input = teamInputSchema.parse(team)
      if (input.id === undefined || input.builtin !== false) throw new Error(tx('自定义专家团配置无效。'))
      return teamSchema.parse({
      ...input,
      runtime: { mode: 'coordinator', initPrompt: '' },
      skills: [],
      connectors: [],
      connectorStates: [],
    })}),
  })
  const check = (revision: number) => {
    if (!Number.isSafeInteger(revision) || revision !== store.revision())
      throw new Error(tx('配置已更新，请读取最新内容后重试。'))
  }
  const teams = (): ExpertTeam[] => [
    ...structuredClone(BUILTIN_TEAMS),
    ...read().custom,
  ]
  const composedTeams = async (all: CatalogSnapshot, items: readonly ExpertPluginTeamDefinition[]): Promise<ExpertTeam[]> => {
    const view = await (connectors?.()?.read() ?? Promise.resolve(undefined))
    return [
      ...teams().map(team => projectTeamCapabilityRecord(team, all.experts, view)),
      ...items.map(team => projectExpertPluginTeamRecord(team, all.experts, locale(), view)),
    ]
  }
  const requireMembers = (team: TeamInput, snapshot: CatalogSnapshot) => {
    if (
      team.members.some(
        (member) =>
          !snapshot.experts.some(
            (expert) => expert.slug === member.expertSlug && !expert.conflict,
          ),
      )
    )
      throw new Error(tx('团队成员已删除或名称冲突，请替换后重试。'))
  }
  const library = {
    async snapshot(): Promise<TeamSnapshot> {
      const definitionsSnapshot = await definitions()
      const all = await catalog()
      // 读取名册期间可能有其他窗口写入，不能混用两个修订的配置。
      const catalogTeams = await composedTeams(all, definitionsSnapshot)
      check(all.revision)
      return {
        teams: catalogTeams,
        enabledExperts: all.enabled,
        recalledTeams: [...new Set(store.read().recalledTeams ?? [])].filter(id => catalogTeams.some(team => team.id === id)),
        revision: all.revision,
      }
    },
    async get(id: string): Promise<ExpertTeam> {
      const all = await catalog()
      const team = (await composedTeams(all, await definitions())).find((team) => team.id === id)
      if (!team) throw new Error(tx('专家团不存在，请重新选择。'))
      return team
    },
    async recall(id: string, revision: number): Promise<TeamSnapshot> {
      const all = await catalog()
      check(revision)
      const team = (await composedTeams(all, await definitions())).find(candidate => candidate.id === id)
      if (team === undefined) throw new Error(tx('专家团不存在，请重新选择。'))
      requireMembers(team, all)
      const next = [...new Set([...all.enabled, ...team.members.map(member => member.expertSlug)])]
      const recalled = store.read().recalledTeams ?? []
      if (next.length !== all.enabled.length || !recalled.includes(id)) await store.mutate([
        { op: 'set', path: ['enabled'], value: next },
        { op: 'set', path: ['recalledTeams'], value: [...new Set([...recalled, id])] },
      ], revision)
      return library.snapshot()
    },
    async save(
      input: TeamInput,
      revision: number,
    ): Promise<TeamSnapshot> {
      const parsed = teamInputSchema.safeParse(input)
      if (!parsed.success)
        throw new Error(tx('请检查团队名称、成员分工、任务示例和主理人提示词。'))
      const value = parsed.data
      const all = await catalog()
      check(revision)
      if (value.id && !TEAM_CUSTOM_ID.test(value.id))
        throw new Error(tx('内置专家团只读，请复制为自定义。'))
      const state = read()
      if (value.id && !state.custom.some((team) => team.id === value.id))
        throw new Error(tx('专家团已删除，请作为新团队保存。'))
      if (!value.id && state.custom.length >= 100)
        throw new Error(tx('自定义专家团最多保存 100 个。'))
      if (
        teams().some(
          (team) =>
            team.id !== value.id &&
            [team.name, localizeTeam(team, 'en').name].some(name => name.trim().toLowerCase() === value.name.trim().toLowerCase()),
        )
      )
        throw new Error(tx('团队名称已被使用。'))
      requireMembers(value, all)
      const storedTeam = {
        ...value,
        id: value.id ?? `team-custom-${randomUUID()}`,
        builtin: false,
      }
      const team: ExpertTeam = {
        ...storedTeam,
        runtime: { mode: 'coordinator' as const, initPrompt: '' },
        skills: [],
        connectors: [],
        connectorStates: [],
      }
      await store.mutate(
        [
          {
            op: 'set',
            path: ['customTeams'],
            value: [...state.custom.filter((t) => t.id !== team.id).map(({ runtime: _runtime, skills: _skills, connectors: _connectors, connectorStates: _connectorStates, provenance: _provenance, ...input }) => input), storedTeam],
          },
        ],
        revision,
      )
      return library.snapshot()
    },
    async setConnectorEnabled(id: string, dependency: string, enabled: boolean): Promise<TeamSnapshot> {
      const team = (await definitions()).find(candidate => candidate.id === id)
      if (team === undefined || !team.connectors.some(item => item.name === dependency)) throw new Error('Team connector dependency does not exist.')
      const lifecycle = connectors?.()
      if (lifecycle === undefined) throw new Error('Connector lifecycle service is unavailable.')
      const view = await lifecycle.read()
      const server = view.mcpServers.find(item => item.serverName === dependency || item.connectorId === dependency)
      if (server === undefined) throw new Error(`Connector is not installed: ${dependency}`)
      await lifecycle.toggle(server.serverName, enabled)
      return library.snapshot()
    },
    async testConnector(id: string, dependency: string): Promise<TeamSnapshot> {
      const team = (await definitions()).find(candidate => candidate.id === id)
      if (team === undefined || !team.connectors.some(item => item.name === dependency)) throw new Error('Team connector dependency does not exist.')
      const lifecycle = connectors?.()
      if (lifecycle === undefined) throw new Error('Connector lifecycle service is unavailable.')
      const view = await lifecycle.read()
      const server = view.mcpServers.find(item => item.serverName === dependency || item.connectorId === dependency)
      if (server === undefined) throw new Error(`Connector is not installed: ${dependency}`)
      await lifecycle.test(server.serverName)
      return library.snapshot()
    },
    async installConnector(id: string, dependency: string, values: Readonly<Record<string, string>>): Promise<TeamSnapshot> {
      const team = (await definitions()).find(candidate => candidate.id === id)
      if (team === undefined || !team.connectors.some(item => item.name === dependency)) throw new Error('Team connector dependency does not exist.')
      const lifecycle = connectors?.()
      if (lifecycle === undefined) throw new Error('Connector lifecycle service is unavailable.')
      await lifecycle.install(dependency, values)
      return library.snapshot()
    },
    async remove(id: string, revision: number): Promise<TeamSnapshot> {
      check(revision)
      if (!TEAM_CUSTOM_ID.test(id) || !read().custom.some((t) => t.id === id))
        throw new Error(tx('只能删除已有的自定义专家团。'))
      await store.mutate(
        [
          { op: 'set', path: ['recalledTeams'], value: (store.read().recalledTeams ?? []).filter(item => item !== id) },
          {
            op: 'set',
            path: ['customTeams'],
            value: read().custom.filter((t) => t.id !== id),
          },
        ],
        revision,
      )
      return library.snapshot()
    },
  }
  return library
}
export type AgencyTeamLibrary = ReturnType<typeof createTeamLibrary>
