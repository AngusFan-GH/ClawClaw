import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { describe, expect, it, vi } from 'vitest'
import { DesktopSkillsController } from '../src/skills.ts'

describe('Skill discovery scope', () => {
  it('uses the recorded Session cwd and preset for both inventory and details', async () => {
    const scope = {}
    const snapshot = vi.fn(async () => ({ skills: [], complete: true }))
    const get = vi.fn(async () => undefined)
    const dispose = vi.fn()
    const standingKeyFor = vi.fn(async () => scope)
    const observeSession = vi.fn(async () => ({ header: { cwd: '/project/a' }, projections: { values: { agentPreset: 'custom' } }, [Symbol.dispose]: dispose }))
    const ctx = { skills: { snapshot, get }, get: (name: string) => name === 'agentPresets' ? { standingKeyFor } : name === 'sessionQuery' ? { observeSession } : undefined } as unknown as Context
    const controller = new DesktopSkillsController(ctx, undefined, { sessionId: 'session-a' })
    await controller.read()
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
