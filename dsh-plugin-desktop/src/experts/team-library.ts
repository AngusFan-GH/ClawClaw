import { teamText, type TeamLocale } from './team-i18n.js'
import { randomUUID } from 'node:crypto'
import { localizeTeam } from './team-content-en.js'
import type { CatalogSnapshot, ExpertSummary } from './expert-contract.js'
import type { ExpertSettingsStore } from './expert-library.js'
import type { ExpertPluginLocalizedText, ExpertPluginTeamDefinition } from './expert-plugin-package.js'
import type { DesktopMcpView } from '../mcp-contract.js'
import {
  BUILTIN_TEAMS,
  TEAM_CUSTOM_ID,
  teamInputSchema,
  teamSchema,
  type TeamInput,
  type TeamSnapshot,
  type ExpertTeam,
  type LeadExpertTeam,
} from './team-contract.js'
export const AGENCY_TEAM_SERVICE = 'agencyAgentsTeams'
export interface TeamConnectorLifecycle {
  read(): Promise<DesktopMcpView>
  toggle(serverName: string, enabled: boolean): Promise<DesktopMcpView>
  test(serverName: string): Promise<DesktopMcpView>
  install(connectorId: string, values: Readonly<Record<string, string>>): Promise<DesktopMcpView>
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
    custom: (store.read().customTeams ?? []).map((team) =>
      teamSchema.parse(team),
    ),
    enabled: [...(store.read().enabledTeams ?? [])],
  })
  const check = (revision: number) => {
    if (!Number.isSafeInteger(revision) || revision !== store.revision())
      throw new Error(tx('配置已更新，请读取最新内容后重试。'))
  }
  const teams = (): ExpertTeam[] => [
    ...structuredClone(BUILTIN_TEAMS),
    ...read().custom,
  ]
  const localized = (value: ExpertPluginLocalizedText): string =>
    value[locale()] ?? value[locale() === 'zh' ? 'en' : 'zh'] ?? ''
  const packageMember = (expert: ExpertSummary, role: 'lead' | 'member') => ({
    expertSlug: expert.slug,
    packageAgentId: expert.packageAgentId ?? expert.slug,
    name: locale() === 'en' ? expert.nameEn || expert.name : expert.name || expert.nameEn,
    description: locale() === 'en' ? expert.descriptionEn || expert.description : expert.description || expert.descriptionEn,
    role,
  })
  const connectorStates = (team: ExpertPluginTeamDefinition, view: DesktopMcpView | undefined): LeadExpertTeam['connectorStates'] =>
    team.connectors.map(binding => {
      const server = view?.mcpServers.find(item => item.serverName === binding.name || item.connectorId === binding.name)
      const entry = view?.catalog.find(item => item.id === binding.name)
      return {
        dependency: binding.name,
        installed: server !== undefined,
        installable: entry !== undefined,
        credentialsRequired: entry?.credentials.some(field => field.required) ?? false,
        ...(server?.serverName === undefined ? {} : { serverName: server.serverName }),
        ...(server?.connectorId === undefined ? {} : { connectorId: server.connectorId }),
        enabled: server?.enabled ?? false,
        state: server?.state ?? 'missing',
        credentialsReady: server?.credentialsReady ?? false,
        diagnosticCode: server?.diagnostic.code ?? 'missing',
        ...(server?.error === undefined ? {} : { error: server.error }),
      }
    })
  const packagedTeams = async (all: CatalogSnapshot, items: readonly ExpertPluginTeamDefinition[]): Promise<LeadExpertTeam[]> => {
    const connectorView = await (connectors?.()?.read() ?? Promise.resolve(undefined))
    const bySlug = new Map(all.experts.map(expert => [expert.slug, expert]))
    return items.map(team => {
      const lead = bySlug.get(team.leadAgentSlug)
      const members = team.memberAgentSlugs.map(slug => bySlug.get(slug))
      if (lead === undefined || members.some(member => member === undefined)) throw new Error(`Team package is incomplete: ${team.packageName}`)
      return {
        id: team.id,
        builtin: true,
        runtime: 'plugin-lead',
        packageName: team.packageName,
        packageVersion: team.packageVersion,
        source: 'local',
        status: 'installed',
        name: localized(team.name),
        description: localized(team.description),
        defaultInitPrompt: localized(team.defaultInitPrompt),
        tags: team.tags.map(localized),
        examples: team.quickPrompts.map(localized),
        lead: packageMember(lead, 'lead'),
        members: members.map(member => packageMember(member!, 'member')),
        skills: [...team.skills],
        connectors: [...team.connectors],
        connectorStates: connectorStates(team, connectorView),
      }
    })
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
      const packaged = await packagedTeams(all, definitionsSnapshot)
      // 读取名册期间可能有其他窗口写入，不能混用两个修订的配置。
      check(all.revision)
      const catalogTeams = [...teams(), ...packaged]
      const catalogIds = new Set(catalogTeams.map(team => team.id))
      return {
        teams: catalogTeams,
        enabledTeams: read().enabled.filter(id => catalogIds.has(id)),
        enabledExperts: all.enabled,
        revision: all.revision,
      }
    },
    async get(id: string): Promise<ExpertTeam> {
      const team = teams().find((team) => team.id === id)
      if (!team) throw new Error(tx('专家团不存在，请重新选择。'))
      return team
    },
    async save(
      input: TeamInput,
      enabled: boolean,
      revision: number,
    ): Promise<TeamSnapshot> {
      const parsed = teamInputSchema.safeParse(input)
      if (!parsed.success || typeof enabled !== 'boolean')
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
      const team = {
        ...value,
        id: value.id ?? `team-custom-${randomUUID()}`,
        builtin: false,
      }
      await store.mutate(
        [
          {
            op: 'set',
            path: ['customTeams'],
            value: [...state.custom.filter((t) => t.id !== team.id), team],
          },
          {
            op: 'set',
            path: ['enabledTeams'],
            value: [
              ...state.enabled.filter((id) => id !== team.id),
              ...(enabled ? [team.id] : []),
            ],
          },
          ...(enabled
            ? [
                {
                  op: 'set' as const,
                  path: ['enabled'],
                  value: [
                    ...new Set([
                      ...store.read().enabled,
                      ...team.members.map((m) => m.expertSlug),
                    ]),
                  ],
                },
              ]
            : []),
        ],
        revision,
      )
      return library.snapshot()
    },
    async setEnabled(
      id: string,
      enabled: boolean,
      revision: number,
    ): Promise<TeamSnapshot> {
      const definitionsSnapshot = await definitions()
      const all = await catalog()
      const packaged = await packagedTeams(all, definitionsSnapshot)
      const team = id.startsWith('plugin-team:') ? packaged.find(item => item.id === id) : await library.get(id)
      if (team === undefined) throw new Error(tx('专家团不存在，请重新选择。'))
      check(revision)
      if (typeof enabled !== 'boolean') throw new Error(tx('启用状态无效。'))
      const memberSlugs = 'runtime' in team
        ? [team.lead.expertSlug, ...team.members.map(member => member.expertSlug)]
        : team.members.map(member => member.expertSlug)
      if (enabled && memberSlugs.some(slug => !all.experts.some(expert => expert.slug === slug && !expert.conflict)))
        throw new Error(tx('团队成员已删除或名称冲突，请替换后重试。'))
      await store.mutate(
        [
          {
            op: 'set',
            path: ['enabledTeams'],
            value: [
              ...read().enabled.filter((item) => item !== id),
              ...(enabled ? [id] : []),
            ],
          },
          ...(enabled
            ? [
                {
                  op: 'set' as const,
                  path: ['enabled'],
                  value: [
                    ...new Set([
                      ...store.read().enabled,
                      ...memberSlugs,
                    ]),
                  ],
                },
              ]
            : []),
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
          {
            op: 'set',
            path: ['customTeams'],
            value: read().custom.filter((t) => t.id !== id),
          },
          {
            op: 'set',
            path: ['enabledTeams'],
            value: read().enabled.filter((t) => t !== id),
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
