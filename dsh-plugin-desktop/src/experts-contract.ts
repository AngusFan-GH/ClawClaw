/**
 * Expert-package contract shared by the Host discovery service and the browser
 * Client. An expert package is a local Agent preset directory that adds an
 * `expert.yml` manifest describing who the preset is for.
 *
 * Nothing in this module touches the filesystem: the Host owns discovery
 * (`experts.ts`), while the Client imports the pure view types and the filter
 * that both surfaces apply, so browsing and filtering cannot drift apart.
 */

/** Install root of expert packages, relative to `DSH_HOME`. */
export const EXPERTS_DIRECTORY_NAME = '.agent-presets'
export const DESKTOP_EXPERTS_PATH = '/api/desktop/experts'
export const DESKTOP_EXPERTS_ACTION_PATH = '/api/desktop/experts/action'

/** Required members of an expert package; a package without `expert.yml` stays a plain Agent preset. */
export const EXPERT_REQUIRED_FILES = ['preset.yml', 'agent.cordis.yml', 'expert.yml'] as const
export const EXPERT_MANIFEST_FILE = 'expert.yml'
export const EXPERT_PRESET_FILE = 'preset.yml'
export const EXPERT_COMPOSITION_FILE = 'agent.cordis.yml'
export const EXPERT_MANIFEST_MAX_BYTES = 64 * 1024
/** Same ceiling the read-only legacy preset registrar applies to preset files. */
export const EXPERT_PRESET_FILE_MAX_BYTES = 4 * 1024 * 1024
export const EXPERT_PACKAGE_LIMIT = 512
export const EXPERT_TAG_LIMIT = 24
export const EXPERT_QUICK_PROMPT_LIMIT = 12
export const EXPERT_TEXT_LIMIT = 4_096
/** Display-copy ceilings; a manifest that exceeds one is invalid, never truncated. */
export const EXPERT_NAME_LIMIT = 96
export const EXPERT_TITLE_LIMIT = 128
export const EXPERT_DESCRIPTION_LIMIT = 512
export const EXPERT_PROMPT_LIMIT = 8_192
export const EXPERT_TAG_TEXT_LIMIT = 64

/** Expert id == package directory name == Agent preset id. */
export const EXPERT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u

/** How usable one expert package is right now. */
export type ExpertStatus = 'available' | 'unavailable' | 'invalid'

/** Machine-readable cause behind a non-available expert. */
export type ExpertProblem =
  /** A required package file is absent or not a regular file. */
  | 'missing-files'
  /** The directory currently holds the package. */
  | 'unreadable'
  /** The directory name or a package member is not a safe package member. */
  | 'unsafe-path'
  /** `expert.yml` is not parseable YAML. */
  | 'invalid-yaml'
  /** `expert.yml` parses but omits or mistypes a required field. */
  | 'invalid-manifest'
  /** `expert.yml` id does not match its directory name. */
  | 'id-mismatch'
  /** Another package already claimed this id. */
  | 'duplicate-id'
  /** A package file exceeds its size ceiling. */
  | 'too-large'
  /** No registered Agent preset carries this id. */
  | 'preset-missing'
  /** The declared preset exists but its composition failed to activate. */
  | 'preset-broken'
  /** The declared preset composition is not a valid Cordis entry list. */
  | 'preset-invalid'
  /** The Agent preset registry is not part of this deployment. */
  | 'preset-registry-unavailable'

export interface ExpertDisplay {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly tags: readonly string[]
}

export interface ExpertEntry {
  readonly defaultPrompt?: string
  readonly quickPrompts: readonly string[]
}

/** One expert package as the Client reads it; every field is display-safe. */
export interface ExpertView {
  /** Expert id, also the linked Agent preset id. */
  readonly id: string
  readonly status: ExpertStatus
  /** Why the expert is not available; absent exactly when {@link status} is `available`. */
  readonly problem?: ExpertProblem
  /** Human-readable detail for the problem, already localized by the Client. */
  readonly message?: string
  /** Agent preset this expert summons; equal to {@link id} for a readable package. */
  readonly presetId: string
  readonly presetName?: string
  readonly presetDescription?: string
  readonly version?: string
  readonly category?: string
  readonly display?: ExpertDisplay
  readonly entry?: ExpertEntry
  /** Absolute package directory; exposed so a failed package is actionable. */
  readonly directory: string
}

export interface ExpertCategory {
  readonly id: string
  readonly count: number
}

export interface ExpertsView {
  /** Directory expert packages are discovered in. */
  readonly root: string
  readonly experts: readonly ExpertView[]
  readonly categories: readonly ExpertCategory[]
  /** True when discovery stopped at the package ceiling. */
  readonly truncated: boolean
}

export interface ExpertSummonValue {
  readonly sessionId: string
  readonly expertId: string
  readonly presetId: string
  /** First-input text the Client prefills into the new session. */
  readonly prompt?: string
}

export interface ExpertQuery {
  readonly q?: string
  readonly category?: string
}

/** Match one expert against a free-text query and a category filter. */
export function expertMatches(expert: ExpertView, query: ExpertQuery): boolean {
  const category = query.category?.trim() ?? ''
  if (category !== '' && expert.category !== category) return false
  const needle = query.q?.trim().toLocaleLowerCase() ?? ''
  if (needle === '') return true
  return searchableExpertText(expert).includes(needle)
}

/** Fields a keyword search consults, lower-cased and newline separated. */
export function searchableExpertText(expert: ExpertView): string {
  return [
    expert.id,
    expert.presetId,
    expert.presetName ?? '',
    expert.version ?? '',
    expert.category ?? '',
    expert.display?.name ?? '',
    expert.display?.title ?? '',
    expert.display?.description ?? '',
    ...expert.display?.tags ?? [],
    ...expert.entry?.quickPrompts ?? [],
    expert.entry?.defaultPrompt ?? '',
  ].join('\n').toLocaleLowerCase()
}

/** Apply the shared query to a full expert view. */
export function filterExperts(experts: readonly ExpertView[], query: ExpertQuery): readonly ExpertView[] {
  return experts.filter(expert => expertMatches(expert, query))
}

/** Kind totals per category, ordered by id, computed over the unfiltered roster. */
export function expertCategories(experts: readonly ExpertView[]): readonly ExpertCategory[] {
  const counts = new Map<string, number>()
  for (const expert of experts) {
    if (expert.category === undefined) continue
    counts.set(expert.category, (counts.get(expert.category) ?? 0) + 1)
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([id, count]) => Object.freeze({ id, count }))
}
