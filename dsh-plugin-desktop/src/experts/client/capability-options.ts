import type { DesktopMcpServerView } from '../../mcp-contract.js'
import type { DesktopSkillView } from '../../skills-contract.js'
import type { ExpertCapabilityBinding } from '../expert-contract.js'

export interface ExpertCapabilityOptions {
  readonly skills: readonly string[]
  readonly mcpServers: readonly string[]
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

export function updateCapabilityBindings(
  current: readonly ExpertCapabilityBinding[],
  selected: readonly string[],
): ExpertCapabilityBinding[] {
  const existing = new Map(current.map(binding => [binding.name, binding]))
  return [...new Set(selected)].slice(0, 32).map(name => existing.get(name) ?? { name, required: true, enabled: true })
}
