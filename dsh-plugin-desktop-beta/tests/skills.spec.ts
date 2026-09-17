import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { DesktopSkillsController, setSkillModelInvocableDocument, setSkillUserInvocableDocument } from '../src/skills.ts'

describe('Desktop Skills', () => {
  it('changes only the standard model visibility frontmatter field', () => {
    const original = '---\nname: review\ndescription: Review code\ncustom: keep\n---\n\nDo the review.\n'
    const disabled = setSkillModelInvocableDocument(original, false)
    expect(disabled).toContain('disable-model-invocation: true')
    expect(disabled).toContain('custom: keep')
    expect(disabled).toContain('Do the review.')
    const enabled = setSkillModelInvocableDocument(disabled, true)
    expect(enabled).not.toContain('disable-model-invocation')
    expect(enabled).toContain('custom: keep')
  })

  it('uses the supported user-invocable frontmatter field', () => {
    const original = '---\nname: review\ndescription: Review code\n---\n\nInstructions.\n'
    const hidden = setSkillUserInvocableDocument(original, false)
    expect(hidden).toContain('user-invocable: false')
    expect(setSkillUserInvocableDocument(hidden, true)).not.toContain('user-invocable')
  })

  it('adds frontmatter only when a plain Skill must be hidden', () => {
    const plain = '# Skill\n\nInstructions.\n'
    expect(setSkillModelInvocableDocument(plain, true)).toBe(plain)
    expect(setSkillModelInvocableDocument(plain, false)).toBe(
      '---\ndisable-model-invocation: true\n---\n\n# Skill\n\nInstructions.\n',
    )
  })
})


describe('Desktop Skills preset catalog', () => {
  const skill = { name: 'review', description: 'Review code', source: 'bundled', provider: 'filesystem',
    invocation: { modelInvocable: true, userInvocable: true }, content: 'Review instructions.' }

  it('reads the default preset layer for both inventory and details without an active session', async () => {
    const scope = {}
    const standingKeyFor = vi.fn(async () => scope)
    const snapshot = vi.fn(async (options: { scope?: object }) => ({
      skills: options.scope === scope ? [skill] : [], complete: true,
    }))
    const get = vi.fn(async (_name: string, options: { scope?: object }) => options.scope === scope ? skill : undefined)
    const ctx = { get: () => ({ standingKeyFor }), skills: { snapshot, get } } as unknown as Context
    const controller = new DesktopSkillsController(ctx)
    expect((await controller.read()).skills).toEqual([expect.objectContaining({ name: 'review', editable: false })])
    expect(await controller.detail('review')).toEqual(expect.objectContaining({ content: 'Review instructions.' }))
    expect(standingKeyFor).toHaveBeenCalledWith()
    expect(get).toHaveBeenCalledWith('review', { scope })
    await expect(controller.setModelInvocable('review', false)).rejects.toThrow('Only Skills in a user library')
    expect(get).toHaveBeenLastCalledWith('review', { scope })
  })

  it('supports host-only compositions and reports incomplete discovery instead of an empty success', async () => {
    const snapshot = vi.fn(async () => ({ skills: [skill], complete: true }))
    const controller = new DesktopSkillsController({ get: () => undefined, skills: { snapshot } } as unknown as Context)
    expect((await controller.read()).skills).toHaveLength(1)
    expect(snapshot).toHaveBeenCalledWith({})
    snapshot.mockResolvedValueOnce({ skills: [], complete: false })
    await expect(controller.read()).rejects.toThrow('discovery is incomplete')
  })

  it('surfaces a broken default preset instead of falling back to the empty global layer', async () => {
    const snapshot = vi.fn()
    const controller = new DesktopSkillsController({
      get: () => ({ standingKeyFor: async () => { throw new Error('preset unavailable') } }), skills: { snapshot },
    } as unknown as Context)
    await expect(controller.read()).rejects.toThrow('preset unavailable')
    expect(snapshot).not.toHaveBeenCalled()
  })
})
