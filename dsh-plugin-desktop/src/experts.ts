/** Desktop expert center: local expert packages over the Agent preset registry. */

import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { entryListProblem } from '@deepseek-ai/dsh-agent-preset-registry'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { parseDocument } from 'yaml'
import { registerDesktopJsonApi } from './desktop-json-api.ts'
import {
  DESKTOP_EXPERTS_ACTION_PATH, DESKTOP_EXPERTS_PATH, EXPERT_COMPOSITION_FILE, EXPERT_DESCRIPTION_LIMIT,
  EXPERT_ID_PATTERN, EXPERT_MANIFEST_FILE, EXPERT_MANIFEST_MAX_BYTES, EXPERT_NAME_LIMIT, EXPERT_PACKAGE_LIMIT,
  EXPERT_PRESET_FILE, EXPERT_PRESET_FILE_MAX_BYTES, EXPERT_PROMPT_LIMIT, EXPERT_QUICK_PROMPT_LIMIT,
  EXPERT_TAG_LIMIT, EXPERT_TAG_TEXT_LIMIT, EXPERT_TEXT_LIMIT, EXPERT_TITLE_LIMIT, EXPERTS_DIRECTORY_NAME,
  expertCategories, filterExperts,
  type ExpertDisplay, type ExpertEntry, type ExpertProblem, type ExpertQuery,
  type ExpertStatus, type ExpertSummonValue, type ExpertView, type ExpertsView,
} from './experts-contract.ts'

export * from './experts-contract.ts'

export const name = 'desktop-experts'
export const inject = ['webServer', 'connection']

/** One registered Agent preset as the registry reports it. */
export interface ExpertPresetRow {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly broken?: string
}

/** Read-only face of `ctx.agentPresets` this plugin needs. */
export interface ExpertPresetRoster {
  list(): Promise<readonly ExpertPresetRow[]>
}

/** Host Session creation face this plugin needs; `agentPreset` is validated by the creator. */
export interface ExpertSessionCreator {
  create(input: {
    readonly agentPreset?: string
    readonly workspaceId?: string
    readonly cwd?: string
  }): Promise<{ readonly sessionId: string }>
}

/** Refusal raised before any Session exists, so a failed summon never lands a mis-bound Session. */
export class ExpertSummonError extends Error {
  constructor(readonly problem: ExpertProblem | 'session-controller-unavailable' | 'expert-not-found',
    message: string) {
    super(message)
    this.name = 'ExpertSummonError'
  }
}

export interface ExpertCatalogOptions {
  /** Expert package root; defaults to `DSH_HOME/.agent-presets`. */
  readonly root?: string
  /** Current preset roster, or undefined when the deployment composes no registry. */
  readonly roster: () => ExpertPresetRoster | undefined
  /** Create the Session that runs `presetId`; absent in read-only compositions. */
  readonly createSession?: (
    presetId: string,
    workspaceId: string | undefined,
  ) => Promise<{ readonly sessionId: string }>
  /** Package scan ceiling; defaults to {@link EXPERT_PACKAGE_LIMIT}. */
  readonly packageLimit?: number
}

export interface ExpertSummonOptions {
  readonly prompt?: string
  readonly workspaceId?: string
}

interface ExpertManifest {
  readonly id: string
  readonly version: string
  readonly category: string
  readonly display: ExpertDisplay
  readonly entry: ExpertEntry
}

const DISPLAY_TEXT = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/u
const PROMPT_TEXT = /^[^\u0000-\u0008\u000B\u000C\u000E\u001F\u007F]*$/u
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/u
const CATEGORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u

/** Raised while reading one package; `problem` is what the UI renders. */
class ExpertPackageError extends Error {
  constructor(readonly problem: ExpertProblem, message: string) {
    super(message)
    this.name = 'ExpertPackageError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function displayText(value: unknown, field: string, limit: number): string {
  if (typeof value !== 'string') throw new ExpertPackageError('invalid-manifest', `${field} must be text`)
  const text = value.trim()
  if (text === '') throw new ExpertPackageError('invalid-manifest', `${field} must not be empty`)
  if (text.length > limit) throw new ExpertPackageError('invalid-manifest', `${field} exceeds ${String(limit)} characters`)
  if (!DISPLAY_TEXT.test(text)) throw new ExpertPackageError('invalid-manifest', `${field} contains control characters`)
  return text
}

function optionalDisplayText(value: unknown, field: string, limit: number): string | undefined {
  if (value === undefined) return undefined
  return displayText(value, field, limit)
}

/** Validate a prompt field; newlines are allowed, other control characters are not. */
function promptText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new ExpertPackageError('invalid-manifest', `${field} must be text`)
  const text = value.trim()
  if (text === '') throw new ExpertPackageError('invalid-manifest', `${field} must not be empty`)
  if (text.length > EXPERT_PROMPT_LIMIT) {
    throw new ExpertPackageError('invalid-manifest', `${field} exceeds ${String(EXPERT_PROMPT_LIMIT)} characters`)
  }
  if (!PROMPT_TEXT.test(text)) throw new ExpertPackageError('invalid-manifest', `${field} contains control characters`)
  return text
}

