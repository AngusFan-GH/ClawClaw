/** Expert identity and MCP restrictions on DSH's managed activation API. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, appendPluginRecord, pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { SubagentProvider, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'

interface ExpertComposition {
  readonly version: 1
  readonly persona: string
  readonly deniedTools: string[]
  readonly allowedTools?: string[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    'plugin:clawclaw/expert-composition': ExpertComposition
  }
}

/** Only local providers support the scoped creation hook used by experts. */
export function supportsExpertComposition(provider: SubagentProvider): boolean {
  return provider.prepareContinuable !== undefined
}

function applyComposition(agent: Agent, value: ExpertComposition): void {
  agent.ctx.systemPrompt.section({
    name: 'deployment:persona-prefix',
    order: agent.ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    text: value.persona,
  })
  agent.ctx.tools.restrict({ deny: value.deniedTools, ...(value.allowedTools === undefined ? {} : { allow: value.allowedTools }) })
}

/** Restore child-owned expert overrides before a resumed Agent can execute. */
export function installExpertCompositionRecovery(ctx: Context): void {
  ctx.on('agent/created', ({ agent }) => {
    const record = agent.session.snapshotEvents().map(pluginRecordOf).find(record =>
      record?.type === 'plugin:clawclaw/expert-composition' && agent.session.isOwnSeq(record.seq))
    if (record === undefined) return
    const value = record.data as Partial<ExpertComposition> | null
    if (value === null || typeof value !== 'object' || value.version !== 1 || typeof value.persona !== 'string'
      || !Array.isArray(value.deniedTools) || !value.deniedTools.every(name => typeof name === 'string')
      || (value.allowedTools !== undefined && (!Array.isArray(value.allowedTools) || !value.allowedTools.every(name => typeof name === 'string')))) {
      throw new Error('Invalid persisted ClawClaw expert composition')
    }
    applyComposition(agent, { version: 1, persona: value.persona, deniedTools: value.deniedTools, ...(value.allowedTools === undefined ? {} : { allowedTools: value.allowedTools }) })
  })
}

/** Preserve caller-owned results, cancellation, persona and tool isolation. */
export async function startExpertSubagent(
  ctx: Context,
  provider: string,
  options: Omit<SubagentStartRequest, 'signal'> & {
    readonly signal?: AbortSignal
    readonly persona: string
    readonly toolFilter: { readonly deny: readonly string[]; readonly allow?: readonly string[] }
  },
) {
  const backend = ctx.subagents.getProvider(provider)
  if (backend === undefined || !supportsExpertComposition(backend)) {
    throw new Error('Expert composition requires a local subagent provider')
  }
  const childId = SessionId(`expert-${randomUUID()}`)
  const { label = 'expert', signal = new AbortController().signal, persona, toolFilter, ...request } = options
  const composition: ExpertComposition = { version: 1, persona, deniedTools: [...toolFilter.deny], ...(toolFilter.allow === undefined ? {} : { allowedTools: [...toolFilter.allow] }) }
  // Agent creation listeners run serially before publication or prompt delivery.
  const stop = ctx.on('agent/created', ({ agent }) => {
    if (agent.id !== childId) return
    appendPluginRecord(agent.session, 'plugin:clawclaw/expert-composition', composition)
    applyComposition(agent, composition)
  })
  try {
    const activation = await ctx.subagents.startActivation({
      provider, childId, label, request, signal, delivery: 'caller',
    })
    const cancel = (): void => { void activation.dispose().catch(error => ctx.logger.warn(error)) }
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    const result = activation.result.finally(() => { signal.removeEventListener('abort', cancel) })
    return { id: activation.childId, result, dispose: () => activation.dispose() }
  } finally {
    stop()
  }
}
