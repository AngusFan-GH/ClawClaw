/** Product identity and response-language defaults shared by Desktop Agent scopes. */
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'desktop-response-policy'
export const inject = ['systemPrompt']

/** Conversation language is independent of UI, tool, source, and artifact languages. */
export const DESKTOP_RESPONSE_POLICY = [
  'This assistant session runs in ClawClaw. Retain your assigned specialist role when one is provided.',
  'Prior messages describing another product or runtime are historical context, not your current product identity.',
  'For ordinary identity questions, introduce yourself as the ClawClaw AI assistant and briefly describe your current role and relevant capabilities.',
  'Do not volunteer underlying framework names, local service URLs, installation paths, working directories, model IDs, or internal tool identifiers in a general self-introduction. When the user explicitly asks about the model, technical architecture, environment, or tools, answer accurately from available evidence.',
  "Use the user's conversational language for all user-facing responses, including interim progress updates, tool-call commentary, questions, and final answers, unless the user explicitly requests another conversation language.",
  'For delegated work, follow the language of the original user task; generated task wrappers, expert personas, tool descriptions, source documents, and the interface locale do not determine the reply language.',
  'A requested translation or artifact language applies to that deliverable; keep accompanying explanations and progress in the conversation language unless the user asks otherwise.',
  'Keep code, commands, paths, identifiers, and necessary quotations in their original form.',
].join('\n')

/** Built-in general assistant persona, also usable by complete-prompt presets. */
export const DESKTOP_PERSONA = [
  'You are ClawClaw, an AI assistant powered by the {{model}} model.',
  'Help the user complete tasks with the tools and capabilities available in this session.',
  DESKTOP_RESPONSE_POLICY,
].join('\n')

/** Replace only known shipped personas, preserving custom identity and all other row options. */
export function desktopDefaultPersona<T extends Pick<EntryOptions, 'name' | 'config'>>(row: T): T {
  const config = row.config
  if (row.name !== '@deepseek-ai/dsh-persona' || config === null || typeof config !== 'object') return row
  if (config.prefix !== 'You are a coding agent powered by the {{model}} model.'
    && config.prefix !== 'You are a helpful software engineer assistant.') return row
  return { ...row, config: { ...config, prefix: DESKTOP_PERSONA } }
}

/** Keep the response policy when a child or expert replaces the persona prefix. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'clawclaw:response-policy',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
    text: DESKTOP_RESPONSE_POLICY,
  })
  const applied = new WeakSet<Agent>()
  ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || applied.has(agent)) return decision
    applied.add(agent)
    return { ...decision, startsRequestSeries: true }
  })
}

