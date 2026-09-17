import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
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
