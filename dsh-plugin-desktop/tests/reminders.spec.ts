import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { DesktopRemindersController } from '../src/reminders.ts'
import { parseDesktopRemindersView } from '../src/client/reminders-api.ts'

describe('global reminders', () => {
  it('updates the product-owned prompt section as reminders change', async () => {
    let current = { reminders: [] as Array<{ id: string, text: string, enabled: boolean, createdAt: string, updatedAt: string }> }
    const stop = vi.fn()
    let registered: { readonly name: string, readonly text: () => string } | undefined
    const section = vi.fn((value: { readonly name: string, readonly text: () => string }) => { registered = value; return stop })
    const settings = {
      get: () => current,
      replace: async (next: typeof current) => { current = next },
      watch: () => () => {},
    }
    const controller = new DesktopRemindersController({ systemPrompt: { section, getSectionOrder: () => 10 }, on: () => {} } as never, settings, () => '2026-09-23T00:00:00.000Z')
    controller.start()
    await controller.action({ action: 'create', text: 'Ask before publishing.' })
    expect(registered).toEqual(expect.objectContaining({ name: 'clawclaw:global-reminders', text: expect.any(Function) }))
    if (registered === undefined) throw new Error('Prompt section was not registered')
    expect(registered.text()).toContain('Mandatory ClawClaw Persistent Instructions')
    expect(registered.text()).toContain('Ask before publishing.')
    await controller.action({ action: 'toggle', id: current.reminders[0]!.id, enabled: false })
    expect(registered.text()).toBe('')
    controller.dispose()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('rejects prompt interpolation syntax and duplicate text', async () => {
    const settings = { get: () => ({ reminders: [] }), replace: async () => {}, watch: () => () => {} }
    const controller = new DesktopRemindersController({ systemPrompt: { section: () => () => {}, getSectionOrder: () => 10 }, on: () => {} } as never, settings as never)
    await expect(controller.action({ action: 'create', text: '{{unsafe}}' })).rejects.toThrow('cannot contain')
  })

  it('renders into a real system prompt assembly on every later turn', async () => {
    const ctx = new Context()
    const current = { reminders: [{ id: 'a', text: 'Always start with a status line.', enabled: true, createdAt: '2026-09-23', updatedAt: '2026-09-23' }] }
    const settings = { get: () => current, replace: async () => {}, watch: () => () => {} }
    try {
      await ctx.plugin(SystemPrompt, {})
      const controller = new DesktopRemindersController(ctx, settings)
      controller.start()
      expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Always start with a status line.')
      expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Mandatory ClawClaw Persistent Instructions')
      controller.dispose()
    } finally { await ctx.fiber.dispose() }
  })

  it('validates the bounded API shape', () => {
    expect(parseDesktopRemindersView({ reminders: [{ id: 'a', text: 'Reminder', enabled: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }] }).reminders).toHaveLength(1)
    expect(() => parseDesktopRemindersView({ reminders: [{ id: '', text: 'Reminder', enabled: true, createdAt: 'x', updatedAt: 'x' }] })).toThrow('Invalid reminder')
  })

  it('starts a new request series after a reminder change so prior instructions are replaced', async () => {
    let watcher: (() => void) | undefined
    let preStep: ((payload: { agent: object }, next: () => Promise<{ kind: 'enter', messages: [] }>) => Promise<{ kind: 'enter', messages: [], startsRequestSeries?: true }>) | undefined
    const changed = { reminders: [{ id: 'a', text: 'Updated reminder', enabled: true, createdAt: '2026-09-23', updatedAt: '2026-09-23' }] }
    const settings = {
      get: () => ({ reminders: [] }),
      replace: async () => {},
      watch: (callback: (_next: typeof changed) => void) => { watcher = () => callback(changed); return () => { watcher = undefined } },
    }
    const controller = new DesktopRemindersController({
      systemPrompt: { section: () => () => {}, getSectionOrder: () => 10 },
      on: (_event: string, listener: typeof preStep) => { preStep = listener },
    } as never, settings as never)
    controller.start()
    if (preStep === undefined || watcher === undefined) throw new Error('Controller did not install lifecycle hooks')
    const agent = {}
    const enter = async () => ({ kind: 'enter' as const, messages: [] as [] })
    await expect(preStep({ agent }, enter)).resolves.toMatchObject({ startsRequestSeries: true })
    await expect(preStep({ agent }, enter)).resolves.not.toHaveProperty('startsRequestSeries')
    watcher()
    await expect(preStep({ agent }, enter)).resolves.toMatchObject({ startsRequestSeries: true })
  })
})
