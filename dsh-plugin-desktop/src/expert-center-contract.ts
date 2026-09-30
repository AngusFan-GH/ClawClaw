/** Stable same-origin JSON routes shared by the Host and browser Client. */
export const DESKTOP_EXPERTS_PATH = '/api/desktop/experts'
export const DESKTOP_EXPERTS_ACTION_PATH = '/api/desktop/experts/action'

/** Maximum bytes for a single expert manifest file. */
export const EXPERT_MANIFEST_MAX_BYTES = 256 * 1024
/** Maximum bytes for the preset composition files. */
export const EXPERT_PRESET_MAX_BYTES = 4 * 1024 * 1024
/** Maximum number of experts returned by one listing. */
export const EXPERT_LIST_LIMIT = 500

export interface ExpertDisplay {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly tags: readonly string[]
}

export interface ExpertEntry {
  readonly defaultPrompt: string
  readonly quickPrompts: readonly string[]
}

/** One locally discovered expert package. */
export interface ExpertView {
  /** Expert id; equals the package directory name and the bound Agent preset id. */
  readonly id: string
  readonly version: string
  readonly category: string
  readonly display: ExpertDisplay
  readonly entry: ExpertEntry
  /** The Agent preset this expert binds to (same id). */
  readonly presetId: string
  /** Whether the bound preset composes without activation failure. */
  readonly available: boolean
  /** Why the expert is unavailable, when `available` is false. */
  readonly unavailableReason?: string
}

/** A discovered package that failed validation; surfaced so the UI can explain it. */
export interface ExpertInvalidView {
  /** Directory name, when it could be read. */
  readonly id: string
  readonly reason: string
}

export interface ExpertsView {
  readonly experts: readonly ExpertView[]
  readonly invalid: readonly ExpertInvalidView[]
  readonly categories: readonly string[]
}

/** Request body for the `summon` action: create a Session bound to the expert preset. */
export interface ExpertSummonRequest {
  readonly action: 'summon'
  readonly expertId: string
  /** Optional workspace to attach the new Session to; Host falls back to its default cwd. */
  readonly workspaceId?: string
}

export interface ExpertSummonResult {
  readonly sessionId: string
  readonly agentPreset: string
}
