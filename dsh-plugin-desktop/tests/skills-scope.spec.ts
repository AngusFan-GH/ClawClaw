import { mkdtemp, mkdir, rename, readFile, rm, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { describe, expect, it, vi } from 'vitest'
import { DesktopSkillsController } from '../src/skills.ts'
import { prepareClawClawDataLayout } from '../src/product-data-layout.ts'

describe('Skill discovery scope', () => {
  it.each([false, true])('keeps migration, installation, discovery and recycle in the active data directory (relocated: %s)', async relocated => {
    const home = await mkdtemp(join(tmpdir(), 'clawclaw-skill-layout-'))
    const ctx = new Context()
    try {
      const legacy = join(home, '.dsh')
      await mkdir(join(legacy, 'skills', 'legacy-skill'), { recursive: true })
      await writeFile(join(legacy, 'skills', 'legacy-skill', 'SKILL.md'), '---\nname: legacy-skill\ndescription: Migrated skill\n---\nLegacy instructions\n')
      const layout = prepareClawClawDataLayout(home)
      expect(layout.migratedLegacyHome).toBe(true)
      const activeHome = relocated ? join(home, 'custom-data') : layout.dshHome
      if (relocated) await rename(layout.dshHome, activeHome)
      vi.stubEnv('DSH_HOME', activeHome)
      await mkdir(layout.defaultWorkspace, { recursive: true })
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillFileSystem, { dshHome: activeHome, agentsHome: join(home, '.agents'), watch: true })
      const host = { skills: ctx.skills, get: (name: string) => name === 'workspaceRegistry'
        ? { get: () => ({ path: layout.defaultWorkspace, status: async () => 'ok' }) } : undefined } as unknown as Context
      const controller = new DesktopSkillsController(host, undefined, { workspaceId: 'default' })
      expect((await controller.read()).locations).toEqual({ userLibrary: join(activeHome, 'skills'), recycleBin: join(activeHome, 'skills', '.recycle'), cwd: layout.defaultWorkspace })
      expect((await controller.detail('legacy-skill')).path).toBe(join(activeHome, 'skills', 'legacy-skill', 'SKILL.md'))
      await controller.create({ name: 'new-skill', description: 'Created skill', instructions: 'New instructions' })
      await vi.waitFor(async () => { expect((await controller.detail('new-skill')).content).toContain('New instructions') })
      expect(await readFile(join(activeHome, 'skills', 'new-skill', 'SKILL.md'), 'utf8')).toContain('New instructions')
      await controller.update('new-skill', { name: 'new-skill', description: 'Updated skill', instructions: 'Updated instructions' }, (await controller.detail('new-skill')).revision)
      await vi.waitFor(async () => { expect((await controller.detail('new-skill')).content).toContain('Updated instructions') })
      const removed = await controller.recycle('new-skill')
      expect(removed.recycled).toHaveLength(1)
      await vi.waitFor(async () => { expect((await controller.read()).skills.some(skill => skill.name === 'new-skill')).toBe(false) })
      await controller.restore(removed.recycled[0]!.id)
      await vi.waitFor(async () => { expect((await controller.detail('new-skill')).content).toContain('Updated instructions') })
      expect((await controller.read()).recycled).toHaveLength(0)
      await expect(access(legacy)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(join(layout.defaultWorkspace, '.dsh'))).rejects.toMatchObject({ code: 'ENOENT' })
      if (relocated) await expect(access(layout.dshHome)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await ctx.fiber.dispose(); vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true })
    }
  })
  it('uses the recorded Session cwd and preset for both inventory and details', async () => {
    const scope = {}
    const snapshot = vi.fn(async () => ({ skills: [], complete: true }))
    const get = vi.fn(async () => undefined)
    const dispose = vi.fn()
    const standingKeyFor = vi.fn(async () => scope)
    const observeSession = vi.fn(async () => ({ header: { cwd: '/project/a' }, projections: { values: { agentPreset: 'custom' } }, [Symbol.dispose]: dispose }))
    const ctx = { skills: { snapshot, get }, get: (name: string) => name === 'agentPresets' ? { standingKeyFor } : name === 'sessionQuery' ? { observeSession } : undefined } as unknown as Context
    const controller = new DesktopSkillsController(ctx, undefined, { sessionId: 'session-a' })
    expect((await controller.read()).locations).toMatchObject({ cwd: '/project/a', preset: 'custom' })
    await expect(controller.detail('review')).rejects.toThrow('Skill not found')
    expect(observeSession).toHaveBeenCalledWith('session-a')
    expect(standingKeyFor).toHaveBeenCalledWith('custom')
    expect(snapshot).toHaveBeenCalledWith({ cwd: '/project/a', scope })
    expect(get).toHaveBeenCalledWith('review', { cwd: '/project/a', scope })
    expect(dispose).toHaveBeenCalledTimes(2)
  })
  it('uses the live Session registry, matching the conversation catalog', async () => {
    const live = {}
    const snapshot = vi.fn(async () => ({ skills: [], complete: true }))
    const serviceFor = vi.fn(() => ({ snapshot }))
    const root = vi.fn()
    const ctx = { skills: { snapshot: root }, get: (name: string) => ({
      agentPresets: { serviceFor }, agents: { get: () => live },
      sessionQuery: { observeSession: async () => ({ header: { cwd: '/project/a' }, projections: { values: { agentPreset: 'custom' } }, [Symbol.dispose]: () => {} }) },
    })[name] } as unknown as Context
    await new DesktopSkillsController(ctx, undefined, { sessionId: 'session-a' }).read()
    expect(serviceFor).toHaveBeenCalledWith(live, 'skills')
    expect(snapshot).toHaveBeenCalledWith({ cwd: '/project/a', scope: live })
    expect(root).not.toHaveBeenCalled()
  })
  it('does not fall back to global Skills when a scope is invalid', async () => {
    const snapshot = vi.fn()
    const ctx = { skills: { snapshot }, get: () => undefined } as unknown as Context
    await expect(new DesktopSkillsController(ctx, undefined, { workspaceId: 'missing' }).read()).rejects.toThrow('Workspace not found')
    await expect(new DesktopSkillsController(ctx, undefined, { sessionId: 'missing' }).read()).rejects.toThrow('Session discovery is unavailable')
    await expect(new DesktopSkillsController(ctx, undefined, { sessionId: 'a', workspaceId: 'b' }).read()).rejects.toThrow('either')
    await expect(new DesktopSkillsController(ctx, 'standard', { sessionId: 'a' }).read()).rejects.toThrow('recorded')
    expect(snapshot).not.toHaveBeenCalled()
  })
  it('discovers Agent-installed project files, refreshes watched catalogs and preserves Workspace isolation', async () => {
    const home = await mkdtemp(join(tmpdir(), 'clawclaw-skill-scope-'))
    const ctx = new Context()
    vi.stubEnv('DSH_HOME', join(home, 'user'))
    const first = join(home, 'project-a'); const second = join(home, 'project-b')
    try {
      for (const project of [first, second]) await mkdir(join(project, '.git'), { recursive: true })
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillFileSystem, { dshHome: join(home, 'user'), agentsHome: join(home, 'agents'), watch: true })
      const registry = { get: (id: string) => ({ path: id === 'a' ? first : second, status: async () => 'ok' }) }
      const host = { skills: ctx.skills, get: (name: string) => name === 'workspaceRegistry' ? registry : undefined } as unknown as Context
      const a = new DesktopSkillsController(host, undefined, { workspaceId: 'a' })
      const b = new DesktopSkillsController(host, undefined, { workspaceId: 'b' })
      expect((await a.read()).skills).toHaveLength(0)
      expect((await b.read()).skills).toHaveLength(0)
      const install = async (root: string, name: string, content: string) => {
        const directory = join(root, name)
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${content}\n---\n${content}\n`)
      }
      await install(join(first, '.agents', 'skills'), 'project-review', 'Project A instructions')
      await install(join(home, 'user', 'skills'), 'project-review', 'Global instructions')
      await vi.waitFor(async () => {
        expect((await a.read()).skills).toContainEqual(expect.objectContaining({ name: 'project-review', source: 'project-agents', editable: false }))
        expect((await b.read()).skills).toContainEqual(expect.objectContaining({ name: 'project-review', source: 'user-dsh' }))
      }, { timeout: 5000 })
      expect((await a.detail('project-review')).content).toContain('Project A instructions')
      expect((await a.read()).installed).toContainEqual(expect.objectContaining({ name: 'project-review', status: 'overridden', effectiveSource: 'project-agents', effectivePath: join(first, '.agents', 'skills', 'project-review', 'SKILL.md') }))
      expect((await b.read()).installed).toContainEqual(expect.objectContaining({ name: 'project-review', status: 'effective' }))
      await mkdir(join(home, 'user', 'skills', 'broken'), { recursive: true })
      await writeFile(join(home, 'user', 'skills', 'broken', 'SKILL.md'), 'Not a valid document')
      expect((await a.read()).installed).toContainEqual(expect.objectContaining({ name: 'broken', status: 'invalid', reason: 'invalid-document' }))
      await mkdir(join(home, 'user', 'skills', 'missing'), { recursive: true })
      expect((await a.read()).installed).toContainEqual(expect.objectContaining({ name: 'missing', reason: 'missing-file' }))
      await mkdir(join(home, 'user', 'skills', 'large'), { recursive: true })
      await writeFile(join(home, 'user', 'skills', 'large', 'SKILL.md'), 'x'.repeat(256 * 1024 + 1))
      expect((await a.read()).installed).toContainEqual(expect.objectContaining({ name: 'large', status: 'unavailable', reason: 'inspection-limit' }))
      expect((await a.read()).skills.some(skill => skill.name === 'broken')).toBe(false)
      await mkdir(join(home, 'user', 'skills', 'external'), { recursive: true })
      await writeFile(join(home, 'user', 'skills', 'external', 'SKILL.md'), `---\nname: external\ndescription: ${'x'.repeat(4001)}\n---\n`)
      await vi.waitFor(async () => {
        expect((await b.read()).installed).toContainEqual(expect.objectContaining({ name: 'external', status: 'effective' }))
      }, { timeout: 5000 })
      expect((await b.detail('project-review')).content).toContain('Global instructions')
      await expect(a.recycle('project-review')).rejects.toThrow('Only Skills')
      await expect(a.setUserInvocable('project-review', false)).rejects.toThrow('Only Skills')
      await install(join(second, '.dsh', 'skills'), 'only-b', 'Project B instructions')
      await vi.waitFor(async () => { expect((await b.read()).skills.some(skill => skill.name === 'only-b')).toBe(true) }, { timeout: 5000 })
      expect((await a.read()).skills.some(skill => skill.name === 'only-b')).toBe(false)
    } finally {
      await ctx.fiber.dispose(); vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true })
    }
  })
})
