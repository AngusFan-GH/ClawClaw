// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { applyConversationSkills, createConversationSkillsApi, rankConversationSkills, skillInsertion, type ConversationSkillsApi } from '../src/client/conversation-skills.ts'

const catalog = { skills: [{ name: 'review', description: 'Review code', modelInvocable: false }], commands: ['help'] }
const state = { draft: 'Check @file please', draftRev: 7, phase: 'plain' as const }

describe('conversation skill invocation', () => {
  it('ranks exact names ahead of prefixes, substrings and descriptions without mutating the catalog', () => {
    const skills = ['other', 'pre-review', 'review-more', 'review'].map(name => ({ name, description: 'review code', modelInvocable: true }))
    expect(rankConversationSkills(skills, ' REVIEW ').map(skill => skill.name)).toEqual(['review', 'review-more', 'pre-review', 'other'])
    expect(skills[0]?.name).toBe('other')
    expect(rankConversationSkills(skills, 'missing')).toEqual([])
  })
  it('wires the composer seat to session-addressed remotes and the scoped editor event', async () => {
    let inject: ((id: SessionId) => { api: ConversationSkillsApi }) | undefined
    const sid = 'current-conversation' as SessionId
    const actx = { bail: vi.fn(() => true) }
    const sessions = { scope: vi.fn(() => actx) }
    const remote = {
      $on: vi.fn(), skills: { list: vi.fn(async () => ({ ok: true, value: { skills: catalog.skills } })) },
      commands: { list: vi.fn(async () => ({ ok: true, value: [{ name: 'help' }] })) },
    }
    const context = {
      get: (key: string) => key === 'sessions' ? sessions : remote,
      inject: (_services: string[], install: (scope: Context) => void) => { install(context as unknown as Context) },
      remote, on: vi.fn(),
      conversation: { input: { for: vi.fn(() => ({ state: { getSnapshot: () => state } })) } },
      slots: {
        inject: (_slot: string, install: () => void) => { install() },
        register: (definition: { name: string; inject: typeof inject }) => {
          expect(definition.name).toBe('conversation.input.left'); inject = definition.inject
        },
      },
    }
    applyConversationSkills(context as unknown as Context)
    const api = inject!(sid).api
    const abort = new AbortController()
    await api.select('review', abort.signal)
    expect(sessions.scope).toHaveBeenCalledWith(sid)
    expect(remote.skills.list).toHaveBeenCalledWith({ sessionId: sid }, abort.signal)
    expect(remote.commands.list).toHaveBeenCalledWith(sid)
    expect(context.conversation.input.for).toHaveBeenCalledWith(actx)
    expect(actx.bail).toHaveBeenCalledWith('slash/input-insert-text', skillInsertion('review', state, catalog))
  })
  it('prepends the Harness gesture through a zero-width revision-guarded edit', () => {
    expect(skillInsertion('review', state, catalog)).toEqual({ text: '/review ', span: { start: 0, end: 0, draftRev: 7 } })
    expect(skillInsertion('review', { ...state, draft: '/review Check this' }, catalog).text).toBe('')
  })
  it('refuses unavailable Skills, command collisions and claimed input', () => {
    expect(() => skillInsertion('removed', state, catalog)).toThrow('skillUnavailable')
    expect(() => skillInsertion('review', state, { ...catalog, commands: ['review'] })).toThrow('skillCommandConflict')
    expect(() => skillInsertion('review', { ...state, draft: '/help draft' }, catalog)).toThrow('skillCommandConflict')
    expect(() => skillInsertion('review', { ...state, phase: 'claimed' }, catalog)).toThrow('skillDraftChanged')
  })
  it('rechecks the session catalog at selection time without sending the draft', async () => {
    const list = vi.fn(async () => catalog)
    const insert = vi.fn(() => true)
    const api = createConversationSkillsApi({ list, snapshot: () => state, generation: () => 0, insert })
    await api.list(new AbortController().signal)
    await api.select('review', new AbortController().signal)
    expect(list).toHaveBeenCalledTimes(2)
    expect(insert).toHaveBeenCalledExactlyOnceWith(skillInsertion('review', state, catalog))
    list.mockResolvedValueOnce({ ...catalog, skills: [] })
    await expect(api.select('review', new AbortController().signal)).rejects.toThrow('skillUnavailable')
    expect(insert).toHaveBeenCalledTimes(1)
  })
  it.each(['cancel', 'draft', 'preset', 'frozen', 'unmounted'] as const)('does not insert after %s changes during validation', async kind => {
    let current = { ...state, phase: 'plain' as 'plain' | 'submitting' }
    let generation = 0
    const abort = new AbortController()
    const insert = vi.fn(() => kind !== 'unmounted')
    const api = createConversationSkillsApi({
      snapshot: () => current, generation: () => generation, insert,
      list: async () => {
        if (kind === 'cancel') abort.abort()
        if (kind === 'draft') current = { ...current, draftRev: 8 }
        if (kind === 'preset') generation++
        if (kind === 'frozen') current = { ...current, phase: 'submitting' }
        return catalog
      },
    })
    await expect(api.select('review', abort.signal)).rejects.toThrow()
    expect(insert).toHaveBeenCalledTimes(kind === 'unmounted' ? 1 : 0)
  })
})
