import type { ExpertSummary } from './expert-contract.js'
import type { ExpertPluginTeamDefinition } from './expert-plugin-package.js'

export type ExpertPluginTeamPhase = 'plan' | 'member' | 'synthesize'

export interface ExpertPluginAgentRun {
  readonly phase: ExpertPluginTeamPhase
  readonly expert: ExpertSummary
  readonly persona: string
  readonly prompt: string
}

export interface ExpertPluginMemberResult {
  readonly slug: string
  readonly name: string
  readonly ok: boolean
  readonly answer: string
  readonly error?: string
}

export interface ExpertPluginTeamResult {
  readonly teamId: string
  readonly packageName: string
  readonly packageVersion: string
  readonly leadAgentSlug: string
  readonly plan: string
  readonly members: readonly ExpertPluginMemberResult[]
  readonly answer: string
}

function requireExpert(slug: string, experts: readonly ExpertSummary[]): ExpertSummary {
  const expert = experts.find(candidate => candidate.slug === slug && !candidate.conflict)
  if (expert === undefined) throw new Error(`Expert plugin Agent is unavailable: ${slug}`)
  return expert
}

function memberEvidence(results: readonly ExpertPluginMemberResult[]): string {
  return results.map(result => result.ok
    ? `## ${result.name} (${result.slug})\n${result.answer}`
    : `## ${result.name} (${result.slug})\nFAILED: ${result.error ?? 'Unknown failure'}`).join('\n\n')
}

/** Execute a Plugin Team with a real lead identity before and after member work. */
export async function executeExpertPluginTeam(args: {
  readonly team: ExpertPluginTeamDefinition
  readonly experts: readonly ExpertSummary[]
  readonly enabled: readonly string[]
  readonly task: string
  readonly signal?: AbortSignal
  readPersona(expert: ExpertSummary): Promise<string>
  runAgent(run: ExpertPluginAgentRun): Promise<string>
}): Promise<ExpertPluginTeamResult> {
  const task = args.task.trim()
  if (task.length === 0 || Array.from(task).length > 24_000) throw new Error('Plugin Team task must contain 1 to 24000 characters')
  args.signal?.throwIfAborted()
  const enabled = new Set(args.enabled)
  const lead = requireExpert(args.team.leadAgentSlug, args.experts)
  const members = args.team.memberAgentSlugs.map(slug => requireExpert(slug, args.experts))
  for (const expert of [lead, ...members]) {
    if (!enabled.has(expert.slug)) throw new Error(`Expert plugin Agent is disabled: ${expert.slug}`)
  }
  const leadPersona = await args.readPersona(lead)
  args.signal?.throwIfAborted()
  const plan = await args.runAgent({
    phase: 'plan',
    expert: lead,
    persona: leadPersona,
    prompt: [
      `You are the lead Agent for Plugin Team ${args.team.packageName}.`,
      `Task:\n${task}`,
      `Members:\n${members.map(member => `- ${member.name} (${member.slug})`).join('\n')}`,
      'Create a concise execution plan and a specific brief for each member. Do not answer the task yet.',
    ].join('\n\n'),
  })
  if (plan.trim() === '') throw new Error(`Plugin Team lead returned an empty plan: ${lead.slug}`)

  const results = await Promise.all(members.map(async (member): Promise<ExpertPluginMemberResult> => {
    try {
      const persona = await args.readPersona(member)
      args.signal?.throwIfAborted()
      const answer = await args.runAgent({
        phase: 'member',
        expert: member,
        persona,
        prompt: [
          `You are a member of Plugin Team ${args.team.packageName}.`,
          `Task:\n${task}`,
          `Lead plan:\n${plan}`,
          `Your identity: ${member.name} (${member.slug}). Complete only the work assigned to your identity and return evidence, conclusions, and unresolved gaps.`,
        ].join('\n\n'),
      })
      if (answer.trim() === '') throw new Error('Agent returned an empty result')
      return { slug: member.slug, name: member.name, ok: true, answer }
    } catch (cause) {
      args.signal?.throwIfAborted()
      return { slug: member.slug, name: member.name, ok: false, answer: '', error: cause instanceof Error ? cause.message : String(cause) }
    }
  }))

  args.signal?.throwIfAborted()
  const answer = await args.runAgent({
    phase: 'synthesize',
    expert: lead,
    persona: leadPersona,
    prompt: [
      `You are the lead Agent for Plugin Team ${args.team.packageName}.`,
      `Task:\n${task}`,
      `Your approved plan:\n${plan}`,
      `Member evidence:\n${memberEvidence(results)}`,
      'Produce the final team answer. Reconcile disagreements, identify failed coverage, and do not invent missing member evidence.',
    ].join('\n\n'),
  })
  if (answer.trim() === '') throw new Error(`Plugin Team lead returned an empty final answer: ${lead.slug}`)
  return {
    teamId: args.team.id,
    packageName: args.team.packageName,
    packageVersion: args.team.packageVersion,
    leadAgentSlug: lead.slug,
    plan,
    members: results,
    answer,
  }
}
