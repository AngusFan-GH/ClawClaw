import { describe, expect, it, vi } from 'vitest'
import { acceptCatalog, catalogState, refreshCatalog, subscribeCatalog } from '../src/experts/client/catalog.ts'
import { acceptTeamSnapshot, refreshTeams, teamState } from '../src/experts/client/team-cache.ts'
import type { TeamRemote } from '../src/experts/client/team-ui.tsx'

const expert = {
  slug: 'reviewer',
  name: '评审专家',
  nameEn: 'Reviewer',
  description: '负责评审',
  descriptionEn: 'Reviews work',
  emoji: 'R',
  division: 'testing',
  divisionZh: '测试',
  custom: false,
  skills: [],
  mcpServers: [],
}

describe('expert team client cache', () => {
  it('does not mistake a partial team receipt for a loaded expert roster', async () => {
    let finish!: (value: Awaited<ReturnType<TeamRemote['getCatalog']>>) => void
    const remote = { getCatalog: vi.fn(() => new Promise(resolve => { finish = resolve })) } as unknown as TeamRemote
    const pending = refreshCatalog(remote)
    acceptTeamSnapshot(remote, { teams: [], enabledExperts: ['reviewer'], revision: 2 })
    expect(catalogState(remote).revision).toBe(-1)
    finish({ ok: true, value: { experts: [expert], enabled: [], revision: 1 } })
    await pending
    expect(catalogState(remote).experts.map(item => item.slug)).toEqual(['reviewer'])
    expect(catalogState(remote).enabled).toEqual(new Set(['reviewer']))
    expect(catalogState(remote).revision).toBe(2)
  })

  it('synchronizes polled team member changes into an already loaded expert roster', async () => {
    const remote = { getTeams: vi.fn(async () => ({ ok: true, value: { teams: [], enabledExperts: ['reviewer'], revision: 2 } })) } as unknown as TeamRemote
    acceptCatalog(remote, { experts: [expert], enabled: [], revision: 1 })
    await refreshTeams(remote)
    expect(catalogState(remote).enabled).toEqual(new Set(['reviewer']))
    expect(catalogState(remote).experts).toHaveLength(1)
  })

  it('publishes enabled team members to the expert catalog immediately', () => {
    const remote = {} as TeamRemote
    acceptCatalog(remote, { experts: [expert], enabled: [], revision: 1 })
    const listener = vi.fn()
    const unsubscribe = subscribeCatalog(remote, listener)

    acceptTeamSnapshot(remote, {
      teams: [],
      enabledExperts: ['reviewer'],
      revision: 2,
    })

    expect(teamState(remote)?.enabledExperts).toEqual(['reviewer'])
    expect(catalogState(remote).enabled).toEqual(new Set(['reviewer']))
    expect(catalogState(remote).revision).toBe(2)
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('does not let an older in-flight catalog request undo a team enable', async () => {
    let finish!: (value: Awaited<ReturnType<TeamRemote['getCatalog']>>) => void
    const remote = {
      getCatalog: vi.fn(() => new Promise(resolve => { finish = resolve })),
    } as unknown as TeamRemote
    acceptCatalog(remote, { experts: [expert], enabled: [], revision: 1 })
    const pending = refreshCatalog(remote)

    acceptTeamSnapshot(remote, {
      teams: [],
      enabledExperts: ['reviewer'],
      revision: 2,
    })
    finish({ ok: true, value: { experts: [expert], enabled: [], revision: 1 } })

    await expect(pending).resolves.toMatchObject({ revision: 2 })
    expect(catalogState(remote).enabled).toEqual(new Set(['reviewer']))
  })
})
