import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createDesktopSkillsApi, parseDesktopSkillsView } from '../src/client/skills-api.ts'

const view = { skills: [{ name: 'review', description: 'Review code', source: 'user-dsh', provider: 'filesystem',
  modelInvocable: true, userInvocable: true, editable: true }], recycled: [] }

describe('Desktop Skills client API', () => {
  it('preserves Workspace scope across preset changes and every request', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify(JSON.parse(String(init?.body ?? '{}')).action === 'detail' ? { ...view.skills[0], content: 'Instructions' } : view)))
    const base = createDesktopSkillsApi(fetcher)
    const selection = { workspaceId: 'project-a' }
    const api = base.forScope(selection).forPreset('standard')
    selection.workspaceId = 'project-b'
    await api.readView(); await api.detail('review'); await api.setUserInvocable('review', false)
    for (const [, init] of fetcher.mock.calls) expect(JSON.parse(String(init?.body))).toMatchObject({ workspaceId: 'project-a', preset: 'standard' })
    await base.forScope({ sessionId: 'session-a' }).readView()
    expect(JSON.parse(String(fetcher.mock.lastCall?.[1]?.body))).toEqual({ action: 'read', sessionId: 'session-a' })
    await base.readView()
    expect(fetcher.mock.lastCall?.[1]?.method).toBe('GET')
  })
  it('carries the selection through every operation without mutating the default client', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string }
      return new Response(JSON.stringify(body.action === 'detail' ? { ...view.skills[0], content: 'Instructions' } : view))
    })
    const base = createDesktopSkillsApi(fetcher)
    const api = base.forPreset('minimal')
    await api.readView()
    await api.detail('review')
    await api.setModelInvocable('review', false)
    await api.setUserInvocable('review', false)
    await api.importDocument('document')
    const input = { name: 'review', description: 'Review', instructions: 'Review code' }
    await api.create(input)
    await api.update('review', input)
    await api.recycle('review')
    await api.restore('id')
    for (const [, init] of fetcher.mock.calls) expect(JSON.parse(String(init?.body))).toHaveProperty('preset', 'minimal')
    await base.readView()
    expect(fetcher.mock.lastCall?.[1]?.method).toBe('GET')
  })
  it('registers Skills before the Electron-only client boundary', () => {
    const entry = readFileSync('src/client/index.ts', 'utf8')
    expect(entry.indexOf('applySkillsSettings(ctx)')).toBeLessThan(entry.indexOf('if (!environment) return'))
  })

  it('validates an independent Skills response', () => {
    expect(parseDesktopSkillsView(view)).toEqual(view)
    expect(() => parseDesktopSkillsView({ skills: [...view.skills, view.skills[0]] })).toThrow(/duplicate/)
    expect(() => parseDesktopSkillsView({ ...view, mcpServers: [] })).not.toThrow()
  })

  it('uses only the Skills routes', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(view), { status: 200 }))
    const api = createDesktopSkillsApi(fetcher)
    await api.read()
    await api.setModelInvocable('review', false)
    const input = { name: 'release-check', description: 'Check releases', whenToUse: 'Before release', instructions: 'Run checks.' }
    await api.create(input)
    await api.update('release-check', input)
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/desktop/skills')
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/desktop/skills/action')
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ action: 'set-model-invocable', name: 'review', enabled: false })
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({ action: 'create', input })
    expect(JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body))).toEqual({ action: 'update', name: 'release-check', input })
  })
})
