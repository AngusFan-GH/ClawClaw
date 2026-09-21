import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  createStructuredSkillDocument, DesktopSkillsController, setSkillModelInvocableDocument,
  setSkillUserInvocableDocument, updateStructuredSkillDocument,
} from '../src/skills.ts'

afterEach(() => { vi.unstubAllEnvs() })

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

  it('creates a structured Skill document with optional routing guidance', () => {
    expect(createStructuredSkillDocument({ name: 'release-check', description: 'Check a release',
      whenToUse: 'Before publishing', instructions: '# Workflow\n\nRun every check.' })).toBe(
      '---\nname: release-check\ndescription: Check a release\nwhenToUse: Before publishing\n---\n\n# Workflow\n\nRun every check.\n',
    )
  })

  it('updates authored fields without dropping invocation or custom metadata', () => {
    const original = '---\nname: review\ndescription: Old\nwhenToUse: Old use\ndisable-model-invocation: true\nmetadata:\n  owner: desktop\n---\n\nOld instructions.\n'
    const updated = updateStructuredSkillDocument(original, { name: 'review', description: 'New description',
      instructions: 'New instructions.' })
    expect(updated).toContain('description: New description')
    expect(updated).not.toContain('whenToUse')
    expect(updated).toContain('disable-model-invocation: true')
    expect(updated).toContain('owner: desktop')
    expect(updated).toContain('New instructions.')
  })

  it('rejects invalid structured fields', () => {
    expect(() => createStructuredSkillDocument({ name: 'Not Valid', description: 'Description', instructions: 'Instructions' })).toThrow('kebab-case')
    expect(() => createStructuredSkillDocument({ name: 'valid', description: ' ', instructions: 'Instructions' })).toThrow('description')
    expect(() => createStructuredSkillDocument({ name: 'valid', description: 'Description', instructions: ' ' })).toThrow('instructions')
  })
})


