import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createDesktopSkillsApi, parseDesktopSkillsView } from '../src/client/skills-api.ts'

const view = { skills: [{ name: 'review', description: 'Review code', source: 'user-dsh', provider: 'filesystem',
  modelInvocable: true, userInvocable: true, editable: true }], recycled: [] }

describe('Desktop Skills client API', () => {
  it('submits only confirmed recycled IDs and validates partial purge results', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ deleted: ['a'], failed: ['b'] })))
    const api = createDesktopSkillsApi(fetcher)
    expect(await api.purge!(['a', 'b'])).toEqual({ deleted: ['a'], failed: ['b'] })
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ action: 'purge', ids: ['a', 'b'] })
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ deleted: ['unconfirmed'], failed: ['b'] })))
    await expect(api.purge!(['a', 'b'])).rejects.toThrow('Invalid Skill purge result')
  })
  it('validates installation diagnostics independently of effective Skills', () => {
    const installed = [{ name: 'hidden', path: '/data/skills/hidden/SKILL.md', status: 'overridden', effectivePath: '/project/.agents/skills/hidden/SKILL.md', effectiveSource: 'project-agents' }]
    expect(parseDesktopSkillsView({ ...view, installed }).installed).toEqual(installed)
    expect(parseDesktopSkillsView({ ...view, installed }).skills).toEqual(view.skills)
    expect(() => parseDesktopSkillsView({ ...view, installed: [{ ...installed[0], status: 'unknown' }] })).toThrow('Invalid Skill installation')
    expect(() => parseDesktopSkillsView({ ...view, installed: [{ ...installed[0], reason: 'unknown' }] })).toThrow('Invalid Skill installation')
    expect(() => parseDesktopSkillsView({ ...view, installed: [{ ...installed[0], effectivePath: 123 }] })).toThrow('Invalid Skill installation')
  })
  it('preserves server-resolved directories and rejects malformed location metadata', () => {
    const locations = { userLibrary: '/custom/data/skills', recycleBin: '/custom/data/skills/.recycle', cwd: '/workspaces/default', projectLibrary: '/workspaces/default/.clawclaw/skills', preset: 'custom' }
    expect(parseDesktopSkillsView({ ...view, locations }).locations).toEqual(locations)
    expect(parseDesktopSkillsView(view).locations).toBeUndefined()
    expect(() => parseDesktopSkillsView({ ...view, locations: { ...locations, cwd: 42 } })).toThrow('Invalid Skill locations')
    expect(() => parseDesktopSkillsView({ ...view, locations: { ...locations, projectLibrary: 42 } })).toThrow('Invalid Skill locations')
    expect(() => parseDesktopSkillsView({ ...view, locations: { ...locations, preset: 42 } })).toThrow('Invalid Skill locations')
    expect(() => parseDesktopSkillsView({ ...view, locations: { ...locations, userLibrary: '' } })).toThrow('Invalid Skill locations')
  })
  it('validates and manages explicit scan paths', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      ...view, scanPaths: ['/opt/team-skills'],
    })))
    const api = createDesktopSkillsApi(fetcher)
    expect((await api.readView()).scanPaths).toEqual(['/opt/team-skills'])
    await api.addScanPath('/opt/extra-skills')
    expect(JSON.parse(String(fetcher.mock.lastCall?.[1]?.body))).toEqual({ action: 'add-scan-path', path: '/opt/extra-skills' })
    await api.removeScanPath('/opt/team-skills')
    expect(JSON.parse(String(fetcher.mock.lastCall?.[1]?.body))).toEqual({ action: 'remove-scan-path', path: '/opt/team-skills' })
    expect(() => parseDesktopSkillsView({ ...view, scanPaths: [42] })).toThrow('Invalid Skill scan paths')
  })
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
    expect(entry.indexOf('applySkillsSettings(ctx,')).toBeLessThan(entry.indexOf('if (!environment) return'))
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