/**
 * Parse and validate one `expert.yml` manifest.
 * @param text - manifest source.
 * @param at - diagnostic prefix, normally the manifest path.
 * @returns the validated manifest.
 * @throws {ExpertPackageError} with `invalid-yaml` or `invalid-manifest`.
 */
export function parseExpertManifest(text: string, at = EXPERT_MANIFEST_FILE): ExpertManifest {
  const document = parseDocument(text, { prettyErrors: true })
  if (document.errors.length > 0) {
    throw new ExpertPackageError('invalid-yaml', `${at}: ${document.errors.map(error => error.message).join('; ')}`)
  }
  const value: unknown = document.toJS()
  if (!isRecord(value)) throw new ExpertPackageError('invalid-manifest', `${at}: manifest must be a map`)
  const id = displayText(value.id, `${at}: id`, EXPERT_NAME_LIMIT)
  if (!EXPERT_ID_PATTERN.test(id)) {
    throw new ExpertPackageError('invalid-manifest', `${at}: id "${id}" is not a usable expert id`)
  }
  const version = displayText(value.version, `${at}: version`, 64)
  if (!VERSION_PATTERN.test(version)) {
    throw new ExpertPackageError('invalid-manifest', `${at}: version "${version}" is not a usable version`)
  }
  const category = displayText(value.category, `${at}: category`, 64)
  if (!CATEGORY_PATTERN.test(category)) {
    throw new ExpertPackageError('invalid-manifest', `${at}: category "${category}" is not a usable category`)
  }
  const display = value.display
  if (!isRecord(display)) throw new ExpertPackageError('invalid-manifest', `${at}: display must be a map`)
  const displayName = displayText(display.name, `${at}: display.name`, EXPERT_NAME_LIMIT)
  const title = optionalDisplayText(display.title, `${at}: display.title`, EXPERT_TITLE_LIMIT)
  const description = optionalDisplayText(display.description, `${at}: display.description`, EXPERT_DESCRIPTION_LIMIT)
  const tags: string[] = []
  if (display.tags !== undefined) {
    if (!Array.isArray(display.tags)) throw new ExpertPackageError('invalid-manifest', `${at}: display.tags must be a list`)
    if (display.tags.length > EXPERT_TAG_LIMIT) {
      throw new ExpertPackageError('invalid-manifest', `${at}: display.tags exceeds ${String(EXPERT_TAG_LIMIT)} entries`)
    }
    for (const [index, tag] of display.tags.entries()) {
      const text = displayText(tag, `${at}: display.tags[${String(index)}]`, EXPERT_TAG_TEXT_LIMIT)
      if (!tags.includes(text)) tags.push(text)
    }
  }
  const entry = value.entry
  if (entry !== undefined && !isRecord(entry)) {
    throw new ExpertPackageError('invalid-manifest', `${at}: entry must be a map`)
  }
  const entryRecord = isRecord(entry) ? entry : {}
  const defaultPrompt = entryRecord.defaultPrompt === undefined
    ? undefined
    : promptText(entryRecord.defaultPrompt, `${at}: entry.defaultPrompt`)
  const quickPrompts: string[] = []
  if (entryRecord.quickPrompts !== undefined) {
    if (!Array.isArray(entryRecord.quickPrompts)) {
      throw new ExpertPackageError('invalid-manifest', `${at}: entry.quickPrompts must be a list`)
    }
    if (entryRecord.quickPrompts.length > EXPERT_QUICK_PROMPT_LIMIT) {
      throw new ExpertPackageError('invalid-manifest', `${at}: entry.quickPrompts exceeds ${String(EXPERT_QUICK_PROMPT_LIMIT)} entries`)
    }
    for (const [index, prompt] of entryRecord.quickPrompts.entries()) {
      quickPrompts.push(promptText(prompt, `${at}: entry.quickPrompts[${String(index)}]`))
    }
  }
  return Object.freeze({
    id, version, category,
    display: Object.freeze({
      name: displayName,
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
      tags: Object.freeze(tags),
    }),
    entry: Object.freeze({
      ...(defaultPrompt === undefined ? {} : { defaultPrompt }),
      quickPrompts: Object.freeze(quickPrompts),
    }),
  })
}

