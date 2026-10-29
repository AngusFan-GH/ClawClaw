import type { ExpertSummary } from './expert-contract.js'
import type { ExpertPluginTeamDefinition } from './expert-plugin-package.js'

export type ExpertPluginTeamPhase = 'plan' | 'produce' | 'member' | 'synthesize'

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
  readonly production?: string
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

/** Execute a lead-runtime team with a real lead identity before and after member work. */
export async function executeExpertPluginTeam(args: {
  readonly team: ExpertPluginTeamDefinition
  readonly experts: readonly ExpertSummary[]
  readonly enabled: readonly string[]
  readonly task: string
  readonly signal?: AbortSignal
  readonly runDirectory?: string
  readPersona(expert: ExpertSummary): Promise<string>
  runAgent(run: ExpertPluginAgentRun): Promise<string>
}): Promise<ExpertPluginTeamResult> {
  const task = args.task.trim()
  if (task.length === 0 || Array.from(task).length > 24_000) throw new Error('Team task must contain 1 to 24000 characters')
  args.signal?.throwIfAborted()
  const enabled = new Set(args.enabled)
  const lead = requireExpert(args.team.leadAgentSlug, args.experts)
  const members = args.team.memberAgentSlugs.map(slug => requireExpert(slug, args.experts))
  for (const expert of [lead, ...members]) {
    if (!enabled.has(expert.slug)) throw new Error(`Expert plugin Agent is disabled: ${expert.slug}`)
  }
  const leadPersona = await args.readPersona(lead)
  const pipeline = args.team.execution === 'pipeline'
  const workspace = args.runDirectory === undefined ? '' : [
    `This run's output directory: ${args.runDirectory}`,
    'Write all intermediate and final artifacts inside this directory. Use only the task inputs and explicit upstream handoffs for document content. Never resume another task’s pipeline-state or use an unrelated report as source material. Do not search the whole filesystem for Skills or member implementations; report an unavailable dependency and return instead of waiting for another stage.',
  ].join('\n')
  args.signal?.throwIfAborted()
  const plan = await args.runAgent({
    phase: 'plan',
    expert: lead,
    persona: leadPersona,
    prompt: [
      `You are the lead Agent for team ${args.team.packageName}.`,
      `Task:\n${task}`,
      workspace,
      `Members (agent identities, not Skill names or paths):\n${members.map(member => `- ${member.name} (${member.slug}): ${member.description}\n  Bound Skills: ${member.skills.filter(binding => binding.enabled).map(binding => binding.name).join(', ') || 'none'}`).join('\n')}`,
      'Create a concise execution plan and a specific brief for each member. Do not answer the task yet.',
      'This is a planning-only phase with no tools. Use the supplied roster and task. Do not load member identities as Skills, search the filesystem for their implementations, or perform research or production work. The host will execute each member and provide their results for synthesis. State assumptions and missing inputs in the plan, then return it immediately.',
      ...(pipeline ? ['The host will next run you to produce the source draft, then run members sequentially in the listed order. Each stage receives the previous stages’ actual results. Do not assign stages to wait or poll for files.'] : []),
    ].join('\n\n'),
  })
  if (plan.trim() === '') throw new Error(`Team lead returned an empty plan: ${lead.slug}`)

  const production = pipeline ? await args.runAgent({
    phase: 'produce', expert: lead, persona: leadPersona,
    prompt: [
      `Task:\n${task}`, workspace, `Lead plan:\n${plan}`,
      'Execute your own production role now: create the complete source draft required by the first member. This is execution, not another plan. Do not delegate, format, or convert the document. Save the source draft in this run’s directory, then return its absolute path, a content summary, and any gaps. Do not return until your source artifact is ready for the next stage.',
    ].join('\n\n'),
  }) : undefined
  if (production !== undefined && production.trim() === '') throw new Error(`Team lead returned an empty source handoff: ${lead.slug}`)
  const results: ExpertPluginMemberResult[] = []
  const runMember = async (member: ExpertSummary): Promise<ExpertPluginMemberResult> => {
    try {
      const persona = await args.readPersona(member)
      args.signal?.throwIfAborted()
      const answer = await args.runAgent({
        phase: 'member',
        expert: member,
        persona,
        prompt: [
          `You are a member of team ${args.team.packageName}.`,
          `Task:\n${task}`,
          workspace,
          `Lead plan:\n${plan}`,
          ...(pipeline ? [`Completed upstream handoffs:\n${production}\n\n${memberEvidence(results)}`, 'Previous stages have already finished. Use the supplied handoff paths; do not wait for files, inspect another task’s pipeline, or invent a missing input. If a handoff artifact is unavailable, return the gap immediately. Return the absolute path of your output for the next stage.'] : []),
          `Your identity: ${member.name} (${member.slug}). Complete only the work assigned to your identity and return evidence, conclusions, and unresolved gaps.`,
        ].join('\n\n'),
      })
      if (answer.trim() === '') throw new Error('Agent returned an empty result')
      return { slug: member.slug, name: member.name, ok: true, answer }
    } catch (cause) {
      args.signal?.throwIfAborted()
      return { slug: member.slug, name: member.name, ok: false, answer: '', error: cause instanceof Error ? cause.message : String(cause) }
    }
  }
  if (pipeline) {
    for (const member of members) {
      args.signal?.throwIfAborted()
      results.push(results.some(result => !result.ok)
        ? { slug: member.slug, name: member.name, ok: false, answer: '', error: 'Not started because an upstream stage failed.' }
        : await runMember(member))
    }
  } else {
    results.push(...await Promise.all(members.map(runMember)))
  }

  args.signal?.throwIfAborted()
  const answer = await args.runAgent({
    phase: 'synthesize',
    expert: lead,
    persona: leadPersona,
    prompt: [
      `You are the lead Agent for team ${args.team.packageName}.`,
      `Task:\n${task}`,
      workspace,
      `Your approved plan:\n${plan}`,
      ...(production === undefined ? [] : [`Source production handoff:\n${production}`]),
      `Member evidence:\n${memberEvidence(results)}`,
      'Produce the final team answer. Reconcile disagreements, identify failed coverage, and do not invent missing member evidence.',
    ].join('\n\n'),
  })
  if (answer.trim() === '') throw new Error(`Team lead returned an empty final answer: ${lead.slug}`)
  return {
    teamId: args.team.id,
    packageName: args.team.packageName,
    packageVersion: args.team.packageVersion,
    leadAgentSlug: lead.slug,
    plan,
    ...(production === undefined ? {} : { production }),
    members: results,
    answer,
  }
}
