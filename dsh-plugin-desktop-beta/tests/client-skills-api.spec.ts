import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createDesktopSkillsApi, parseDesktopSkillsView } from '../src/client/skills-api.ts'

const view = { skills: [{ name: 'review', description: 'Review code', source: 'user-dsh', provider: 'filesystem',
  modelInvocable: true, userInvocable: true, editable: true }], recycled: [] }

describe('Desktop Skills client API', () => {
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
