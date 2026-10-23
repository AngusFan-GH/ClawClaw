/** Desktop-owned launch policy for selection continuable subagents. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import {
  appendDelegatedPolicyOverrides,
  applyChildComposition,
  captureDelegatedPolicyOverrides,
  childSessionMeta,
  resolveChildAgentOptions,
  resolveChildDepth,
  snapshotSubagentDescriptor,
  type SubagentRuntime,
} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-working-directory'
import { registerDesktopJsonApi } from './desktop-json-api.ts'
import {
  DESKTOP_SELECTION_SIDECHAT_PATH,
  DESKTOP_SELECTION_SIDECHAT_PREPARE_PATH,
  isSelectionSideChatSessionId,
  parseSelectionSideChatPrepareRequest,
  SELECTION_SIDECHAT_SESSION_PREFIX,
  selectionSideChatLabel,
  type SelectionSideChatPrepareRequest,
  type SelectionSideChatPrepareResult,
} from './selection-sidechat-contract.ts'

const SUBAGENT_CATALOG_VERSION = 0

export interface SelectionSideChatRuntime {
  readonly agents: Context['agents']
  readonly sessions: Context['sessions']
  readonly sessionProjections: Context['sessionProjections']
  readonly subagents: SubagentRuntime
}

function selectionSideChatToolFilter(parent: Agent): { readonly deny: readonly string[] } | undefined {
  const tools = parent.ctx.get('tools')
  if (tools === undefined) return undefined
  return tools.get('send_message', parent) === undefined ? undefined : { deny: ['send_message'] }
}

/** Provision a dormant native continuable child for the standard conversation composer. */
export async function prepareSelectionSideChat(
  runtime: SelectionSideChatRuntime,
  request: SelectionSideChatPrepareRequest,
): Promise<SelectionSideChatPrepareResult> {
  const parent = runtime.agents.get(request.parentSessionId)
  if (parent === undefined) throw new Error('The parent conversation is not active')
  const provider = runtime.subagents.getProvider('spawn')
  if (provider?.prepareContinuable === undefined) {
    throw new Error('Continuable side chats are unavailable')
  }
  const childId = SessionId(`${SELECTION_SIDECHAT_SESSION_PREFIX}${randomUUID()}`)
  const childDepth = resolveChildDepth(parent, undefined)
  const agentOptions = resolveChildAgentOptions(parent, undefined, childDepth)
  const toolFilter = selectionSideChatToolFilter(parent)
  const label = selectionSideChatLabel(request.quote.text)
  const descriptor = snapshotSubagentDescriptor({
    mode: 'continuable',
    provider: 'spawn',
    label,
    ...(agentOptions.provider === undefined ? {} : { agentProvider: agentOptions.provider }),
    ...(agentOptions.model === undefined ? {} : { agentModel: agentOptions.model }),
    ...(agentOptions.reasoningEffort === undefined ? {} : { agentReasoningEffort: agentOptions.reasoningEffort }),
    ...(toolFilter === undefined ? {} : { toolFilter }),
  })
  const delegatedPolicies = captureDelegatedPolicyOverrides(parent)
  const signal = new AbortController().signal
  const cwd = parent.ctx.get('workingDirectory')?.get(parent.session) ?? parent.session.header.cwd ?? process.cwd()
  const prepared = await provider.prepareContinuable({ sessionId: childId, cwd, parent, signal })
  const inheritedEventCount = SessionLogOffset(prepared.seed?.length ?? 0)
  const handle = await runtime.agents.create({
    sessionId: childId,
    parentAgent: parent,
    meta: { ...childSessionMeta(parent, childDepth, prepared.seed !== undefined), cwd },
    ...(prepared.seed === undefined ? {} : { seed: prepared.seed }),
    inheritedEventCount,
    agentOptions,
    signal,
    setup(childCtx, child) {
      child.session.append('subagent/descriptor', descriptor)
      appendDelegatedPolicyOverrides(child.session, delegatedPolicies)
      applyChildComposition(childCtx, parent, { toolFilter })
    },
  })
  try {
    await runtime.sessions.flush(handle.agent.session)
  } catch (cause) {
    await handle.dispose().catch(() => undefined)
    throw cause
  }
  await handle.dispose()
  return { childSessionId: childId }
}

/** Publish a prepared selection child only when its first real prompt is submitted. */
export async function publishSelectionSideChat(
  runtime: SelectionSideChatRuntime,
  child: Agent,
  message: UserMessage,
): Promise<boolean> {
  if (!isSelectionSideChatSessionId(child.id) || message.source.kind !== 'user') return false
  const parentSessionId = child.session.header.parentSession
  if (parentSessionId === undefined) return false
  const parent = runtime.agents.get(parentSessionId)
  if (parent === undefined) return false
  const existing = runtime.sessionProjections.snapshot(parent.session).values.subagentCatalog
    ?.some(entry => entry.id === child.id) === true
  if (existing) return false
  const identity = runtime.sessionProjections.snapshot(child.session).values.subagent
  if (identity?.mode !== 'continuable' || !child.session.isOwnSeq(identity.seq)) return false
  parent.session.append('subagent/catalog', {
    version: SUBAGENT_CATALOG_VERSION,
    childId: child.id,
    childCreatedAt: child.session.header.createdAt,
    mode: 'continuable',
    label: identity.label,
  })
  await runtime.sessions.flush(parent.session)
  return true
}

/**
 * Keep an idle parent in maintenance until the upstream followup call finishes.
 * The loop then sees an empty inbox and drops its latched wake without opening
 * a contentless turn. A parent already running needs no barrier: removing the
 * synchronous insertion is enough because steer does not schedule another turn.
 */
function holdSelectionSideChatSettlementWake(agent: Agent): void {
  if (agent.status !== 'idle') return
  try {
    void agent.runMaintenance(async () => { await Promise.resolve() })
  } catch (cause) {
    // Agent status also reports idle during maintenance, where an existing
    // maintenance boundary already provides the required wake barrier.
    if (!(cause instanceof Error) || !cause.message.endsWith('already has active work')) throw cause
  }
}

/** Prevent selection side chats from waking or writing their result into the parent conversation. */
export function suppressSelectionSideChatSettlement(agent: Agent, message: UserMessage): boolean {
  const source = message.source
  if (source.kind !== 'subagent-settled' || !isSelectionSideChatSessionId(source.senderSessionId)) return false
  if (!agent.inbox.remove(message.id)) return false
  holdSelectionSideChatSettlementWake(agent)
  return true
}

export function registerSelectionSideChatApi(ctx: Context): void {
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (suppressSelectionSideChatSettlement(agent, message)) return
    void publishSelectionSideChat(
      {
        agents: ctx.agents,
        sessions: ctx.sessions,
        sessionProjections: ctx.sessionProjections,
        subagents: ctx.subagents,
      },
      agent,
      message,
    ).catch((cause) => {
      ctx.logger.warn(
        `dsh-plugin-desktop: failed to publish selection side chat: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    })
  })
  registerDesktopJsonApi(ctx, {
    label: 'Selection side chat',
    readPath: DESKTOP_SELECTION_SIDECHAT_PATH,
    actionPath: DESKTOP_SELECTION_SIDECHAT_PREPARE_PATH,
    read: async () => ({ available: ctx.subagents.getProvider('spawn')?.prepareContinuable !== undefined }),
    action: async value => await prepareSelectionSideChat(
      {
        agents: ctx.agents,
        sessions: ctx.sessions,
        sessionProjections: ctx.sessionProjections,
        subagents: ctx.subagents,
      },
      parseSelectionSideChatPrepareRequest(value),
    ),
  })
}