describe('Desktop Skills preset catalog', () => {
  const skill = { name: 'review', description: 'Review code', source: 'bundled', provider: 'filesystem',
    invocation: { modelInvocable: true, userInvocable: true }, content: 'Review instructions.' }

  it('rejects stale edits, reports successful writes despite discovery failure and restores beneath a project override', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawclaw-skills-reliability-'))
    vi.stubEnv('DSH_HOME', root)
    const path = join(root, 'skills', 'review', 'SKILL.md')
    const current = { ...skill, source: 'user-dsh', path }
    const snapshot = vi.fn(async () => ({ skills: [current], complete: true }))
    const controller = new DesktopSkillsController({ get: () => undefined, skills: { snapshot, get: async () => current } } as unknown as Context)
    try {
      await mkdir(join(root, 'skills', 'review'), { recursive: true })
      const original = '---\nname: review\ndescription: Original\n---\nOriginal instructions\n'
      await writeFile(path, original)
      const detail = await controller.detail('review')
      expect(detail.description).toBe('Original')
      expect(detail.revision).toMatch(/^[a-f0-9]{64}$/u)
      const external = original.replace('Original instructions', 'Agent instructions')
      await writeFile(path, external)
      const input = { name: 'review', description: 'Draft', instructions: 'User instructions' }
      await expect(controller.update('review', input)).rejects.toThrow('skillEditConflict')
      await expect(controller.update('review', input, detail.revision)).rejects.toThrow('skillEditConflict')
      expect(await readFile(path, 'utf8')).toBe(external)
      const latest = await controller.detail('review')
      snapshot.mockRejectedValueOnce(new Error('Registry offline'))
      expect((await controller.update('review', input, latest.revision)).refreshPending).toBe(true)
      expect(await readFile(path, 'utf8')).toContain('User instructions')
      const recycled = await controller.recycle('review')
      snapshot.mockResolvedValue({ skills: [{ ...current, source: 'project-agents' }], complete: true })
      const restored = await controller.restore(recycled.recycled[0]!.id)
      expect(restored.skills[0]?.source).toBe('project-agents')
      expect(await readFile(path, 'utf8')).toContain('User instructions')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it.each([
    `description: ${'x'.repeat(4001)}`,
    'description: Valid\nuser-invocable: "false"',
    'description: Valid\nwhenToUse: 42',
  ])('rejects invalid import metadata before discovery or writes: %.40s', async metadata => {
    const snapshot = vi.fn()
    const controller = new DesktopSkillsController({ get: () => undefined, skills: { snapshot } } as unknown as Context)
    await expect(controller.importDocument(`---\nname: review\n${metadata}\n---\nInstructions`)).rejects.toThrow()
    expect(snapshot).not.toHaveBeenCalled()
  })

  it('imports and restores immediately despite a stale watcher, preserving bundle assets and invocation flags', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawclaw-skills-lifecycle-'))
    vi.stubEnv('DSH_HOME', root)
    let discovered: typeof skill[] = []
    const path = join(root, 'skills', 'review', 'SKILL.md')
    const controller = new DesktopSkillsController({ get: () => undefined, skills: {
      snapshot: async () => ({ skills: discovered, complete: true }),
      get: async () => ({ ...skill, source: 'user-dsh', path }),
    } } as unknown as Context)
    try {
      const imported = await controller.importDocument('---\nname: review\ndescription: Review code\nuser-invocable: false\ndisable-model-invocation: true\n---\nReview.')
      expect(imported.skills).toEqual([expect.objectContaining({ name: 'review', modelInvocable: false, userInvocable: false })])
      await writeFile(join(root, 'skills', 'review', 'reference.txt'), 'Keep this asset')
      discovered = [skill]
      const recycled = await controller.recycle('review')
      expect(recycled.skills).toEqual([])
      expect(recycled.recycled).toHaveLength(1)
      expect(Number.isFinite(Date.parse(recycled.recycled[0]!.deletedAt))).toBe(true)
      discovered = []
      const restored = await controller.restore(recycled.recycled[0]!.id)
      expect(restored.recycled).toEqual([])
      expect(restored.skills).toEqual([expect.objectContaining({ name: 'review', modelInvocable: false, userInvocable: false })])
      expect(await readFile(join(root, 'skills', 'review', 'reference.txt'), 'utf8')).toBe('Keep this asset')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('rejects imports that would shadow an existing skill from another source', async () => {
    const controller = new DesktopSkillsController({ get: () => undefined, skills: {
      snapshot: async () => ({ skills: [skill], complete: true }),
    } } as unknown as Context)
    await expect(controller.importDocument('---\nname: review\ndescription: Replacement\n---\nInstructions.')).rejects.toThrow('already exists')
  })

  it('never recycles the user library itself for a root-level SKILL.md', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawclaw-skills-boundary-'))
    vi.stubEnv('DSH_HOME', root)
    const path = join(root, 'skills', 'SKILL.md')
    await mkdir(join(root, 'skills'))
    await writeFile(path, 'Root skill')
    try {
      const controller = new DesktopSkillsController({ get: () => undefined, skills: {
        get: async () => ({ ...skill, source: 'user-dsh', path }),
      } } as unknown as Context)
      await expect(controller.recycle('review')).rejects.toThrow('top-level')
      expect(await readFile(path, 'utf8')).toBe('Root skill')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

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

  it('keeps independent request selections for inventory, details, and mutations', async () => {
    const standingKeyFor = vi.fn(async (id?: string) => ({ id }))
    const get = vi.fn(async () => skill)
    const snapshot = vi.fn(async () => ({ skills: [skill], complete: true }))
    const ctx = { get: () => ({ standingKeyFor }), skills: { get, snapshot } } as unknown as Context
    const standard = new DesktopSkillsController(ctx, 'standard')
    const minimal = new DesktopSkillsController(ctx, 'minimal')
    await standard.read()
    await minimal.detail('review')
    await expect(standard.setUserInvocable('review', false)).rejects.toThrow('Only Skills')
    expect(snapshot).toHaveBeenCalledWith({ scope: { id: 'standard' } })
    expect(get.mock.calls).toEqual([['review', { scope: { id: 'minimal' } }], ['review', { scope: { id: 'standard' } }]])
    expect(standingKeyFor.mock.calls).toEqual([['standard'], ['minimal'], ['standard']])
  })

  it('does not silently fall back when an explicit preset is unavailable', async () => {
    const snapshot = vi.fn()
    const ctx = { get: () => undefined, skills: { snapshot } } as unknown as Context
    await expect(new DesktopSkillsController(ctx, 'missing').read()).rejects.toThrow('presets are unavailable')
    expect(snapshot).not.toHaveBeenCalled()
  })

  it('surfaces a broken default preset instead of falling back to the empty global layer', async () => {
    const snapshot = vi.fn()
    const controller = new DesktopSkillsController({
      get: () => ({ standingKeyFor: async () => { throw new Error('preset unavailable') } }), skills: { snapshot },
    } as unknown as Context)
    await expect(controller.read()).rejects.toThrow('preset unavailable')
    expect(snapshot).not.toHaveBeenCalled()
  })

  it('updates only a regular file in a user Skill library', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawclaw-skills-'))
    vi.stubEnv('DSH_HOME', root)
    const path = join(root, 'skills', 'review', 'SKILL.md')
    await mkdir(join(root, 'skills', 'review'), { recursive: true })
    await writeFile(path, '---\nname: review\ndescription: Old\ncustom: keep\n---\n\nOld.\n')
    const userSkill = { ...skill, source: 'user-dsh', path }
    const ctx = { get: () => undefined, skills: {
      get: vi.fn(async () => userSkill), snapshot: vi.fn(async () => ({ skills: [userSkill], complete: true })),
    } } as unknown as Context
    try {
      const controller = new DesktopSkillsController(ctx)
      const result = await controller.update('review', {
        name: 'review', description: 'Updated', whenToUse: 'During review', instructions: 'Use the checklist.',
      }, (await controller.detail('review')).revision)
      expect(result.skills[0]).toEqual(expect.objectContaining({ description: 'Updated', whenToUse: 'During review' }))
      expect(await readFile(path, 'utf8')).toContain('custom: keep')
      expect(await readFile(path, 'utf8')).toContain('Use the checklist.')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('creates a user Skill bundle without waiting for filesystem discovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawclaw-skills-create-'))
    vi.stubEnv('DSH_HOME', root)
    const ctx = { get: () => undefined, skills: { snapshot: vi.fn(async () => ({ skills: [], complete: true })) } } as unknown as Context
    try {
      const result = await new DesktopSkillsController(ctx).create({
        name: 'release-check', description: 'Check a release', whenToUse: 'Before publishing', instructions: 'Run all checks.',
      })
      expect(result.skills).toEqual([expect.objectContaining({ name: 'release-check', source: 'user-dsh', editable: true })])
      expect(await readFile(join(root, 'skills', 'release-check', 'SKILL.md'), 'utf8')).toContain('whenToUse: Before publishing')
      await expect(new DesktopSkillsController(ctx).create({
        name: 'release-check', description: 'Duplicate', instructions: 'No.',
      })).rejects.toThrow('already exists')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
