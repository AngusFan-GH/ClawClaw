/** Client-side summon flow: create the preset-bound Session, reconcile it, then open it. */

import type { DesktopExpertsApi } from './experts-api.ts'

export interface ExpertSummonNavigation {
  /** Merge the created Session into its Workspace row (Host already attached it). */
  reconcileWorkspace: (workspaceId: string, sessionId: string) => Promise<void>
  /** Rebuild the authoritative Session list before opening. */
  refreshSessions: () => Promise<void>
  /** Reveal the Session in the main column. */
  openSession: (sessionId: string) => void
}

const CONVERSATION_STORE_KEY = 'dsh.conversation'

/**
 * Seed the per-session draft store before the conversation mounts.
 * The store hydrates from localStorage on first creation for the session,
 * so the quick task appears as the composed input without sending anything.
 */
export function seedConversationDraft(sessionId: string, draft: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      `${CONVERSATION_STORE_KEY}.${sessionId}`,
      JSON.stringify({ draft, view: null, viewRequest: null }),
    )
  } catch {
    // Storage failure (quota, private mode) never blocks the summon.
  }
}

/**
 * Summon an expert: the Host creates the Session with the expert's Agent
 * preset mounted; the client reconciles Workspace + Session catalogs, seeds
 * the draft, and reveals the conversation.
 */
export async function summonExpert(
  api: DesktopExpertsApi,
  navigation: ExpertSummonNavigation,
  expertId: string,
  prompt: string,
): Promise<void> {
  const result = await api.summon(expertId, prompt)
  await navigation.reconcileWorkspace(result.workspaceId, result.sessionId)
  await navigation.refreshSessions()
  seedConversationDraft(result.sessionId, prompt)
  navigation.openSession(result.sessionId)
}
