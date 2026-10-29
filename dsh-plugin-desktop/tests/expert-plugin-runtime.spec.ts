import { describe, expect, it, vi } from 'vitest'
import type { ExpertSummary } from '../src/experts/expert-contract.ts'
import { executeExpertPluginTeam } from '../src/experts/expert-plugin-runtime.ts'
import type { ExpertPluginTeamDefinition } from '../src/experts/expert-plugin-package.ts'

const expert = (slug: string, role: 'lead' | 'member'): ExpertSummary => ({
  slug, name: slug, nameEn: slug, description: role, descriptionEn: role,
  emoji: '', division: 'engineering', divisionZh: '工程', custom: false,
  skills: [], mcpServers: [], packageFormat: 'clawclaw-plugin', packageVersion: '1.0.0',
  packageType: 'team', packageName: 'delivery-team', packageAgentId: slug, packageRole: role,
})

const team: ExpertPluginTeamDefinition = {
  id: 'plugin-team:delivery-team', packageName: 'delivery-team', packageVersion: '1.0.0',
  name: { en: 'Delivery Team' }, description: { en: 'Ships software' },
  defaultInitPrompt: { en: 'Build this' }, tags: [], quickPrompts: [],
  leadAgentSlug: 'delivery-team--lead', memberAgentSlugs: ['delivery-team--builder', 'delivery-team--tester'],
  skills: [], connectors: [],
}

describe('Expert Plugin Team runtime', () => {
  it('produces source first and passes completed handoffs to sequential pipeline members', async () => {
    const experts = [expert(team.leadAgentSlug, 'lead'), ...team.memberAgentSlugs.map(slug => expert(slug, 'member'))]
    const events: string[] = []
    const result = await executeExpertPluginTeam({
      team: { ...team, execution: 'pipeline' }, experts, enabled: experts.map(item => item.slug), task: 'Create a report', runDirectory: '/runs/current',
      readPersona: async item => item.slug,
      runAgent: async run => {
        events.push(`${run.phase}:${run.expert.slug}`)
        expect(run.prompt).toContain('/runs/current')
        if (run.phase === 'produce') return '/runs/current/final_draft.md'
        if (run.phase === 'member') {
          expect(run.prompt).toContain('/runs/current/final_draft.md')
          if (run.expert.slug.endsWith('tester')) expect(run.prompt).toContain('/runs/current/formatted.html')
          return run.expert.slug.endsWith('builder') ? '/runs/current/formatted.html' : '/runs/current/report.docx'
        }
        return 'done'
      },
    })
    expect(events).toEqual(['plan:delivery-team--lead', 'produce:delivery-team--lead', 'member:delivery-team--builder', 'member:delivery-team--tester', 'synthesize:delivery-team--lead'])
    expect(result.production).toBe('/runs/current/final_draft.md')
  })

  it('does not start a downstream pipeline member after an upstream failure', async () => {
    const experts = [expert(team.leadAgentSlug, 'lead'), ...team.memberAgentSlugs.map(slug => expert(slug, 'member'))]
    const runAgent = vi.fn(async (run: { phase: string; expert: ExpertSummary }) => {
      if (run.phase === 'member') throw new Error('Missing source artifact')
      return 'result'
    })
    const result = await executeExpertPluginTeam({
      team: { ...team, execution: 'pipeline' }, experts, enabled: experts.map(item => item.slug), task: 'Report', readPersona: async () => '', runAgent,
    })
    expect(runAgent.mock.calls.filter(([run]) => run.phase === 'member')).toHaveLength(1)
    expect(result.members[1]).toMatchObject({ ok: false, error: expect.stringContaining('upstream stage failed') })
  })

  it('runs the lead as a distinct identity before and after parallel members', async () => {
    const experts = [expert(team.leadAgentSlug, 'lead'), ...team.memberAgentSlugs.map(slug => expert(slug, 'member'))]
    const events: string[] = []
    const result = await executeExpertPluginTeam({
      team, experts, enabled: experts.map(item => item.slug), task: 'Ship a release',
      readPersona: async item => `persona:${item.slug}`,
      runAgent: async run => {
        if (run.phase === 'plan') {
          expect(run.prompt).toContain('agent identities, not Skill names or paths')
          expect(run.prompt).toContain('planning-only phase with no tools')
          expect(run.prompt).toContain('return it immediately')
        }
        events.push(`${run.phase}:${run.expert.slug}`)
        return `${run.phase} result from ${run.expert.slug}`
      },
    })
    expect(events[0]).toBe('plan:delivery-team--lead')
    expect(events.at(-1)).toBe('synthesize:delivery-team--lead')
    expect(new Set(events.slice(1, -1))).toEqual(new Set([
      'member:delivery-team--builder', 'member:delivery-team--tester',
    ]))
    expect(result.answer).toBe('synthesize result from delivery-team--lead')
    expect(result.members).toHaveLength(2)
  })

  it('passes member failures to the lead instead of replacing the lead', async () => {
    const experts = [expert(team.leadAgentSlug, 'lead'), ...team.memberAgentSlugs.map(slug => expert(slug, 'member'))]
    const runAgent = vi.fn(async (run: { phase: string, expert: ExpertSummary, prompt: string }) => {
      if (run.phase === 'member' && run.expert.slug.endsWith('tester')) throw new Error('test unavailable')
      if (run.phase === 'synthesize') expect(run.prompt).toContain('FAILED: test unavailable')
      return `${run.phase} result`
    })
    const result = await executeExpertPluginTeam({
      team, experts, enabled: experts.map(item => item.slug), task: 'Ship a release',
      readPersona: async item => `persona:${item.slug}`, runAgent,
    })
    expect(result.members).toContainEqual(expect.objectContaining({ slug: 'delivery-team--tester', ok: false, error: 'test unavailable' }))
    expect(runAgent.mock.calls.at(-1)?.[0]).toMatchObject({ phase: 'synthesize', expert: { slug: team.leadAgentSlug } })
  })
})