/** Read one package file, refusing links, non-regular files, and oversized content. */
async function packageFile(path: string, limit: number): Promise<string> {
  let info
  try {
    info = await lstat(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ExpertPackageError('missing-files', `${path} is missing`)
    }
    throw new ExpertPackageError('unreadable', `${path} cannot be read: ${String(cause)}`)
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new ExpertPackageError('unsafe-path', `${path} must be a regular file inside the package`)
  }
  if (info.size > limit) {
    throw new ExpertPackageError('too-large', `${path} exceeds ${String(limit)} bytes`)
  }
  return await readFile(path, 'utf8')
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path !== '' && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
}

/**
 * Read-only expert package catalog over one directory.
 *
 * Every package is validated in isolation: one broken or hostile package
 * becomes one non-available entry with a reason, never a failed scan. No
 * credential material is read, and no file outside the package is opened.
 */
export class ExpertCatalog {
  private readonly root: string | undefined

  constructor(private readonly options: ExpertCatalogOptions) {
    this.root = options.root
  }

  /** Directory expert packages are discovered in. */
  rootPath(): string {
    return resolve(this.root ?? join(resolveDshHome(), EXPERTS_DIRECTORY_NAME))
  }

  /**
   * Scan, validate, and (optionally) filter every expert package.
   * @param query - shared keyword and category filter.
   * @returns the filtered roster with the catalog-wide category totals.
   */
  async read(query: ExpertQuery = {}): Promise<ExpertsView> {
    const root = this.rootPath()
    const { experts, truncated } = await this.scan(root)
    return Object.freeze({
      root,
      experts: Object.freeze(filterExperts(experts, query)),
      categories: expertCategories(experts),
      truncated,
    })
  }

  /**
   * Read one expert package.
   * @param id - expert id.
   * @returns the expert entry.
   * @throws {ExpertSummonError} when no package claims the id.
   */
  async detail(id: string): Promise<ExpertView> {
    const root = this.rootPath()
    const { experts } = await this.scan(root)
    const found = experts.find(expert => expert.id === id)
    if (found === undefined) throw new ExpertSummonError('expert-not-found', `Unknown expert: ${id}`)
    return found
  }

  /**
   * Create a new Session bound to the expert's Agent preset.
   *
   * Nothing but Session creation happens here: the Agent preset is validated
   * by the Session creator, so a refused summon leaves no Session behind.
   * @param id - expert id.
   * @param options - first-input prompt and target Workspace.
   * @returns the created Session identity and the prompt the Client prefills.
   * @throws {ExpertSummonError} when the expert is unknown or not available.
   */
  async summon(id: string, options: ExpertSummonOptions = {}): Promise<ExpertSummonValue> {
    const expert = await this.detail(id)
    if (expert.status !== 'available') {
      throw new ExpertSummonError(expert.problem ?? 'preset-missing',
        expert.message ?? `Expert "${id}" is not available`)
    }
    const requested = options.prompt?.trim()
    const prompt = requested === undefined || requested === ''
      ? expert.entry?.defaultPrompt
      : requested
    const sessionId = await this.createSession(expert.presetId, options.workspaceId)
    return Object.freeze({
      sessionId,
      expertId: expert.id,
      presetId: expert.presetId,
      ...(prompt === undefined ? {} : { prompt }),
    })
  }

  /** Create the Session through the Host Session controller. */
  private async createSession(presetId: string, workspaceId: string | undefined): Promise<string> {
    const creator = this.options.createSession?.(presetId, workspaceId)
    if (creator === undefined) {
      throw new ExpertSummonError('session-controller-unavailable', 'The Session controller is unavailable')
    }
    try {
      const created = await creator
      return created.sessionId
    } catch (cause) {
      if (cause instanceof ExpertSummonError) throw cause
      throw new ExpertSummonError('preset-missing', cause instanceof Error ? cause.message : String(cause))
    }
  }

