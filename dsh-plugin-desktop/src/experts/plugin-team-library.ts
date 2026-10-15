import type { CatalogSnapshot, ExpertSummary } from './expert-contract.js'
import type { ExpertSettingsStore } from './expert-library.js'
import type { ExpertPluginTeamDefinition, ExpertPluginLocalizedText } from './expert-plugin-package.js'
import type { PluginTeamSnapshot, PluginTeamState, PluginTeamSummary } from './plugin-team-contract.js'
import type { DesktopMcpView } from '../mcp-contract.js'

export const AGENCY_PLUGIN_TEAM_SERVICE = 'agencyAgentsPluginTeams'

export interface PluginTeamConnectorLifecycle {
  read(): Promise<DesktopMcpView>
  toggle(serverName: string, enabled: boolean): Promise<DesktopMcpView>
  test(serverName: string): Promise<DesktopMcpView>
  install(connectorId: string, values: Readonly<Record<string, string>>): Promise<DesktopMcpView>
}

const text = (value: ExpertPluginLocalizedText, locale: 'zh' | 'en'): string =>
  value[locale] ?? value[locale === 'zh' ? 'en' : 'zh'] ?? ''

const slugs = (team: ExpertPluginTeamDefinition): string[] => [team.leadAgentSlug, ...team.memberAgentSlugs]

