/** Desktop-owned creation of empty child Sessions for selection side chats. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { registerDesktopJsonApi } from './desktop-json-api.ts'
import {
  DESKTOP_SELECTION_SIDECHAT_CREATE_PATH,
  DESKTOP_SELECTION_SIDECHAT_PATH,
  parseSelectionSideChatCreateRequest,
  type SelectionSideChatCreateResult,
} from './selection-sidechat-contract.ts'

export interface SelectionSideChatRuntime {
  readonly agents: Context['agents']
  readonly agentPresets: Context['agentPresets']
  readonly permissionPresets: Context['permissionPresets']
  readonly workspaceRegistry: Context['workspaceRegistry']
}

function inheritedAgentOptions(parent: Agent): AgentOptions {
  const request = parent.session.requestHeader()?.config
  if (request === undefined) return { ...parent.options }
  const {
    provider: _provider,
    model: _model,
    reasoningEffort: _reasoningEffort,
    ...rest
  } = parent.options
  return {
    ...rest,
    provider: request.provider,
    model: request.model,
    ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
  }
}

function inheritedModelSelection(parent: Agent): {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
} {
  const request = parent.session.requestHeader()?.config
  const provider = request?.provider ?? parent.options.provider
  const model = request?.model ?? parent.options.model
  if (provider === undefined || model === undefined) {
    throw new Error('The parent conversation has no model selection')
  }
  return {
    provider,
    model,
    ...(request?.reasoningEffort === undefined ? {} : { reasoningEffort: String(request.reasoningEffort) }),
  }
}

function parentWorkspace(runtime: SelectionSideChatRuntime, parent: Agent): Workspace | undefined {
  const workspaces = runtime.workspaceRegistry.list()
  return workspaces.find(workspace => workspace.sessionIds.includes(parent.id))
    ?? workspaces.find(workspace => workspace.path === parent.session.header.cwd)
}

/** Create a blank ordinary Session with durable lineage and the parent's runtime composition. */
export async function createSelectionSideChat(
  runtime: SelectionSideChatRuntime,
  parentSessionId: SessionId,
): Promise<SelectionSideChatCreateResult> {
  const parent = runtime.agents.get(parentSessionId)
  if (parent === undefined) throw new Error('The parent conversation is not active')
  const workspace = parentWorkspace(runtime, parent)
  if (workspace === undefined) throw new Error('The parent conversation has no workspace')

  const sessionId = SessionId(`selection-sidechat-${randomUUID()}`)
  const agentPreset = runtime.agentPresets.composedPreset(parent.ctx)
  const modelSelection = inheritedModelSelection(parent)
  const handle = await runtime.agents.create({
    sessionId,
    meta: {
      cwd: workspace.path,
      parentSession: parentSessionId,
      ...(agentPreset === undefined ? {} : { agentPreset }),
    },
    agentOptions: inheritedAgentOptions(parent),
    setup: agentCtx => { runtime.agentPresets.composeFrom(agentCtx, parent.ctx) },
  })

  try {
    // A blank Session has no request header yet; persist the parent's selection
    // so the shared Composer and the first model request agree immediately.
    handle.agent.session.append('model/selection', modelSelection)
    const permissionPreset = runtime.permissionPresets.current(parent.session)
    if (permissionPreset !== 'custom') {
      runtime.permissionPresets.set(handle.agent.session, permissionPreset)
    }
    await workspace.attachSession(sessionId)
  } catch (cause) {
    await handle.dispose().catch(() => undefined)
    throw cause
  }
  return { sessionId }
}

export function registerSelectionSideChatApi(ctx: Context): void {
  registerDesktopJsonApi(ctx, {
    label: 'Selection side chat',
    readPath: DESKTOP_SELECTION_SIDECHAT_PATH,
    actionPath: DESKTOP_SELECTION_SIDECHAT_CREATE_PATH,
    read: async () => ({ available: true }),
    action: async value => {
      const request = parseSelectionSideChatCreateRequest(value)
      return await createSelectionSideChat({
        agents: ctx.agents,
        agentPresets: ctx.agentPresets,
        permissionPresets: ctx.permissionPresets,
        workspaceRegistry: ctx.workspaceRegistry,
      }, request.parentSessionId)
    },
  })
}
