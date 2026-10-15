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
  it('runs the lead as a distinct identity before and after parallel members', async () => {
    const experts = [expert(team.leadAgentSlug, 'lead'), ...team.memberAgentSlugs.map(slug => expert(slug, 'member'))]
    const events: string[] = []
    const result = await executeExpertPluginTeam({
      team, experts, enabled: experts.map(item => item.slug), task: 'Ship a release',
      readPersona: async item => `persona:${item.slug}`,
      runAgent: async run => {
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