export function createPluginTeamLibrary(
  definitions: () => Promise<readonly ExpertPluginTeamDefinition[]>,
  catalog: () => Promise<CatalogSnapshot>,
  store: ExpertSettingsStore,
  locale: () => 'zh' | 'en',
  connectors?: () => PluginTeamConnectorLifecycle | undefined,
) {
  const readStates = (): PluginTeamState[] => [...(store.read().pluginTeamStates ?? [])]
  const check = (revision: number): void => {
    if (!Number.isSafeInteger(revision) || revision !== store.revision()) throw new Error('Plugin Team settings changed. Refresh and try again.')
  }
  const isEnabled = (team: ExpertPluginTeamDefinition, state: readonly PluginTeamState[], enabled: ReadonlySet<string>): boolean => {
    const configured = state.find(item => item.packageName === team.packageName)?.enabled
    return configured !== false && slugs(team).every(slug => enabled.has(slug))
  }
  const member = (expert: ExpertSummary, role: 'lead' | 'member') => ({
    slug: expert.slug,
    packageAgentId: expert.packageAgentId ?? expert.slug,
    name: locale() === 'en' ? expert.nameEn || expert.name : expert.name || expert.nameEn,
    description: locale() === 'en' ? expert.descriptionEn || expert.description : expert.description || expert.descriptionEn,
    role,
  })
  const connectorStates = (team: ExpertPluginTeamDefinition, view: DesktopMcpView | undefined): PluginTeamSummary['connectorStates'] =>
    team.connectors.map(binding => {
      const server = view?.mcpServers.find(item => item.serverName === binding.name || item.connectorId === binding.name)
      const catalog = view?.catalog.find(item => item.id === binding.name)
      return {
        dependency: binding.name,
        installed: server !== undefined,
        installable: catalog !== undefined,
        credentialsRequired: catalog?.credentials.some(field => field.required) ?? false,
        ...(server?.serverName === undefined ? {} : { serverName: server.serverName }),
        ...(server?.connectorId === undefined ? {} : { connectorId: server.connectorId }),
        enabled: server?.enabled ?? false,
        state: server?.state ?? 'missing',
        credentialsReady: server?.credentialsReady ?? false,
        diagnosticCode: server?.diagnostic.code ?? 'missing',
        ...(server?.error === undefined ? {} : { error: server.error }),
      }
    })
  const project = (team: ExpertPluginTeamDefinition, all: CatalogSnapshot, state: readonly PluginTeamState[], connectorView: DesktopMcpView | undefined): PluginTeamSummary => {
    const bySlug = new Map(all.experts.map(expert => [expert.slug, expert]))
    const lead = bySlug.get(team.leadAgentSlug)
    const members = team.memberAgentSlugs.map(slug => bySlug.get(slug))
    if (lead === undefined || members.some(candidate => candidate === undefined)) throw new Error(`Plugin Team package is incomplete: ${team.packageName}`)
    return {
      id: team.id,
      packageName: team.packageName,
      installedVersion: team.packageVersion,
      source: 'local',
      status: 'installed',
      enabled: isEnabled(team, state, new Set(all.enabled)),
      runtime: 'plugin-lead',
      name: text(team.name, locale()),
      description: text(team.description, locale()),
      defaultInitPrompt: text(team.defaultInitPrompt, locale()),
      tags: team.tags.map(value => text(value, locale())),
      quickPrompts: team.quickPrompts.map(value => text(value, locale())),
      lead: member(lead, 'lead'),
      members: members.map(expert => member(expert!, 'member')),
      skills: [...team.skills],
      connectors: [...team.connectors],
      connectorStates: connectorStates(team, connectorView),
    }
  }
  const library = {
    async snapshot(): Promise<PluginTeamSnapshot> {
      const [teams, all, connectorView] = await Promise.all([definitions(), catalog(), connectors?.()?.read() ?? Promise.resolve(undefined)])
      check(all.revision)
      const state = readStates()
      return { teams: teams.map(team => project(team, all, state, connectorView)), revision: all.revision }
    },
    async setEnabled(id: string, enabled: boolean, revision: number): Promise<PluginTeamSnapshot> {
      const teams = await definitions()
      const team = teams.find(candidate => candidate.id === id)
      if (team === undefined) throw new Error('Plugin Team does not exist. Refresh and try again.')
      const all = await catalog()
      check(revision)
      const teamSlugs = slugs(team)
      const available = new Set(all.experts.filter(expert => !expert.conflict).map(expert => expert.slug))
      if (enabled && teamSlugs.some(slug => !available.has(slug))) throw new Error('Plugin Team package is incomplete or conflicts with another expert.')
      const states = readStates().filter(item => item.packageName !== team.packageName)
      const nextEnabled = new Set(all.enabled)
      for (const slug of teamSlugs) enabled ? nextEnabled.add(slug) : nextEnabled.delete(slug)
      await store.mutate([
        { op: 'set', path: ['pluginTeamStates'], value: [...states, { packageName: team.packageName, enabled }] },
        { op: 'set', path: ['enabled'], value: [...nextEnabled] },
      ], revision)
      return library.snapshot()
    },
    async setConnectorEnabled(id: string, dependency: string, enabled: boolean): Promise<PluginTeamSnapshot> {
      const team = (await definitions()).find(candidate => candidate.id === id)
      if (team === undefined || !team.connectors.some(item => item.name === dependency)) throw new Error('Plugin Team connector dependency does not exist.')
      const lifecycle = connectors?.()
      if (lifecycle === undefined) throw new Error('Connector lifecycle service is unavailable.')
      const view = await lifecycle.read()
      const server = view.mcpServers.find(item => item.serverName === dependency || item.connectorId === dependency)
      if (server === undefined) throw new Error(`Connector is not installed: ${dependency}`)
      await lifecycle.toggle(server.serverName, enabled)
      return library.snapshot()
    },
    async testConnector(id: string, dependency: string): Promise<PluginTeamSnapshot> {
      const team = (await definitions()).find(candidate => candidate.id === id)
      if (team === undefined || !team.connectors.some(item => item.name === dependency)) throw new Error('Plugin Team connector dependency does not exist.')
      const lifecycle = connectors?.()
      if (lifecycle === undefined) throw new Error('Connector lifecycle service is unavailable.')
      const view = await lifecycle.read()
      const server = view.mcpServers.find(item => item.serverName === dependency || item.connectorId === dependency)
      if (server === undefined) throw new Error(`Connector is not installed: ${dependency}`)
      await lifecycle.test(server.serverName)
      return library.snapshot()
    },
    async installConnector(id: string, dependency: string, values: Readonly<Record<string, string>>): Promise<PluginTeamSnapshot> {
      const team = (await definitions()).find(candidate => candidate.id === id)
      if (team === undefined || !team.connectors.some(item => item.name === dependency)) throw new Error('Plugin Team connector dependency does not exist.')
      const lifecycle = connectors?.()
      if (lifecycle === undefined) throw new Error('Connector lifecycle service is unavailable.')
      await lifecycle.install(dependency, values)
      return library.snapshot()
    },
  }
  return library
}

export type AgencyPluginTeamLibrary = ReturnType<typeof createPluginTeamLibrary>
