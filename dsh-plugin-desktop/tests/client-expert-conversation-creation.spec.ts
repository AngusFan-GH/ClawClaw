import { describe, expect, it, vi } from 'vitest'
import {
  ExpertCreationConversationError,
  expertCreationDraft,
  expertCreationWorkspaceId,
  openExpertCreationConversation,
} from '../src/experts/client/expert-conversation-creation.ts'

describe('expert conversation creation', () => {
  it('prefers the current Workspace and otherwise uses the most recently updated one', () => {
    const snapshot = {
      items: [
        { workspaceId: 'older', sessionIds: ['current'], updatedAt: '2026-01-01T00:00:00.000Z' },
        { workspaceId: 'newer', sessionIds: [], updatedAt: '2026-02-01T00:00:00.000Z' },
      ],
      archivedSessionIds: [],
    } as never
    expect(expertCreationWorkspaceId(snapshot, 'current' as never)).toBe('older')
    expect(expertCreationWorkspaceId(snapshot)).toBe('newer')
  })

  it('opens a normal conversation with an editable expert-manager draft and does not submit', async () => {
    const setDraft = vi.fn()
    const closeSettings = vi.fn()
    const focusComposer = vi.fn()
    const submit = vi.fn()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })

    const openWorkspace = vi.fn(async (_workspaceId, beforeOpen: (sessionId: string) => void) => {
      beforeOpen('created-session')
    })
    await openExpertCreationConversation({
      locale: 'zh', workspaceId: 'workspace-1' as never,
      sessions: { scope: vi.fn(() => ({} as never)) },
      conversationFor: () => ({ actions: { setDraft, submit } } as never),
      openWorkspace: openWorkspace as never,
      closeSettings,
      focusComposer,
    })

    expect(openWorkspace).toHaveBeenCalledWith('workspace-1', expect.any(Function))
    expect(setDraft).toHaveBeenCalledExactlyOnceWith(expertCreationDraft('zh'))
    expect(setDraft.mock.calls[0]?.[0]).toMatch(/^\/expert-manager /u)
    expect(submit).not.toHaveBeenCalled()
    expect(closeSettings).toHaveBeenCalledOnce()
    expect(focusComposer).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('keeps navigation closed when no Workspace is available', async () => {
    const openWorkspace = vi.fn()
    await expect(openExpertCreationConversation({
      locale: 'en',
      sessions: {}, conversationFor: () => undefined,
      openWorkspace: openWorkspace as never,
      closeSettings: vi.fn(),
    })).rejects.toEqual(new ExpertCreationConversationError('workspaceUnavailable'))
    expect(openWorkspace).not.toHaveBeenCalled()
  })
})
