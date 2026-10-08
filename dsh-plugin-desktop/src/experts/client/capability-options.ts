import type { DesktopMcpServerView } from '../../mcp-contract.js'
import type { DesktopSkillView } from '../../skills-contract.js'
import type { ExpertCapabilityBinding } from '../expert-contract.js'

export interface ExpertCapabilityOptions {
  readonly skills: readonly string[]
  readonly mcpServers: readonly string[]
}

export type ExpertCapabilityState = 'ready' | 'disabled' | 'starting' | 'error' | 'empty' | 'missing'

export interface ExpertCapabilityOption {
  readonly value: string
  readonly label: string
  readonly state: ExpertCapabilityState
  readonly available: boolean
  readonly detail?: string
}

export interface ExpertCapabilityCatalog {
  readonly skills: readonly ExpertCapabilityOption[]
  readonly mcpServers: readonly ExpertCapabilityOption[]
}

export interface ExpertCapabilityHealth {
  readonly state: 'ready' | 'degraded' | 'blocked' | 'unknown'
  readonly ready: number
  readonly total: number
  readonly issues: ReadonlyArray<{ readonly type: 'skill' | 'mcp'; readonly name: string; readonly required: boolean; readonly state: ExpertCapabilityState }>
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

/** Only capabilities that can be resolved by an expert right now are offered. */
export function selectableExpertCapabilities(
  skills: readonly DesktopSkillView[],
  mcpServers: readonly DesktopMcpServerView[],
): ExpertCapabilityOptions {
  return {
    skills: uniqueSorted(skills.filter(skill => skill.modelInvocable).map(skill => skill.name)),
    mcpServers: uniqueSorted(mcpServers
      .filter(server => server.enabled && server.state === 'running' && server.tools.length > 0)
      .map(server => server.serverName)),
  }
}

/** Project the complete configured catalog. Availability is state, not membership. */
export function expertCapabilityCatalog(
  skills: readonly DesktopSkillView[],
  mcpServers: readonly DesktopMcpServerView[],
): ExpertCapabilityCatalog {
  return {
    skills: [...skills].sort((left, right) => left.name.localeCompare(right.name)).map(skill => ({
      value: skill.name,
      label: skill.name,
      state: skill.modelInvocable ? 'ready' as const : 'disabled' as const,
      available: skill.modelInvocable,
      detail: skill.description,
    })),
    mcpServers: [...mcpServers].sort((left, right) => left.serverName.localeCompare(right.serverName)).map(server => {
      const state: ExpertCapabilityState = !server.enabled ? 'disabled'
        : server.state === 'starting' ? 'starting'
          : server.state === 'error' || !server.credentialsReady ? 'error'
            : server.tools.length === 0 ? 'empty' : 'ready'
      return {
        value: server.serverName,
        label: server.serverName,
        state,
        available: state === 'ready',
        ...(server.error === undefined ? {} : { detail: server.error }),
      }
    }),
  }
}

export function expertCapabilityHealth(
  expert: Pick<{ skills: readonly ExpertCapabilityBinding[]; mcpServers: readonly ExpertCapabilityBinding[] }, 'skills' | 'mcpServers'>,
  catalog: ExpertCapabilityCatalog,
  loading = false,
): ExpertCapabilityHealth {
  const activeTotal = [...expert.skills, ...expert.mcpServers].filter(item => item.enabled).length
  if (loading) return { state: 'unknown', ready: 0, total: activeTotal, issues: [] }
  const skillStates = new Map(catalog.skills.map(item => [item.value, item]))
  const mcpStates = new Map(catalog.mcpServers.map(item => [item.value, item]))
  const issues: Array<{ type: 'skill' | 'mcp'; name: string; required: boolean; state: ExpertCapabilityState }> = []
  let ready = 0
  const inspect = (type: 'skill' | 'mcp', bindings: readonly ExpertCapabilityBinding[], states: ReadonlyMap<string, ExpertCapabilityOption>): void => {
    for (const binding of bindings.filter(item => item.enabled)) {
      const item = states.get(binding.name)
      if (item?.available === true) ready++
      else issues.push({ type, name: binding.name, required: binding.required, state: item?.state ?? 'missing' })
    }
  }
  inspect('skill', expert.skills, skillStates)
  inspect('mcp', expert.mcpServers, mcpStates)
  const total = ready + issues.length
  return {
    state: issues.some(issue => issue.required) ? 'blocked' : issues.length > 0 ? 'degraded' : 'ready',
    ready,
    total,
    issues,
  }
}

/** Keep stale saved bindings visible until the user explicitly removes them. */
export function capabilitySelectOptions(
  available: readonly string[],
  selected: readonly string[],
  unavailableLabel: string,
): Array<{ value: string, label: string }> {
  const availableSet = new Set(available)
  return [
    ...uniqueSorted(available).map(value => ({ value, label: value })),
    ...uniqueSorted(selected.filter(value => !availableSet.has(value)))
      .map(value => ({ value, label: `${value} (${unavailableLabel})` })),
  ]
}

export function capabilityCatalogSelectOptions(
  available: readonly ExpertCapabilityOption[],
  selected: readonly string[],
  stateLabel: (state: ExpertCapabilityState) => string,
): Array<{ value: string; label: string; title?: string }> {
  const known = new Set(available.map(item => item.value))
  return [
    ...available.map(item => ({
      value: item.value,
      label: item.available ? item.label : `${item.label} (${stateLabel(item.state)})`,
      ...(item.detail === undefined || item.detail === '' ? {} : { title: item.detail }),
    })),
    ...uniqueSorted(selected.filter(value => !known.has(value))).map(value => ({ value, label: `${value} (${stateLabel('missing')})` })),
  ]
}

export function updateCapabilityBindings(
  current: readonly ExpertCapabilityBinding[],
  selected: readonly string[],
): ExpertCapabilityBinding[] {
  const existing = new Map(current.map(binding => [binding.name, binding]))
  return [...new Set(selected)].slice(0, 32).map(name => existing.get(name) ?? { name, required: true, enabled: true })
}
