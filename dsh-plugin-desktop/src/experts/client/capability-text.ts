import type { UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { parseCapabilitySubmission } from '../capability-submission.js'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    'clawclaw-team-label': { readonly label: string }
  }
}

/** This readable label is durable presentation data, never an execution carrier. */
export const capabilityTeamLabelRule: UserTextRule<'clawclaw-team-label'> = {
  id: 'clawclaw-team-label', order: 0,
  match(text, from) {
    const pattern = /【(?:专家团：|专家：|技能：|Expert team: |Expert: |Skill: )([^】\r\n]+)】/gu
    pattern.lastIndex = from
    const match = pattern.exec(text)
    return match === null ? undefined : {
      id: 'clawclaw-team-label', start: match.index, end: match.index + match[0].length, data: { label: match[1]! },
    }
  },
}

/** Cover the complete wire marker before reference rules can interpret its contents. */
export function capabilityTextRule(labels: {
  expert(id: string): string
  team(id: string): string
  skill(name: string): string
}): UserTextRule<'clawclaw-capabilities'> {
  return {
    id: 'clawclaw-capabilities', order: 0,
    match(text, from) {
      const pattern = /<!--clawclaw-capabilities:[A-Za-z0-9%._~-]+-->/gu
      pattern.lastIndex = from
      const match = pattern.exec(text)
      if (match === null) return undefined
      let display = ''
      try {
        const { selection } = parseCapabilitySubmission(match[0])
        display = [
          ...selection.expertIds.map(labels.expert),
          ...(selection.teamId === undefined ? [] : [labels.team(selection.teamId)]),
          ...selection.skillNames.map(labels.skill),
        ].map(label => `【${label}】`).join(' ')
      } catch {
        // Malformed transport data is rejected by the Host, never displayed as code.
      }
      return { id: 'text', start: match.index, end: match.index + match[0].length, data: { text: match[0], display } }
    },
  }
}
