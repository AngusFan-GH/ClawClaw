import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { openCronRunSession } from '../src/client/CronTasksSettingsSection.tsx'
import { applyCronTasksSettings } from '../src/client/cron-tasks-settings.ts'
import { applyMcpSettings } from '../src/client/mcp-settings.ts'
import { applySkillsSettings } from '../src/client/skills-settings.ts'

describe('Desktop Skills and MCP settings registration', () => {
  it('registers independent menu entries and sections', () => {
    const registrations: Array<{ id: string, locale: string }> = []
    const ctx = {
      effect: vi.fn(),
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

describe('Desktop scheduled tasks settings registration', () => {
  it('waits for Workspace navigation locally without blocking the desktop shell', () => {
    const registrations: Array<{ id: string, locale: string }> = []
    const inject = vi.fn((_services: string[], install: (scope: ClientContext) => void) => { install(ctx) })
    const ctx = {
      effect: vi.fn(), inject,
      locale: {
        bind: (namespace: string) => (key: string) => `${namespace}.${key}`,
        register: vi.fn(), getSnapshot: () => ({ active: 'en' }),
      },
      slots: {
        inject: vi.fn((_name: string, install: () => void) => { install() }),
        register: vi.fn((definition: { id: string, locale: string }) => { registrations.push(definition) }),
      },
    } as unknown as ClientContext

    applyCronTasksSettings(ctx)

    const entry = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
    const topLevelInject = entry.match(/export const inject = \[([\s\S]*?)\]/)?.[1]
    expect(topLevelInject).not.toContain("'uiWorkspace'")
    expect(topLevelInject).not.toContain("'workspaces'")
    expect(inject).toHaveBeenCalledWith(['uiWorkspace', 'workspaces'], expect.any(Function))
    expect(registrations).toEqual([
      expect.objectContaining({ id: 'desktop-cron-tasks', locale: 'desktop.cron-tasks' }),
    ])
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