  private async scan(root: string): Promise<{ experts: ExpertView[], truncated: boolean }> {
    const experts: ExpertView[] = []
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { experts, truncated: false }
      throw cause
    }
    let realRoot: string
    try {
      realRoot = await realpath(root)
    } catch {
      realRoot = root
    }
    const claimed = new Set<string>()
    const limit = this.options.packageLimit ?? EXPERT_PACKAGE_LIMIT
    let truncated = false
    const directories = entries
      .filter(entry => !entry.isSymbolicLink())
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of directories) {
      if (experts.length >= limit) {
        truncated = true
        break
      }
      if (!entry.isDirectory()) continue
      const directory = join(root, entry.name)
      if (!EXPERT_ID_PATTERN.test(entry.name)) {
        if (await this.holdsManifest(directory)) {
          experts.push(this.invalid(entry.name, directory, 'unsafe-path',
            `Package directory "${entry.name}" is not a usable expert id`))
        }
        continue
      }
      let real: string
      try {
        real = await realpath(directory)
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') continue
        experts.push(this.invalid(entry.name, directory, 'unreadable', String(cause)))
        continue
      }
      if (!isInside(realRoot, real)) {
        experts.push(this.invalid(entry.name, directory, 'unsafe-path',
          `${directory} resolves outside ${realRoot}`))
        continue
      }
      if (!(await this.holdsManifest(directory))) continue
      const key = entry.name.toLocaleLowerCase()
      if (claimed.has(key)) {
        experts.push(this.invalid(entry.name, directory, 'duplicate-id',
          `Expert id "${entry.name}" is already provided by another package`))
        continue
      }
      claimed.add(key)
      experts.push(await this.readPackage(entry.name, directory))
    }
    return { experts, truncated }
  }

  /**
   * Whether a directory carries an `expert.yml` at all, which is what makes it
   * an expert package rather than a plain Agent preset.
   *
   * Presence alone decides membership: a manifest that is a symlink, a
   * directory, or oversized still marks the package as intended for this
   * catalog, so the reader reports that reason instead of hiding the package.
   */
  private async holdsManifest(directory: string): Promise<boolean> {
    try {
      await lstat(join(directory, EXPERT_MANIFEST_FILE))
      return true
    } catch {
      return false
    }
  }

  /** Validate one package in isolation; any failure becomes one reported entry. */
  private async readPackage(id: string, directory: string): Promise<ExpertView> {
    try {
      const manifestText = await packageFile(join(directory, EXPERT_MANIFEST_FILE), EXPERT_MANIFEST_MAX_BYTES)
      const presetText = await packageFile(join(directory, EXPERT_PRESET_FILE), EXPERT_PRESET_FILE_MAX_BYTES)
      const compositionText = await packageFile(join(directory, EXPERT_COMPOSITION_FILE), EXPERT_PRESET_FILE_MAX_BYTES)
      const manifest = parseExpertManifest(manifestText, join(directory, EXPERT_MANIFEST_FILE))
      if (manifest.id !== id) {
        throw new ExpertPackageError('id-mismatch', `Manifest id "${manifest.id}" does not match directory "${id}"`)
      }
      const preset = this.presetMetadata(presetText, join(directory, EXPERT_PRESET_FILE))
      const composition = parseDocument(compositionText, { prettyErrors: true })
      const problem = composition.errors.length > 0
        ? composition.errors.map(error => error.message).join('; ')
        : entryListProblem(composition.toJS())
      const availability = await this.availability(id, problem)
      return Object.freeze({
        id,
        presetId: id,
        ...preset,
        version: manifest.version,
        category: manifest.category,
        display: manifest.display,
        entry: manifest.entry,
        directory,
        ...availability,
      })
    } catch (cause) {
      if (cause instanceof ExpertPackageError) {
        return this.invalid(id, directory, cause.problem, cause.message)
      }
      return this.invalid(id, directory, 'unreadable', cause instanceof Error ? cause.message : String(cause))
    }
  }

  /** Preset display metadata; unreadable optional fields degrade instead of failing the package. */
  private presetMetadata(text: string, at: string): { presetName?: string, presetDescription?: string } {
    const document = parseDocument(text, { prettyErrors: true })
    if (document.errors.length > 0) {
      throw new ExpertPackageError('invalid-yaml', `${at}: ${document.errors.map(error => error.message).join('; ')}`)
    }
    const value: unknown = document.toJS()
    if (!isRecord(value)) throw new ExpertPackageError('invalid-yaml', `${at}: preset metadata must be a map`)
    const presetName = typeof value.name === 'string' && value.name.trim() !== '' ? value.name.trim() : undefined
    const presetDescription = typeof value.description === 'string' && value.description.trim() !== ''
      ? value.description.trim()
      : undefined
    return {
      ...(presetName === undefined ? {} : { presetName }),
      ...(presetDescription === undefined ? {} : { presetDescription }),
    }
  }

  /** Resolve whether the registered Agent preset can compose a Session right now. */
  private async availability(id: string, compositionProblem: string | undefined): Promise<{
    status: ExpertStatus
    problem?: ExpertProblem
    message?: string
  }> {
    const roster = this.options.roster()
    if (roster === undefined) {
      return {
        status: 'unavailable',
        problem: 'preset-registry-unavailable',
        message: 'This deployment composes no Agent preset registry',
      }
    }
    let rows: readonly ExpertPresetRow[]
    try {
      rows = await roster.list()
    } catch (cause) {
      return {
        status: 'unavailable',
        problem: 'preset-registry-unavailable',
        message: cause instanceof Error ? cause.message : String(cause),
      }
    }
    const preset = rows.find(row => row.id === id)
    if (preset === undefined) {
      return compositionProblem === undefined
        ? {
            status: 'unavailable',
            problem: 'preset-missing',
            message: `Agent preset "${id}" is not registered; its id may already be taken by an official preset`,
          }
        : { status: 'unavailable', problem: 'preset-invalid', message: compositionProblem }
    }
    if (preset.broken !== undefined) {
      return { status: 'unavailable', problem: 'preset-broken', message: preset.broken }
    }
    return { status: 'available' }
  }

  private invalid(id: string, directory: string, problem: ExpertProblem, message: string): ExpertView {
    return Object.freeze({ id, presetId: id, status: 'invalid' as ExpertStatus, problem, message, directory })
  }
}

