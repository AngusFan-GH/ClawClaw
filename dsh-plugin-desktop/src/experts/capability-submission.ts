const MARKER = /<!--clawclaw-capabilities:([A-Za-z0-9%._~-]+)-->/gu
const ID = /^[a-z0-9][a-z0-9:_-]{0,127}$/u

export interface CapabilitySelection {
  readonly expertIds: readonly string[]
  readonly skillNames: readonly string[]
  readonly teamId?: string
}

function normalized(value: CapabilitySelection): CapabilitySelection {
  if (!Array.isArray(value.expertIds) || !Array.isArray(value.skillNames)
    || [...value.expertIds, ...value.skillNames].some(id => typeof id !== 'string' || !ID.test(id))
    || (value.teamId !== undefined && (typeof value.teamId !== 'string' || !ID.test(value.teamId)))) {
    throw new Error('Invalid ClawClaw capability selection.')
  }
  const expertIds = [...new Set(value.expertIds)]
  const skillNames = [...new Set(value.skillNames)]
  const teamId = value.teamId
  if (expertIds.length > 8 || skillNames.length > 16) throw new Error('A task supports up to 8 experts and 16 Skills.')
  if (teamId !== undefined && expertIds.length > 0) throw new Error('A team cannot be combined with individual experts.')
  return { expertIds, skillNames, ...(teamId === undefined ? {} : { teamId }) }
}

/** Durable, transcript-hidden carrier parsed by the Desktop Host before model execution. */
export function capabilitySubmissionMarker(value: CapabilitySelection): string {
  return `<!--clawclaw-capabilities:${encodeURIComponent(JSON.stringify(normalized(value)))}-->`
}

export function parseCapabilitySubmission(text: string): { text: string; selection: CapabilitySelection } {
  const expertIds: string[] = []
  const skillNames: string[] = []
  let teamId: string | undefined
  const clean = text.replace(MARKER, (_match, encoded: string) => {
    let parsed: CapabilitySelection
    try {
      parsed = normalized(JSON.parse(decodeURIComponent(encoded)) as CapabilitySelection)
    } catch {
      throw new Error('Invalid ClawClaw capability selection.')
    }
    if (teamId !== undefined && parsed.teamId !== undefined && teamId !== parsed.teamId) throw new Error('Only one expert team can be selected.')
    if (parsed.teamId !== undefined) teamId = parsed.teamId
    expertIds.push(...parsed.expertIds)
    skillNames.push(...parsed.skillNames)
    return ''
  })
  const selection = normalized({ expertIds, skillNames, ...(teamId === undefined ? {} : { teamId }) })
  return { text: clean.replace(/[ \t]+\n/gu, '\n').trim(), selection }
}
