import type { ExpertCapabilityBinding, ExpertSummary } from './expert-contract.js'

/** A disabled requirement must not turn an enabled optional binding into a requirement. */
export function mergeCapabilityBindings(...groups: readonly (readonly ExpertCapabilityBinding[])[]): ExpertCapabilityBinding[] {
  const merged = new Map<string, ExpertCapabilityBinding>()
  for (const binding of groups.flat()) {
    const previous = merged.get(binding.name)
    if (!previous) { merged.set(binding.name, { ...binding }); continue }
    const enabled = previous.enabled || binding.enabled
    merged.set(binding.name, {
      name: binding.name, enabled,
      required: enabled ? (previous.enabled && previous.required) || (binding.enabled && binding.required) : previous.required || binding.required,
    })
  }
  return [...merged.values()]
}

/** Aggregate dependencies for display and readiness, without granting peers' tools to a member. */
export function teamCapabilityBindings(
  team: { readonly members: readonly { readonly expertSlug: string }[]; readonly skills?: readonly ExpertCapabilityBinding[]; readonly connectors?: readonly ExpertCapabilityBinding[] },
  experts: readonly Pick<ExpertSummary, 'slug' | 'skills' | 'mcpServers'>[],
): { skills: ExpertCapabilityBinding[]; mcpServers: ExpertCapabilityBinding[] } {
  const members = team.members.flatMap(member => {
    const expert = experts.find(candidate => candidate.slug === member.expertSlug)
    return expert ? [expert] : []
  })
  return {
    skills: mergeCapabilityBindings(team.skills ?? [], ...members.map(member => member.skills)),
    mcpServers: mergeCapabilityBindings(team.connectors ?? [], ...members.map(member => member.mcpServers)),
  }
}
