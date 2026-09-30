/** Wire contract for the local Expert center JSON API. */

export const DESKTOP_EXPERTS_PATH = '/api/desktop/experts'
export const DESKTOP_EXPERTS_ACTION_PATH = '/api/desktop/experts/action'

/** Display block declared by an expert package's expert.yml. */
export interface DesktopExpertDisplay {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly tags: readonly string[]
}

/** Prompt entry points declared by an expert package. */
export interface DesktopExpertEntryPrompts {
  readonly defaultPrompt: string
  readonly quickPrompts: readonly string[]
}

/** One usable expert, projected for the client. */
export interface DesktopExpertEntry {
  readonly id: string
  readonly version: string
  readonly category: string
  readonly display: DesktopExpertDisplay
  readonly entry: DesktopExpertEntryPrompts
  /** Agent Preset the expert summons; always equal to the expert id. */
  readonly presetId: string
  readonly available: boolean
  readonly unavailableReason?: string
}

/** One package that could not be inspected; isolated from usable experts. */
export interface DesktopExpertInvalid {
  /** Directory name as found on disk (may differ from a bad manifest id). */
  readonly id: string
  readonly directory: string
  readonly reason: string
}

/** Full expert catalog view returned by read and filtered list actions. */
export interface DesktopExpertsView {
  readonly experts: readonly DesktopExpertEntry[]
  readonly invalid: readonly DesktopExpertInvalid[]
  readonly categories: readonly string[]
}

/** Result of a successful summon: a new Session bound to the expert's preset. */
export interface DesktopExpertSummonResult {
  readonly sessionId: string
  readonly workspaceId: string
  readonly agentPreset: string
  readonly expertName: string
}
