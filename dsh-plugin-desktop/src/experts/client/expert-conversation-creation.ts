import type { Context as CordisClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'

export const EXPERT_MANAGER_SKILL = 'expert-manager'

export type ExpertCreationConversationErrorCode =
  | 'workspaceUnavailable'
  | 'composerUnavailable'

export class ExpertCreationConversationError extends Error {
  override readonly name = 'ExpertCreationConversationError'

  constructor(readonly code: ExpertCreationConversationErrorCode) {
    super(code)
  }
}

export function expertCreationDraft(locale: 'zh' | 'en'): string {
  return locale === 'en'
    ? '/expert-manager Help me create a [expert name] expert specializing in [professional capabilities]. My experience is: [add your industry background and relevant experience]'
    : '/expert-manager 帮我创建一个 [专家名称] 专家，擅长 [专业能力]。我的经验是：[请补充你的行业背景、相关经验]'
}

export interface ExpertCreationWorkspaceSnapshot {
  readonly items: readonly {
    readonly workspaceId: WorkspaceId
    readonly sessionIds: readonly SessionId[]
    readonly updatedAt: string
  }[]
  readonly archivedSessionIds?: readonly SessionId[]
}

/** Prefer the current conversation's Workspace, then the most recently updated Workspace. */
export function expertCreationWorkspaceId(
  snapshot: ExpertCreationWorkspaceSnapshot,
  currentSessionId?: SessionId,
): WorkspaceId | undefined {
  const archived = new Set(snapshot.archivedSessionIds ?? [])
  const current = currentSessionId === undefined || archived.has(currentSessionId)
    ? undefined
    : snapshot.items.find(item => item.sessionIds.includes(currentSessionId))
  if (current !== undefined) return current.workspaceId
  return snapshot.items.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.workspaceId
}

interface ConversationDraftTarget {
  readonly actions?: { setDraft(text: string): void }
}

export interface ExpertCreationConversationDependencies {
  readonly locale: 'zh' | 'en'
  readonly workspaceId?: WorkspaceId
  readonly sessions: {
    scope?(sessionId: SessionId): CordisClientContext | undefined
    binding?(sessionId: SessionId): { readonly ctx: CordisClientContext } | undefined
  }
  conversationFor(actx: CordisClientContext): ConversationDraftTarget | undefined
  readonly openWorkspace: (workspaceId: WorkspaceId, beforeOpen: (sessionId: SessionId) => void) => Promise<void>
  closeSettings(): void
  readonly focusComposer?: () => void
}

export interface CapabilityConversationDependencies {
  readonly workspaceId?: WorkspaceId
  readonly openWorkspace: (workspaceId: WorkspaceId, beforeOpen: (sessionId: SessionId) => void) => Promise<void>
  readonly prepare: (sessionId: SessionId) => boolean | Promise<boolean>
}

/** Create a separate conversation and prepare its composer before navigation commits. */
export async function openCapabilityConversation(
  dependencies: CapabilityConversationDependencies,
): Promise<boolean> {
  if (dependencies.workspaceId === undefined) throw new ExpertCreationConversationError('workspaceUnavailable')
  let prepared: boolean | Promise<boolean> | undefined
  await dependencies.openWorkspace(dependencies.workspaceId, sessionId => {
    prepared = dependencies.prepare(sessionId)
  })
  return prepared === undefined ? false : await prepared
}

/** Open a normal conversation with an editable expert-manager request; never submits it. */
export async function openExpertCreationConversation(
  dependencies: ExpertCreationConversationDependencies,
): Promise<void> {
  const workspaceId = dependencies.workspaceId
  if (workspaceId === undefined) throw new ExpertCreationConversationError('workspaceUnavailable')

  await dependencies.openWorkspace(workspaceId, sessionId => {
    const actx = dependencies.sessions.scope?.(sessionId) ?? dependencies.sessions.binding?.(sessionId)?.ctx
    const input = actx === undefined ? undefined : dependencies.conversationFor(actx)
    if (input?.actions?.setDraft === undefined) throw new ExpertCreationConversationError('composerUnavailable')
    input.actions.setDraft(expertCreationDraft(dependencies.locale))
  })
  dependencies.closeSettings()
  requestAnimationFrame(() => { dependencies.focusComposer?.() })
}
