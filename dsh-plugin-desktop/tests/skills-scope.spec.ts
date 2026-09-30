import { mkdtemp, mkdir, rename, readFile, realpath, rm, symlink, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { describe, expect, it, vi } from 'vitest'
import { DesktopSkillsController } from '../src/skills.ts'
import { prepareClawClawDataLayout } from '../src/product-data-layout.ts'
import * as ClawClawSkillFileSystem from '../src/clawclaw-skill-filesystem.ts'
import { clawClawProjectSkillRoot, windowsWorkspaceKey } from '../src/clawclaw-skill-filesystem.ts'

describe('Skill discovery scope', () => {
  it.each([false, true])('keeps installation, discovery and recycle in the isolated active data directory (relocated: %s)', async relocated => {
    const home = await mkdtemp(join(tmpdir(), 'clawclaw-skill-layout-'))
    const ctx = new Context()
    try {
      const legacy = join(home, '.dsh')
      await mkdir(join(legacy, 'skills', 'legacy-skill'), { recursive: true })
      const legacyDocument = join(legacy, 'skills', 'legacy-skill', 'SKILL.md')
      await writeFile(legacyDocument, '---\nname: legacy-skill\ndescription: Harness skill\n---\nHarness instructions\n')
      const layout = prepareClawClawDataLayout(home)
      const activeHome = relocated ? join(home, 'custom-data') : layout.dshHome
      if (relocated) await rename(layout.dshHome, activeHome)
      await mkdir(join(activeHome, 'skills', 'clawclaw-skill'), { recursive: true })
      await writeFile(join(activeHome, 'skills', 'clawclaw-skill', 'SKILL.md'), '---\nname: clawclaw-skill\ndescription: ClawClaw skill\n---\nClawClaw instructions\n')
      vi.stubEnv('DSH_HOME', activeHome)
      await mkdir(layout.defaultWorkspace, { recursive: true })
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillFileSystem, { dshHome: activeHome, agentsHome: join(home, '.agents'), watch: true })
      const host = { skills: ctx.skills, get: (name: string) => name === 'workspaceRegistry'
        ? { get: () => ({ path: layout.defaultWorkspace, status: async () => 'ok' }) } : undefined } as unknown as Context
      const controller = new DesktopSkillsController(host, undefined, { workspaceId: 'default' })
      expect((await controller.read()).locations).toEqual({ userLibrary: join(activeHome, 'skills'), recycleBin: join(activeHome, 'skills', '.recycle'), cwd: layout.defaultWorkspace,
        projectLibrary: join(layout.defaultWorkspace, '.clawclaw', 'skills') })
      expect((await controller.detail('clawclaw-skill')).path).toBe(await realpath(join(activeHome, 'skills', 'clawclaw-skill', 'SKILL.md')))
      await expect(controller.detail('legacy-skill')).rejects.toThrow('Skill not found')
      await controller.create({ name: 'new-skill', description: 'Created skill', instructions: 'New instructions' })
      await vi.waitFor(async () => { expect((await controller.detail('new-skill')).content).toContain('New instructions') }, { timeout: 5000 })
      expect(await readFile(join(activeHome, 'skills', 'new-skill', 'SKILL.md'), 'utf8')).toContain('New instructions')
      await controller.update('new-skill', { name: 'new-skill', description: 'Updated skill', instructions: 'Updated instructions' }, (await controller.detail('new-skill')).revision)
      await vi.waitFor(async () => { expect((await controller.detail('new-skill')).content).toContain('Updated instructions') }, { timeout: 5000 })
      const removed = await controller.recycle('new-skill')
      expect(removed.recycled).toHaveLength(1)
      await vi.waitFor(async () => { expect((await controller.read()).skills.some(skill => skill.name === 'new-skill')).toBe(false) }, { timeout: 5000 })
      await controller.restore(removed.recycled[0]!.id)
      await vi.waitFor(async () => { expect((await controller.detail('new-skill')).content).toContain('Updated instructions') }, { timeout: 5000 })
      expect((await controller.read()).recycled).toHaveLength(0)
      expect(await readFile(legacyDocument, 'utf8')).toContain('Harness instructions')
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
    const disposeScope = vi.fn(async () => {})
    const disposeObservation = vi.fn()
    const acquireScope = vi.fn(async () => ({ key: scope, [Symbol.asyncDispose]: disposeScope }))
    const observeSession = vi.fn(async () => ({ header: { cwd: '/project/a' }, projections: { values: { agentPreset: 'custom' } }, [Symbol.dispose]: disposeObservation }))
    const ctx = { skills: { snapshot, get }, get: (name: string) => name === 'agentPresets' ? { acquireScope } : name === 'sessionQuery' ? { observeSession } : undefined } as unknown as Context
    const controller = new DesktopSkillsController(ctx, undefined, { sessionId: 'session-a' })
    expect((await controller.read()).locations).toMatchObject({ cwd: '/project/a', preset: 'custom' })
    await expect(controller.detail('review')).rejects.toThrow('Skill not found')
    expect(observeSession).toHaveBeenCalledWith('session-a')
    expect(acquireScope).toHaveBeenCalledWith('custom')
    expect(snapshot).toHaveBeenCalledWith({ cwd: '/project/a', scope })
    expect(get).toHaveBeenCalledWith('review', { cwd: '/project/a', scope })
    expect(disposeScope).toHaveBeenCalledTimes(2)
    expect(disposeObservation).toHaveBeenCalledTimes(2)
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
  it('discovers only ClawClaw project files, refreshes watched catalogs and preserves Workspace isolation', async () => {
    const home = await mkdtemp(join(tmpdir(), 'clawclaw-skill-scope-'))
    const ctx = new Context()
    vi.stubEnv('DSH_HOME', join(home, 'user'))
    const first = join(home, 'project-a'); const second = join(home, 'project-b')
    const external = join(home, 'external-skills')
    try {
      for (const project of [first, second]) await mkdir(join(project, '.git'), { recursive: true })
      ctx.provide('settings', { get: () => ({ paths: [external] }) } as unknown as Context['settings'])
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillFileSystem, { includeDefaultRoots: false, customSkillDirs: [join(home, 'user', 'skills')], watch: true })
      await ctx.plugin(ClawClawSkillFileSystem)
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
      await install(join(first, '.agents', 'skills'), 'ignored-agents', 'Shared Agent instructions')
      await install(join(first, '.dsh', 'skills'), 'ignored-dsh', 'Harness instructions')
      await install(join(first, '.clawclaw', 'skills'), 'project-review', 'Project A instructions')
      await install(join(home, 'user', 'skills'), 'project-review', 'Global instructions')
      await install(external, 'external-only', 'External instructions')
      await vi.waitFor(async () => {
        expect((await a.read()).skills).toContainEqual(expect.objectContaining({ name: 'project-review', source: 'project-clawclaw', provider: 'clawclaw-project-filesystem', editable: false }))
        expect((await b.read()).skills).toContainEqual(expect.objectContaining({ name: 'project-review', source: 'custom', editable: true }))
        expect((await b.read()).skills).toContainEqual(expect.objectContaining({ name: 'external-only', source: 'external-clawclaw', editable: false }))
      }, { timeout: 5000 })
      expect((await a.detail('project-review')).content).toContain('Project A instructions')
      expect((await a.read()).installed).toContainEqual(expect.objectContaining({ name: 'project-review', status: 'overridden', effectiveSource: 'project-clawclaw', effectivePath: await realpath(join(first, '.clawclaw', 'skills', 'project-review', 'SKILL.md')) }))
      expect((await b.read()).installed).toContainEqual(expect.objectContaining({ name: 'project-review', status: 'effective' }))
      await b.setUserInvocable('project-review', false)
      await vi.waitFor(async () => { expect((await b.detail('project-review')).userInvocable).toBe(false) }, { timeout: 5000 })
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
      await install(join(second, '.clawclaw', 'skills'), 'only-b', 'Project B instructions')
      await vi.waitFor(async () => { expect((await b.read()).skills.some(skill => skill.name === 'only-b')).toBe(true) }, { timeout: 5000 })
      expect((await a.read()).skills.some(skill => skill.name === 'only-b')).toBe(false)
      expect((await a.read()).skills.some(skill => skill.name === 'ignored-agents' || skill.name === 'ignored-dsh')).toBe(false)
    } finally {
      await ctx.fiber.dispose(); vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true })
    }
  })

  it('uses the selected cwd exactly and supports symlinked Workspace roots', async () => {
    const home = await mkdtemp(join(tmpdir(), 'clawclaw-skill-cwd-'))
    const ctx = new Context()
    try {
      const repository = join(home, 'repository')
      const nested = join(repository, 'packages', 'app')
      const alias = join(home, 'workspace-alias')
      await mkdir(join(repository, '.git'), { recursive: true })
      await mkdir(nested, { recursive: true })
      await mkdir(join(repository, '.clawclaw', 'skills', 'parent-only'), { recursive: true })
      await writeFile(join(repository, '.clawclaw', 'skills', 'parent-only', 'SKILL.md'), '---\nname: parent-only\ndescription: Parent\n---\nParent instructions\n')
      await mkdir(join(nested, '.clawclaw', 'skills', 'nested-only'), { recursive: true })
      await writeFile(join(nested, '.clawclaw', 'skills', 'nested-only', 'SKILL.md'), '---\nname: nested-only\ndescription: Nested\n---\nNested instructions\n')
      await symlink(nested, alias, 'dir')
      ctx.provide('settings', { get: () => ({ paths: [] }) } as unknown as Context['settings'])
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(ClawClawSkillFileSystem)
      expect((await ctx.skills.snapshot({ cwd: nested })).skills.map(skill => skill.name)).toEqual(['nested-only'])
      const throughAlias = await ctx.skills.get('nested-only', { cwd: alias })
      expect(throughAlias?.source).toBe('project-clawclaw')
      expect(throughAlias?.path).toBe(await realpath(join(alias, '.clawclaw', 'skills', 'nested-only', 'SKILL.md')))
    } finally {
      await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true })
    }
  })

  it('derives stable Windows roots and case-insensitive watcher keys', () => {
    expect(windowsWorkspaceKey('C:\\Work\\Project')).toBe(windowsWorkspaceKey('c:\\work\\PROJECT'))
    expect(windowsWorkspaceKey('C:\\Work\\Project')).not.toBe(windowsWorkspaceKey('C:\\Work\\Other'))
    expect(clawClawProjectSkillRoot('/workspace')).toBe(join('/workspace', '.clawclaw', 'skills'))
  })
})
