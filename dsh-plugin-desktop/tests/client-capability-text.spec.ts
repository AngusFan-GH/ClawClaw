import { describe, expect, it } from 'vitest'
import { capabilitySubmissionMarker } from '../src/experts/capability-submission.ts'
import { capabilityTeamLabelRule, capabilityTextRule } from '../src/experts/client/capability-text.ts'

const rule = capabilityTextRule({
  expert: id => id === 'product-trend-researcher' ? '趋势研究员' : id,
  team: () => '文档制作专家团', skill: () => '文档排版',
})
const context = { read: () => undefined }

describe('capability selections in user messages', () => {
  it('keeps the admitted team label renderable after history reload without execution metadata', () => {
    const text = '【专家团：文档生产专家团】\n创建专业报告'
    expect(capabilityTeamLabelRule.match(text, 0, context)).toMatchObject({
      id: 'clawclaw-team-label', data: { label: '文档生产专家团' }, end: text.indexOf('\n'),
    })
    expect(capabilityTeamLabelRule.match('【Expert team: Document Team】\nCreate a report', 0, context)).toMatchObject({ data: { label: 'Document Team' } })
    expect(capabilityTeamLabelRule.match('【专家：趋势研究员】\n分析报告', 0, context)).toMatchObject({ data: { label: '趋势研究员' } })
    expect(capabilityTeamLabelRule.match('【Skill: doc-typeset】\nTypeset', 0, context)).toMatchObject({ data: { label: 'doc-typeset' } })
  })
  it('replaces the complete encoded team carrier with a readable label in pending and saved text', () => {
    const marker = capabilitySubmissionMarker({ expertIds: [], skillNames: [], teamId: 'plugin-team:migrated-document-production-team' })
    const text = `${marker}\n\n创建一份结构完整的 Agent Harness 调研报告`
    const node = rule.match(text, 0, context)
    expect(node).toEqual({ id: 'text', start: 0, end: marker.length, data: { text: marker, display: '【文档制作专家团】' } })
    expect(rule.match(text, marker.length, context)).toBeUndefined()
    expect(text.slice(node!.end)).toBe('\n\n创建一份结构完整的 Agent Harness 调研报告')
  })

  it('covers expert and skill carriers without consuming adjacent text or file references', () => {
    const marker = capabilitySubmissionMarker({ expertIds: ['product-trend-researcher'], skillNames: ['doc-typeset'] })
    const text = `Review ${marker} @report.md`
    expect(rule.match(text, 0, context)).toMatchObject({ start: 7, end: 7 + marker.length, data: { display: '【趋势研究员】 【文档排版】' } })
    expect(rule.match('Ordinary message @report.md', 0, context)).toBeUndefined()
  })

  it('does not leak malformed transport code or throw during message rendering', () => {
    expect(rule.match('<!--clawclaw-capabilities:%00-->', 0, context)).toMatchObject({ data: { display: '' } })
  })
})
