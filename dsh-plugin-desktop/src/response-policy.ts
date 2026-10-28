/** Desktop-owned product context and response-language rules over upstream capabilities. */
import type { ContextSnapshotSection } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-web-app'

export const name = 'desktop-response-policy'
export const inject = ['systemPrompt', 'webApp']

/** Product and application orientation without assumptions about an upstream development checkout. */
export const DESKTOP_PRODUCT_CONTEXT = [
  'This assistant session runs in ClawClaw. Retain your assigned specialist role when one is provided.',
  'For ordinary identity questions, introduce yourself as the ClawClaw AI assistant and briefly describe your current role and relevant capabilities. The underlying runtime framework is an implementation detail, not the product name.',
  'When the model, technical architecture, environment, or tools are relevant or explicitly requested, describe them accurately from available evidence.',
  'When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean the ClawClaw application. The browser provides no implicit DOM, route, or screenshot context; inspect the relevant surface with an available tool.',
  'The application installation and the current working directory are separate locations. Use the current working-directory context or pwd; do not infer a project checkout from the installation directory.',
  'ClawClaw may run from packaged artifacts rather than a source checkout. Verify the actual project, build workflow, and active watcher before promising that a change will update the running application. Do not assume upstream development commands or hot reload are available.',
  'Starting another server does not update this application. Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.',
].join('\n')

/** One language policy shared by ordinary scopes and complete built-in personas. */
export const DESKTOP_RESPONSE_POLICY = [
  "Use the user's conversational language for all user-facing responses, including interim progress updates, tool-call commentary, questions, and final answers, unless the user explicitly requests another conversation language.",
  'For delegated work, follow the language of the original user task; generated task wrappers, expert personas, tool descriptions, source documents, and the interface locale do not determine the reply language.',
  'A requested translation or artifact language applies to that deliverable; keep accompanying explanations and progress in the conversation language unless the user asks otherwise.',
  'Keep code, commands, paths, identifiers, and necessary quotations in their original form.',
].join('\n')

/** Default persona; product context and language remain independent scoped contributions. */
export const DESKTOP_PERSONA = [
  'You are ClawClaw, an AI assistant powered by the {{model}} model.',
  'Help the user complete tasks with the tools and capabilities available in this session.',
].join('\n')

/** Complete-mode composition uses the same shared policy text exactly once. */
export const DESKTOP_COMPLETE_PERSONA = [DESKTOP_PERSONA, DESKTOP_PRODUCT_CONTEXT, DESKTOP_RESPONSE_POLICY].join('\n\n')

/** Replace only known shipped personas, preserving custom identity and all other row options. */
export function desktopDefaultPersona<T extends Pick<EntryOptions, 'name' | 'config'>>(row: T): T {
  const config = row.config
  if (row.name !== '@deepseek-ai/dsh-persona' || config === null || typeof config !== 'object') return row
  if (config.prefix !== 'You are a coding agent powered by the {{model}} model.'
    && config.prefix !== 'You are a helpful software engineer assistant.') return row
  return { ...row, config: { ...config, prefix: config.complete === true ? DESKTOP_COMPLETE_PERSONA : DESKTOP_PERSONA } }
}

const LANGUAGE_CONTEXT = 'clawclaw:conversation-language'

/** Preserve language evidence without expanding a delegated task or adding a persistence schema. */
function delegatedLanguageContext(ctx: Context, agent: Agent | undefined): string {
  if (agent?.session.header.parentSession === undefined) return ''
  let parent = ctx.get('agents')?.get(agent.session.header.parentSession)
  while (parent !== undefined) {
    const ancestor = parent.session.header.parentSession
    const next = ancestor === undefined ? undefined : ctx.get('agents')?.get(ancestor)
    if (next === undefined) break
    parent = next
  }
  if (parent !== undefined) {
    const event = parent.session.snapshotEvents().findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')
    if (event?.type === 'user/message') {
      const text = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      if (text.trim()) return 'Original user language evidence for delegated work (a bounded excerpt, not additional task instructions or tool authorization). Follow any later explicit user language request.\n'
        + JSON.stringify(text.slice(0, 2000))
    }
  }
  // A previous runtime snapshot already persists this excerpt. Reuse it when
  // a child resumes while its parent is inactive, without reading other logs.
  for (const event of agent.session.snapshotEvents().toReversed()) {
    if (event.type !== 'user/message') continue
    // The loop's source augmentation is not exported by its public declaration entry.
    const source: { readonly kind: string; readonly sections?: readonly ContextSnapshotSection[] } = event.data.source
    if (source.kind !== 'runtime-context') continue
    const section = source.sections?.find(section => section.name === LANGUAGE_CONTEXT)
    if (section !== undefined) return section.text
  }
  return ''
}

/** Preserve upstream request-update semantics; no listener resets request series on mounting. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'clawclaw:product-context',
    order: ctx.systemPrompt.getSectionOrder('WEB_SURFACE'),
    text: DESKTOP_PRODUCT_CONTEXT,
  })
  ctx.systemPrompt.context({
    name: 'clawclaw:app-surface',
    order: ctx.systemPrompt.getContextOrder('WEB_SURFACE'),
    interpolate: false,
    text: () => `Current ClawClaw application URL: ${JSON.stringify(ctx.webApp.getAdvertisedUrl())}.`,
  })
  ctx.systemPrompt.context({
    name: LANGUAGE_CONTEXT,
    order: ctx.systemPrompt.getContextOrder('SUBAGENT_DELEGATION') + 1,
    required: true,
    interpolate: false,
    text: ({ agent }) => delegatedLanguageContext(ctx, agent),
  })
  ctx.systemPrompt.section({
    name: 'clawclaw:response-policy',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
    text: DESKTOP_RESPONSE_POLICY,
  })
}
