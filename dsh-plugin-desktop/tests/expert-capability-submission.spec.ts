import { describe, expect, it } from 'vitest'
import { capabilitySubmissionMarker, parseCapabilitySubmission } from '../src/experts/capability-submission.ts'

describe('structured expert capability submission', () => {
  it('round-trips ids while removing the carrier from model-facing text', () => {
    const marker = capabilitySubmissionMarker({ expertIds: ['reviewer'], skillNames: ['code-review'] })
    expect(parseCapabilitySubmission(`${marker} Review this change.`)).toEqual({
      text: 'Review this change.',
      selection: { expertIds: ['reviewer'], skillNames: ['code-review'] },
    })
  })

  it('merges repeated selections and rejects expert/team mixing', () => {
    const one = capabilitySubmissionMarker({ expertIds: ['reviewer'], skillNames: [] })
    const two = capabilitySubmissionMarker({ expertIds: ['writer'], skillNames: ['docs'] })
    expect(parseCapabilitySubmission(`${one}${two} Ship it.`).selection).toEqual({ expertIds: ['reviewer', 'writer'], skillNames: ['docs'] })
    const team = capabilitySubmissionMarker({ expertIds: [], teamId: 'team-review', skillNames: [] })
    expect(() => parseCapabilitySubmission(`${one}${team} Invalid.`)).toThrow(/cannot be combined/i)
  })

  it('rejects excess or invalid selections instead of silently dropping them', () => {
    expect(() => capabilitySubmissionMarker({ expertIds: Array.from({ length: 9 }, (_, i) => `expert-${i}`), skillNames: [] })).toThrow(/up to 8/u)
    expect(() => capabilitySubmissionMarker({ expertIds: ['../expert'], skillNames: [] })).toThrow(/Invalid/u)
    const one = capabilitySubmissionMarker({ expertIds: Array.from({ length: 8 }, (_, i) => `expert-${i}`), skillNames: [] })
    const two = capabilitySubmissionMarker({ expertIds: ['expert-extra'], skillNames: [] })
    expect(() => parseCapabilitySubmission(`${one}${two} Task`)).toThrow(/up to 8/u)
  })
})
