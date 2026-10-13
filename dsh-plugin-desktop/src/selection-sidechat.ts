/** Desktop-owned launch policy for selection continuable subagents. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { registerDesktopJsonApi } from './desktop-json-api.ts'
import {
  DESKTOP_SELECTION_SIDECHAT_PATH,
  DESKTOP_SELECTION_SIDECHAT_START_PATH,
  isSelectionSideChatSessionId,
  parseSelectionSideChatStartRequest,
  SELECTION_SIDECHAT_SESSION_PREFIX,
  selectionSideChatLabel,
  type SelectionSideChatQuote,
  type SelectionSideChatStartRequest,
  type SelectionSideChatStartResult,
} from './selection-sidechat-contract.ts'

const QUOTE_OPEN = '<clawclaw-selection-quote>'
const QUOTE_CLOSE = '</clawclaw-selection-quote>'

export interface SelectionSideChatRuntime {
  readonly agents: Context['agents']
  readonly subagents: SubagentRuntime
}

function selectionSideChatPrompt(quote: SelectionSideChatQuote, question: string): ContentBlock[] {
  const payload = JSON.stringify(quote).replace(/</gu, '\\u003c')
  return [{ type: 'text', text: `${QUOTE_OPEN}${payload}${QUOTE_CLOSE}\n\n${question.trim()}` }]
}

function selectionSideChatToolFilter(parent: Agent): { readonly deny: readonly string[] } | undefined {
  const tools = parent.ctx.get('tools')
  if (tools === undefined) return undefined
  return tools.get('send_message', parent) === undefined ? undefined : { deny: ['send_message'] }
}

/** Start a fresh, continuable child whose first turn is the user's side question. */
export async function startSelectionSideChat(
  runtime: SelectionSideChatRuntime,
  request: SelectionSideChatStartRequest,
): Promise<SelectionSideChatStartResult> {
  const parent = runtime.agents.get(request.parentSessionId)
  if (parent === undefined) throw new Error('The parent conversation is not active')
  const childId = SessionId(`${SELECTION_SIDECHAT_SESSION_PREFIX}${randomUUID()}`)
  const toolFilter = selectionSideChatToolFilter(parent)
  const started = await runtime.subagents.startContinuable({
    provider: 'spawn',
    childId,
    label: selectionSideChatLabel(request.quote.text),
    request: {
      parent,
      prompt: selectionSideChatPrompt(request.quote, request.question),
      ...(toolFilter === undefined ? {} : { toolFilter }),
    },
    signal: new AbortController().signal,
  })
  return { childSessionId: started.childId }
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
    suppressSelectionSideChatSettlement(agent, message)
  })
  registerDesktopJsonApi(ctx, {
    label: 'Selection side chat',
    readPath: DESKTOP_SELECTION_SIDECHAT_PATH,
    actionPath: DESKTOP_SELECTION_SIDECHAT_START_PATH,
    read: async () => ({ available: ctx.subagents.getProvider('spawn')?.prepareContinuable !== undefined }),
    action: async value => await startSelectionSideChat(
      { agents: ctx.agents, subagents: ctx.subagents },
      parseSelectionSideChatStartRequest(value),
    ),
  })
}
