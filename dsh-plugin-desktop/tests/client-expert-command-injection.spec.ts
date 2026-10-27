// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { inject as desktopInject } from '../src/client/index.ts'
import { inject as expertsInject } from '../src/experts/client/index.ts'
import { skillInsertion } from '../src/client/conversation-skills.ts'

// The package build supplies this module's virtual plugin-manager import.
vi.mock('../src/client/plugin-manager.ts', () => ({ applyManagedPluginManager: vi.fn() }))
vi.mock('../src/client/git-graph.ts', () => ({ applyDesktopGitGraph: vi.fn() }))

describe('expert menu command dependency', () => {
  it.each([
    ['Desktop direct application', desktopInject],
    ['Experts plugin', expertsInject],
  ] as const)('checks Skill collisions through the %s context', async (_name, inject) => {
    const context = new Context()
    // A real associated service preserves Cordis namespace access checks.
    class Remote extends Service {
      constructor(ctx: Context) { super(ctx, 'remote') }
    }
    const remoteFiber = context.plugin(Remote)
    await remoteFiber
    const list = vi.fn(async (_sessionId: string) => ({ ok: true as const, value: [{ name: 'help' }] }))
    for (const name of inject) {
      if (name !== 'remote') context.provide(name, name === 'remote.commands' ? { list } : {})
    }
    // Provide the namespace even when the dependency declaration regresses.
    if (!inject.includes('remote.commands')) context.provide('remote.commands', { list })
    let scope!: Context
    const fiber = context.plugin({ inject: [...inject], apply(ctx: Context) { scope = ctx } })
    await fiber
    try {
      const remote = scope.remote as unknown as { commands: { list: typeof list } }
      const result = await remote.commands.list('current-session')
      expect(list).toHaveBeenCalledExactlyOnceWith('current-session')
      const state = { draft: 'Review this', draftRev: 7, phase: 'plain' as const }
      const catalog = {
        skills: [{ name: 'review', description: 'Review code', modelInvocable: true }],
        commands: result.value.map(command => command.name),
      }
      expect(skillInsertion('review', state, catalog).text).toBe('/review ')
      expect(() => skillInsertion('review', state, { ...catalog, commands: ['review'] })).toThrow('skillCommandConflict')
    } finally {
      await fiber.dispose()
      await remoteFiber.dispose()
    }
  })
})
