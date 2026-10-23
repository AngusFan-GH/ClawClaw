import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { openCronRunSession } from '../src/client/CronTasksSettingsSection.tsx'
import { applyCronTasksSettings } from '../src/client/cron-tasks-settings.ts'
import { zh as mcpZh } from '../src/client/mcp-locales.ts'
import { applyMcpSettings } from '../src/client/mcp-settings.ts'
import { applySkillsSettings } from '../src/client/skills-settings.ts'

describe('Desktop Skills and MCP settings registration', () => {
  it('localizes the MCP settings label and title in Chinese', () => {
    expect(mcpZh.nav).toBe('连接器')
    expect(mcpZh.title).toBe('连接器')
  })

  it('registers independent menu entries and sections', () => {
    const registrations: Array<{ id: string, locale: string }> = []
    const ctx = {
      effect: vi.fn(),
      inject: vi.fn(),
      locale: { bind: (namespace: string) => (key: string) => `${namespace}.${key}`, register: vi.fn() },
      slots: {
        inject: vi.fn((_name: string, install: () => void) => { install() }),
        register: vi.fn((definition: { id: string, locale: string }) => { registrations.push(definition) }),
      },
    } as unknown as ClientContext

    applySkillsSettings(ctx)
    applyMcpSettings(ctx)
    expect(registrations).toEqual([
      expect.objectContaining({ id: 'desktop-skills', locale: 'desktop.skills' }),
      expect.objectContaining({ id: 'desktop-mcp', locale: 'desktop.mcp' }),
    ])
  })
})

describe('Desktop automation panel registration', () => {
  it('waits for Workspace navigation locally without blocking the desktop shell', () => {
    const registrations: Array<{ id?: string, key?: string, name: string, locale: string }> = []
    const inject = vi.fn((_services: string[], install: (scope: ClientContext) => void) => { install(ctx) })
    const ctx = {
      effect: vi.fn(), inject,
      locale: {
        bind: (namespace: string) => (key: string) => `${namespace}.${key}`,
        register: vi.fn(), getSnapshot: () => ({ active: 'en' }),
      },
      slots: {
        inject: vi.fn((_name: string, install: () => void) => { install() }),
        register: vi.fn((definition: { id?: string, key?: string, name: string, locale: string }) => { registrations.push(definition) }),
      },
    } as unknown as ClientContext

    applyCronTasksSettings(ctx)

    const entry = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
    const topLevelInject = entry.match(/export const inject = \[([\s\S]*?)\]/)?.[1]
    expect(topLevelInject).not.toContain("'uiWorkspace'")
    expect(topLevelInject).not.toContain("'workspaces'")
    expect(inject).toHaveBeenCalledWith(['uiWorkspace', 'workspaces'], expect.any(Function))
    expect(registrations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'sidebar.session.row.leading',
        id: 'desktop-cron-session-source',
      }),
      expect.objectContaining({ name: 'main', key: 'desktop-automations', locale: 'desktop.cron-tasks' }),
    ]))
  })

  it('closes Settings only after the scheduled Session opens successfully', async () => {
    const calls: string[] = []
    await openCronRunSession(async () => { calls.push('open') }, () => { calls.push('close') }, 'task-1', 'session-1')
    expect(calls).toEqual(['open', 'close'])

    const close = vi.fn()
    await expect(openCronRunSession(async () => { throw new Error('unknown session') }, close, 'task-1', 'session-1'))
      .rejects.toThrow('unknown session')
    expect(close).not.toHaveBeenCalled()
  })
})


describe('scheduled Session navigation with rc.2 reference ownership', () => {
  it.each([true, false])('retains an unopened Session for rename (success=%s)', async (ok) => {
    const sessionId = 'cron-existing-unopened'
    const rename = vi.fn(async () => ok ? { ok: true } : { ok: false, error: { message: 'Rename rejected' } })
    const binding = vi.fn(() => undefined)
    const using = vi.fn(async (_id, _options, operation) => operation({ binding: { session: { rename } } }))
    const refresh = vi.fn(async () => {})
    const openSession = vi.fn()
    let injectPanel: (() => { openSession(taskId: string, sessionId: string): Promise<void> }) | undefined
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      attached: true, sessionId, workspaceId: 'workspace-1', title: 'Existing task',
    }), { status: 200 })))
    const ctx = {
      effect: vi.fn(),
      inject: (_services: string[], install: (scope: ClientContext) => void) => { install(ctx) },
      get: () => ({ using, binding, refresh }),
      workspaces: { insertSessionBefore: vi.fn(async () => {}) },
      uiWorkspace: { openSession },
      locale: { bind: () => (key: string) => key, getSnapshot: () => ({ active: 'en' }) },
      slots: {
        inject: (_name: string, install: () => void) => { install() },
        register: (definition: { name: string, inject?: typeof injectPanel }) => {
          if (definition.name === 'main') injectPanel = definition.inject
        },
      },
    } as unknown as ClientContext
    try {
      applyCronTasksSettings(ctx)
      const opening = injectPanel!().openSession('existing-task', sessionId)
      if (ok) await expect(opening).resolves.toBeUndefined()
      else await expect(opening).rejects.toThrow('Rename rejected')
      expect(using).toHaveBeenCalledWith(sessionId, { source: 'controllerOperation' }, expect.any(Function))
      expect(binding).not.toHaveBeenCalled()
      expect(rename).toHaveBeenCalledWith('[Cron] Existing task')
      if (ok) expect(openSession).toHaveBeenCalledWith(sessionId)
      else expect(openSession).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })
})
