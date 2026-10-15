// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { installLegacyTeamReferenceGuard } from '../src/experts/client/legacy-team-reference.ts'
import { insertTeamReference, teamReference, teamSubmissionText } from '../src/experts/client/team-reference.ts'
import type { ExpertTeam } from '../src/experts/team-contract.ts'

const team = { id: 'research', name: '专题研究专家团' } as ExpertTeam

describe('expert team conversation reference', () => {
  it('keeps the composer chip while sending a non-file team marker', () => {
    expect(teamReference(team, 'zh')).toMatchObject({
      source: 'clawclaw-experts:teams',
      ref: 'research',
      label: '专题研究专家团',
      appearance: 'session',
      clipboardText: '@专家团：专题研究专家团\u00A0',
    })

    expect(teamSubmissionText(team, 'zh')).toBe('[专家团：专题研究专家团]\u00A0')
    expect(teamSubmissionText(team, 'en')).toBe('[Expert team: 专题研究专家团]\u00A0')
    expect(teamSubmissionText(team, 'zh')).not.toMatch(/^@/u)
  })

  it('rejects mixing a team with individual expert references', async () => {
    const notify = vi.fn()
    const inserted = await insertTeamReference({
      state: { getSnapshot: () => ({ draft: '\uFFFC review this', draftRev: 3, occurrences: [{ source: 'dsh-plugin-desktop/experts:testing', ref: 'reviewer', offset: 0, length: 1 }] }) },
      insertReference: vi.fn(() => true), notify,
    } as never, team, undefined, undefined, 'zh')
    expect(inserted).toBe(false)
    expect(notify).toHaveBeenCalledWith('error', '草稿已有专家，请先移除专家再选择专家团。')
  })

  it('neutralizes file buttons retained in older conversation history', async () => {
    const old = document.createElement('button')
    old.dataset.refChip = 'file'
    old.title = '@专家团：专题研究专家团'
    document.body.append(old)

    const dispose = installLegacyTeamReferenceGuard()
    expect(old.disabled).toBe(true)
    expect(old.title).toBe('专家团：专题研究专家团')
    expect(old.dataset.aagTeamReference).toBe('legacy')

    const later = old.cloneNode() as HTMLButtonElement
    later.disabled = false
    later.title = '@专家团：软件交付专家团'
    later.removeAttribute('data-aag-team-reference')
    document.body.append(later)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(later.disabled).toBe(true)

    dispose()
    expect(old.disabled).toBe(false)
    expect(old.title).toBe('@专家团：专题研究专家团')
    document.body.replaceChildren()
  })
})