/** Shape check for one summon request body. */
function summonRequest(value: Record<string, unknown>): { id: string, prompt?: string, workspaceId?: string } {
  if (typeof value.id !== 'string' || !EXPERT_ID_PATTERN.test(value.id)) throw new TypeError('Invalid expert id')
  const prompt = value.prompt
  if (prompt !== undefined && (typeof prompt !== 'string' || prompt.length > EXPERT_PROMPT_LIMIT)) {
    throw new TypeError('Invalid expert prompt')
  }
  const workspaceId = value.workspaceId
  if (workspaceId !== undefined && (typeof workspaceId !== 'string' || workspaceId === ''
    || workspaceId.length > 512 || workspaceId.includes('\0'))) throw new TypeError('Invalid workspaceId')
  return {
    id: value.id,
    ...(typeof prompt === 'string' ? { prompt } : {}),
    ...(typeof workspaceId === 'string' ? { workspaceId } : {}),
  }
}

/** Route one expert action body to the catalog. */
export async function handleExpertAction(catalog: ExpertCatalog, value: unknown): Promise<object> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Experts action')
  const action = (value as Record<string, unknown>).action
  if (action === 'list') {
    const record = value as Record<string, unknown>
    const q = record.q
    const category = record.category
    if (q !== undefined && (typeof q !== 'string' || q.length > EXPERT_TEXT_LIMIT)) throw new TypeError('Invalid search query')
    if (category !== undefined && (typeof category !== 'string' || category.length > 128)) {
      throw new TypeError('Invalid expert category')
    }
    return await catalog.read({
      ...(typeof q === 'string' ? { q } : {}),
      ...(typeof category === 'string' ? { category } : {}),
    })
  }
  if (action === 'detail') {
    const record = value as Record<string, unknown>
    if (typeof record.id !== 'string' || !EXPERT_ID_PATTERN.test(record.id)) throw new TypeError('Invalid expert id')
    return await catalog.detail(record.id)
  }
  if (action === 'summon') {
    const request = summonRequest(value as Record<string, unknown>)
    return await catalog.summon(request.id, {
      ...(request.prompt === undefined ? {} : { prompt: request.prompt }),
      ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
    })
  }
  throw new TypeError('Invalid Experts action')
}

/** Register the expert center routes; the Session controller owns preset resolution. */
export function apply(ctx: Context): void {
  const catalog = new ExpertCatalog({
    roster: () => ctx.get('agentPresets') as ExpertPresetRoster | undefined,
    createSession: async (presetId, workspaceId) => {
      const sessions = ctx.get('sessionController')
      if (sessions === undefined) {
        throw new ExpertSummonError('session-controller-unavailable', 'The Session controller is unavailable')
      }
      const created = await sessions.create({
        agentPreset: presetId,
        ...(workspaceId === undefined ? {} : { workspaceId: workspaceId as WorkspaceId }),
      })
      return { sessionId: String(created.sessionId) }
    },
  })
  registerDesktopJsonApi(ctx, {
    label: 'Experts',
    readPath: DESKTOP_EXPERTS_PATH,
    actionPath: DESKTOP_EXPERTS_ACTION_PATH,
    read: () => catalog.read(),
    action: value => handleExpertAction(catalog, value),
  })
}
