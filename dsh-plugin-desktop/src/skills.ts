/** Desktop-owned Skills inventory and model-visibility management. */

import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, stat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import type { SkillDefinition, SkillSummary, SkillViewOptions } from '@deepseek-ai/dsh-skill'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { parseDocument } from 'yaml'
import { registerDesktopJsonApi } from './desktop-json-api.ts'
import { decodeSkillBundle, listSkillFiles, previewSkillFile } from './skill-bundle.ts'
import {
  DESKTOP_SKILLS_ACTION_PATH, DESKTOP_SKILLS_PATH, MAX_SKILL_BUNDLE_BYTES,
  type DesktopRecycledSkill, type DesktopSkillDetail, type DesktopSkillInput, type DesktopSkillsView, type DesktopSkillView, type DesktopSkillsScope, type DesktopSkillInstallation,
} from './skills-contract.ts'

export * from './skills-contract.ts'
export const name = 'desktop-skills'
export const inject = ['skills', 'webServer', 'connection']

const MAX_SKILL_CONTENT_BYTES = 256 * 1024
const revisionOf = (path: string, text: string): string => createHash('sha256').update(path).update('\0').update(text).digest('hex')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function projectSkill(skill: SkillSummary): DesktopSkillView {
  return Object.freeze({ name: skill.name, description: skill.description,
    ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
    source: skill.source, provider: skill.provider,
    modelInvocable: skill.invocation.modelInvocable, userInvocable: skill.invocation.userInvocable,
    editable: (skill.source === 'user-dsh' || skill.source === 'user-agents') && skill.provider === 'filesystem' })
}
function projectSkillDetail(skill: SkillDefinition): DesktopSkillDetail {
  return Object.freeze({ ...projectSkill(skill), content: skill.content,
    ...(skill.path === undefined ? {} : { path: skill.path }) })
}
function projectSkillInput(skill: DesktopSkillView, input: DesktopSkillInput): DesktopSkillView {
  const { whenToUse: _whenToUse, ...rest } = skill
  return Object.freeze({ ...rest, description: input.description,
    ...(input.whenToUse === undefined ? {} : { whenToUse: input.whenToUse }) })
}
function isPathInside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path !== '' && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
}

function skillLibraryRoot(): string { return resolve(resolveDshHome(), 'skills') }
function agentsSkillLibraryRoot(): string { return resolve(process.env.DSH_AGENTS_HOME ?? resolve(homedir(), '.agents'), 'skills') }
function recycleRoot(): string { return resolve(skillLibraryRoot(), '.recycle') }
function safeSkillName(value: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) throw new Error('Skill name must be kebab-case')
  return value
}

function skillInput(value: unknown, expectedName?: string): DesktopSkillInput {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.description !== 'string'
    || typeof value.instructions !== 'string' || (value.whenToUse !== undefined && typeof value.whenToUse !== 'string')) {
    throw new TypeError('Invalid Skill fields')
  }
  const name = safeSkillName(value.name.trim())
  if (expectedName !== undefined && name !== expectedName) throw new Error('Skill name cannot be changed')
  const description = value.description.trim()
  const whenToUse = value.whenToUse?.trim()
  const instructions = value.instructions.trim()
  if (description === '') throw new Error('Skill description is required')
  if (instructions === '') throw new Error('Skill instructions are required')
  if (description.length > 4_000 || (whenToUse?.length ?? 0) > 4_000) throw new Error('Skill metadata is too large')
  return Object.freeze({ name, description, ...(whenToUse === undefined || whenToUse === '' ? {} : { whenToUse }), instructions })
}

function skillDocument(text: string, mode: 'import' | 'inspect' = 'import'): DesktopSkillView {
  const lines = text.split(/\r?\n/u)
  if (lines[0]?.trim() !== '---') throw new Error('Skill must start with YAML frontmatter')
  const closing = lines.slice(1).findIndex(line => line.trim() === '---')
  if (closing < 0) throw new Error('Skill frontmatter is not terminated')
  const document = parseDocument(lines.slice(1, closing + 1).join('\n'), { prettyErrors: true })
  const data = document.toJS()
  if (document.errors.length > 0 || !isRecord(data) || typeof data.name !== 'string' || typeof data.description !== 'string' || data.description.trim() === '') {
    throw new Error('Skill frontmatter requires a name and description')
  }
  if (mode === 'import' && (data.description.length > 4000 || (typeof data.whenToUse === 'string' && data.whenToUse.length > 4000))) throw new Error('Skill metadata is too large')
  if (mode === 'import' && data.whenToUse !== undefined && typeof data.whenToUse !== 'string') throw new Error('Skill whenToUse must be text')
  for (const key of ['disable-model-invocation', 'user-invocable']) {
    if (data[key] !== undefined && typeof data[key] !== 'boolean') throw new Error(`Skill ${key} must be a boolean`)
  }
  if (mode === 'import' && lines.slice(closing + 2).join('\n').trim() === '') throw new Error('Skill instructions are required')
  return { name: safeSkillName(data.name.trim()), description: data.description.trim(),
    ...(typeof data.whenToUse === 'string' ? { whenToUse: data.whenToUse } : {}),
    source: 'user-dsh', provider: 'filesystem', editable: true,
    modelInvocable: data['disable-model-invocation'] !== true, userInvocable: data['user-invocable'] !== false }
}


export function createStructuredSkillDocument(value: DesktopSkillInput): string {
  const input = skillInput(value)
  const document = parseDocument('', { prettyErrors: true })
  document.set('name', input.name)
  document.set('description', input.description)
  if (input.whenToUse !== undefined) document.set('whenToUse', input.whenToUse)
  return `---\n${document.toString({ lineWidth: 0 }).trimEnd()}\n---\n\n${input.instructions}\n`
}

export function updateStructuredSkillDocument(text: string, value: DesktopSkillInput): string {
  const input = skillInput(value, value.name)
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/u)
  if (lines[0]?.trim() !== '---') throw new Error('Skill must start with YAML frontmatter')
  const closing = lines.slice(1).findIndex(line => line.trim() === '---')
  if (closing < 0) throw new Error('Skill frontmatter is not terminated')
  const document = parseDocument(lines.slice(1, closing + 1).join('\n'), { prettyErrors: true })
  const data = document.toJS()
  if (document.errors.length > 0 || !isRecord(data)) throw new Error('Skill frontmatter must be a YAML map')
  if (data.name !== input.name) throw new Error('Skill name does not match its file')
  document.set('description', input.description)
  if (input.whenToUse === undefined) document.delete('whenToUse')
  else document.set('whenToUse', input.whenToUse)
  const frontmatter = document.toString({ lineWidth: 0 }).trimEnd().replaceAll('\n', newline)
  return `---${newline}${frontmatter}${newline}---${newline}${newline}${input.instructions}${newline}`
}

export function setSkillModelInvocableDocument(text: string, enabled: boolean): string {
  return setSkillInvocationDocument(text, 'disable-model-invocation', !enabled)
}

export function setSkillUserInvocableDocument(text: string, enabled: boolean): string {
  return setSkillInvocationDocument(text, 'user-invocable', enabled)
}

function setSkillInvocationDocument(text: string, key: string, value: boolean): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/u)
  if (lines[0]?.trim() !== '---') {
    if ((key === 'user-invocable' && value) || (key === 'disable-model-invocation' && value === false)) return text
    return `---${newline}${key}: ${String(value)}${newline}---${newline}${newline}${text}`
  }
  const closing = lines.slice(1).findIndex(line => line.trim() === '---')
  if (closing < 0) throw new Error('Skill frontmatter is not terminated')
  const closingIndex = closing + 1
  const document = parseDocument(lines.slice(1, closingIndex).join('\n'), { prettyErrors: true })
  if (document.errors.length > 0 || !isRecord(document.toJS() ?? {})) throw new Error('Skill frontmatter must be a YAML map')
  if (key === 'disable-model-invocation' && value === false) document.delete(key)
  else if (key === 'user-invocable' && value === true) document.delete(key)
  else document.set(key, value)
  const frontmatter = document.toString({ lineWidth: 0 }).trimEnd().replaceAll('\n', newline)
  return ['---', frontmatter, '---', ...lines.slice(closingIndex + 1)]
    .filter((line, index) => !(index === 1 && line === '')).join(newline)
}

async function writeSkillInvocation(skill: SkillDefinition, key: 'model' | 'user', enabled: boolean): Promise<void> {
  const { target, mode } = await writableSkillFile(skill)
  const text = await readFile(target, 'utf8')
  const next = key === 'model' ? setSkillModelInvocableDocument(text, enabled) : setSkillUserInvocableDocument(text, enabled)
  if (next === text) return
  await atomicWrite(target, next, mode)
}

async function writableSkillFile(skill: SkillDefinition): Promise<{ readonly target: string, readonly mode: number }> {
  if ((skill.source !== 'user-dsh' && skill.source !== 'user-agents') || skill.provider !== 'filesystem' || skill.path === undefined) {
    throw new Error('Only Skills in a user library can be changed here')
  }
  const root = await realpath(skill.source === 'user-dsh' ? skillLibraryRoot() : agentsSkillLibraryRoot())
  const presentedInfo = await lstat(skill.path)
  if (presentedInfo.isSymbolicLink()) throw new Error('Skill file must not be a symbolic link')
  const target = await realpath(skill.path)
  if (!isPathInside(root, target)) throw new Error('Skill file is outside its user library')
  const info = await lstat(target)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Skill file must be a regular file')
  return { target, mode: info.mode }
}

async function atomicWrite(target: string, text: string, mode: number): Promise<void> {
  const temporary = resolve(dirname(target), `.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, text, { encoding: 'utf8', mode })
    if (process.platform !== 'win32') await chmod(temporary, mode)
    await rename(temporary, target)
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => {})
    throw cause
  }
}

export class DesktopSkillsController {
  constructor(private readonly ctx: Context, private readonly preset?: string, private readonly selection: DesktopSkillsScope = {}) {}
  private async view(): Promise<{ registry: Context['skills']; options: SkillViewOptions; preset?: string; [Symbol.asyncDispose](): Promise<void> }> {
    // Filesystem providers belong to preset layers in the Web composition.
    // Each request has its own selection; browsing never changes the default.
    const presets = this.ctx.get('agentPresets')
    let cwd: string | undefined
    let preset = this.preset
    if (this.selection.workspaceId !== undefined && this.selection.sessionId !== undefined) throw new TypeError('Choose either a Workspace or a Session')
    if (this.selection.sessionId !== undefined) {
      if (preset !== undefined) throw new TypeError('A Session uses its recorded Agent preset')
      const query = this.ctx.get('sessionQuery')
      if (query === undefined) throw new Error('Session discovery is unavailable')
      const sessionId = this.selection.sessionId as SessionId
      using observation = await query.observeSession(sessionId)
      if (observation.projections === undefined || observation.header.cwd === undefined) throw new Error('Session Skill context is unavailable')
      cwd = observation.header.cwd
      preset = observation.projections.values.agentPreset ?? undefined
      const live = this.ctx.get('agents')?.get(sessionId)
      if (live !== undefined) return { registry: presets?.serviceFor(live, 'skills') ?? this.ctx.skills, options: { cwd, scope: live },
        ...(preset === undefined ? {} : { preset }), [Symbol.asyncDispose]: async () => {} }
    } else if (this.selection.workspaceId !== undefined) {
      const workspace = this.ctx.get('workspaceRegistry')?.get(this.selection.workspaceId as WorkspaceId)
      if (workspace === undefined) throw new Error('Workspace not found')
      if (await workspace.status() !== 'ok') throw new Error('Workspace directory is unavailable')
      cwd = workspace.path
    }
    const options: SkillViewOptions = cwd === undefined ? {} : { cwd }
    if (presets === undefined) {
      if (preset !== undefined) throw new Error('Agent presets are unavailable')
      return { registry: this.ctx.skills, options, [Symbol.asyncDispose]: async () => {} }
    }
    const resolvedPreset = preset ?? presets.defaultId
    const lease = await presets.acquireScope(resolvedPreset)
    return { registry: this.ctx.skills, options: { ...options, scope: lease.key },
      ...(resolvedPreset === undefined ? {} : { preset: resolvedPreset }),
      [Symbol.asyncDispose]: async () => { await lease[Symbol.asyncDispose]() } }
  }
  private async getSkill(name: string): Promise<SkillDefinition | undefined> {
    await using view = await this.view()
    const { registry, options } = view
    return registry.get(name, options)
  }
  async read(): Promise<DesktopSkillsView> {
    await using view = await this.view()
    const { registry, options, preset } = view
    const snapshot = await registry.snapshot(options)
    if (!snapshot.complete) throw new Error('Skill discovery is incomplete. Please refresh to retry.')
    const installed = await this.installations(registry, options, new Set(snapshot.skills.map(skill => skill.name)))
    return Object.freeze({ skills: Object.freeze(snapshot.skills.map(projectSkill)), recycled: await this.recycled(), installed,
      locations: Object.freeze({ userLibrary: skillLibraryRoot(), recycleBin: recycleRoot(),
        ...(preset === undefined ? {} : { preset }),
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }) }) })
  }
  private async installations(registry: Context['skills'], options: SkillViewOptions, names: ReadonlySet<string>): Promise<readonly DesktopSkillInstallation[]> {
    // This is a managed-library inventory, never an alternative invocation catalog.
    const root = skillLibraryRoot()
    const entries = await readdir(root, { withFileTypes: true }).catch(cause => {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw cause
    })
    const result: DesktopSkillInstallation[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const entryInfo = entry.isSymbolicLink() ? await stat(resolve(root, entry.name)).catch(() => undefined) : entry
      if (entryInfo === undefined) { result.push({ name: entry.name, path: resolve(root, entry.name), status: 'unavailable', reason: 'unreadable-file' }); continue }
      if (!entryInfo.isDirectory() && !(entryInfo.isFile() && entry.name.endsWith('.md'))) continue
      const path = resolve(root, entry.name, ...(entryInfo.isDirectory() ? ['SKILL.md'] : []))
      let name = entry.name
      let raw: string
      try {
        const info = await stat(path)
        if (!info.isFile()) { result.push({ name, path, status: 'invalid', reason: 'missing-file' }); continue }
        if (info.size > MAX_SKILL_CONTENT_BYTES) { result.push({ name, path, status: 'unavailable', reason: 'inspection-limit' }); continue }
        raw = await readFile(path, 'utf8')
      } catch (cause) {
        const missing = (cause as NodeJS.ErrnoException).code === 'ENOENT'
        result.push({ name, path, status: missing ? 'invalid' : 'unavailable', reason: missing ? 'missing-file' : 'unreadable-file' }); continue
      }
      try { name = skillDocument(raw, 'inspect').name }
      catch { result.push({ name, path, status: 'invalid', reason: 'invalid-document' }); continue }
      if (!names.has(name)) { result.push({ name, path, status: 'not-discovered' }); continue }
      try {
        const winner = await registry.get(name, options)
        const winnerPath = winner?.path === undefined ? undefined : await realpath(winner.path).catch(() => undefined)
        const actualPath = await realpath(path)
        result.push({ name, path, status: winner === undefined ? 'not-discovered' : winnerPath === actualPath ? 'effective' : 'overridden',
          ...(winner === undefined ? {} : { effectiveSource: winner.source }),
          ...(winner?.path === undefined ? {} : { effectivePath: winner.path }) })
      } catch { result.push({ name, path, status: 'unavailable' }) }
    }
    return result.sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path))
  }
  async detail(name: string): Promise<DesktopSkillDetail> {
    const skill = await this.getSkill(name)
    if (skill === undefined) throw new Error(`Skill not found: ${name}`)
    if (Buffer.byteLength(skill.content, 'utf8') > MAX_SKILL_CONTENT_BYTES) throw new Error('Skill content is too large to preview')
    if (projectSkill(skill).editable) {
      let target: string
      try { ({ target } = await writableSkillFile(skill)) }
      catch { return { ...projectSkillDetail(skill), editable: false } }
      const raw = await readFile(target, 'utf8')
      if (Buffer.byteLength(raw, 'utf8') > MAX_SKILL_CONTENT_BYTES) throw new Error('Skill content is too large to preview')
      let metadata: DesktopSkillView
      try { metadata = skillDocument(raw) }
      catch { return { ...projectSkillDetail(skill), editable: false } }
      const lines = raw.split(/\r?\n/u)
      const closing = lines.slice(1).findIndex(line => line.trim() === '---') + 1
      const { whenToUse: _oldWhenToUse, ...detail } = projectSkillDetail(skill)
      return { ...detail, description: metadata.description, ...(metadata.whenToUse === undefined ? {} : { whenToUse: metadata.whenToUse }),
        modelInvocable: metadata.modelInvocable, userInvocable: metadata.userInvocable,
        content: lines.slice(closing + 1).join('\n').trim(), revision: revisionOf(target, raw) }
    }
    return projectSkillDetail(skill)
  }
  private async afterWrite(): Promise<DesktopSkillsView> {
    try { return await this.read() }
    catch { return { skills: [], recycled: [], refreshPending: true } }
  }
  async setModelInvocable(name: string, enabled: boolean): Promise<DesktopSkillsView> {
    const skill = await this.getSkill(name)
    if (skill === undefined) throw new Error(`Skill not found: ${name}`)
    await writeSkillInvocation(skill, 'model', enabled)
    return await this.withInvocation(name, { modelInvocable: enabled })
  }
  async setUserInvocable(name: string, enabled: boolean): Promise<DesktopSkillsView> {
    const skill = await this.getSkill(name)
    if (skill === undefined) throw new Error(`Skill not found: ${name}`)
    await writeSkillInvocation(skill, 'user', enabled)
    return await this.withInvocation(name, { userInvocable: enabled })
  }
  private async withInvocation(name: string, patch: Pick<DesktopSkillView, 'modelInvocable'> | Pick<DesktopSkillView, 'userInvocable'>): Promise<DesktopSkillsView> {
    // Filesystem discovery is watch-driven. Preserve the just-written value in
    // this response so the UI is not reverted by a snapshot from before its
    // watcher has observed the atomic rename.
    const view = await this.afterWrite()
    return Object.freeze({ ...view, skills: Object.freeze(view.skills.map(skill => skill.name === name ? Object.freeze({ ...skill, ...patch }) : skill)) })
  }
  private async recycled(): Promise<readonly DesktopRecycledSkill[]> {
    const root = recycleRoot()
    const entries = await readdir(root, { withFileTypes: true }).catch(cause => {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw cause
    })
    const records = await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
      const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)--([0-9a-f-]{36})$/u.exec(entry.name)
      if (match === null) return undefined
      const info = await lstat(resolve(root, entry.name))
      return Object.freeze({ id: entry.name, name: match[1]!, deletedAt: info.ctime.toISOString() })
    }))
    return Object.freeze(records.filter((entry): entry is DesktopRecycledSkill => entry !== undefined)
      .sort((left, right) => right.deletedAt.localeCompare(left.deletedAt)))
  }
  async importDocument(text: string): Promise<DesktopSkillsView> {
    if (Buffer.byteLength(text, 'utf8') > MAX_SKILL_CONTENT_BYTES) throw new Error('Skill content is too large')
    const imported = skillDocument(text)
    const { name } = imported
    if ((await this.read()).skills.some(skill => skill.name === name)) {
      throw new Error(`A Skill named ${name} already exists`)
    }
    const root = skillLibraryRoot(); const directory = resolve(root, name); const target = resolve(directory, 'SKILL.md')
    await mkdir(root, { recursive: true, mode: 0o700 })
    try { await mkdir(directory, { mode: 0o700 }) } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`A user Skill named ${name} already exists`)
      throw cause
    }
    try { await writeFile(target, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' }) } catch (cause) {
      await rm(directory, { recursive: true, force: true }).catch(() => {})
      throw cause
    }
    const view = await this.afterWrite()
    return Object.freeze({ ...view, skills: Object.freeze([...view.skills.filter(skill => skill.name !== name), imported]) })
  }
  async importBundle(value: unknown): Promise<DesktopSkillsView> {
    const files = decodeSkillBundle(value)
    const document = files.find(file => file.path === 'SKILL.md')!.data
    if (document.length > MAX_SKILL_CONTENT_BYTES) throw new Error('skillBundleLimit')
    const imported = skillDocument(new TextDecoder('utf-8', { fatal: true }).decode(document))
    if ((await this.read()).skills.some(skill => skill.name === imported.name)) throw new Error('skillBundleConflict')
    const directory = resolve(skillLibraryRoot(), imported.name)
    await mkdir(skillLibraryRoot(), { recursive: true, mode: 0o700 })
    try { await mkdir(directory, { mode: 0o700 }) }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('skillBundleConflict'); throw cause }
    try {
      // Publish SKILL.md last so discovery never sees an incomplete new bundle.
      for (const file of [...files.filter(file => file.path !== 'SKILL.md'), files.find(file => file.path === 'SKILL.md')!]) {
        const path = resolve(directory, file.path)
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        await writeFile(path, file.data, { flag: 'wx', mode: 0o600 })
      }
    } catch (cause) { await rm(directory, { recursive: true, force: true }); throw cause }
    return await this.afterWrite()
  }
  private async bundleDocument(name: string): Promise<string> {
    const skill = await this.getSkill(name)
    if (skill?.provider !== 'filesystem' || skill.path === undefined) throw new Error('skillFilesUnavailable')
    return skill.path
  }
  async files(name: string) { return { files: await listSkillFiles(await this.bundleDocument(name)) } }
  async file(name: string, path: string) { return await previewSkillFile(await this.bundleDocument(name), path) }
  async create(inputValue: DesktopSkillInput): Promise<DesktopSkillsView> {
    const input = skillInput(inputValue)
    const text = createStructuredSkillDocument(input)
    if (Buffer.byteLength(text, 'utf8') > MAX_SKILL_CONTENT_BYTES) throw new Error('Skill content is too large')
    return await this.importDocument(text)
  }
  async update(nameValue: string, inputValue: DesktopSkillInput, expectedRevision?: string): Promise<DesktopSkillsView> {
    const name = safeSkillName(nameValue)
    const input = skillInput(inputValue, name)
    const skill = await this.getSkill(name)
    if (skill === undefined) throw new Error(`Skill not found: ${name}`)
    const { target, mode } = await writableSkillFile(skill)
    const current = await readFile(target, 'utf8')
    if (expectedRevision === undefined || revisionOf(target, current) !== expectedRevision) throw new Error('skillEditConflict')
    const next = updateStructuredSkillDocument(current, input)
    if (Buffer.byteLength(next, 'utf8') > MAX_SKILL_CONTENT_BYTES) throw new Error('Skill content is too large')
    await atomicWrite(target, next, mode)
    const view = await this.afterWrite()
    return Object.freeze({ ...view, skills: Object.freeze(view.skills.map(item => item.name === name ? projectSkillInput(item, input) : item)) })
  }
  async recycle(name: string): Promise<DesktopSkillsView> {
    const skill = await this.getSkill(name)
    if (skill === undefined || skill.source !== 'user-dsh' || skill.provider !== 'filesystem' || skill.path === undefined) throw new Error('Only Skills in the DSH user library can be deleted here')
    const root = await realpath(skillLibraryRoot()); const target = await realpath(skill.path)
    if (!isPathInside(root, target)) throw new Error('Skill file is outside the DSH user library')
    const parent = dirname(target); const source = basename(target) === 'SKILL.md' ? parent : target
    if (dirname(source) !== root || source === root) throw new Error('Only top-level user Skill bundles can be deleted here')
    const destination = resolve(recycleRoot(), `${safeSkillName(name)}--${randomUUID()}`)
    await mkdir(recycleRoot(), { recursive: true, mode: 0o700 })
    if (source === target) {
      await mkdir(destination, { mode: 0o700 })
      await rename(source, resolve(destination, 'SKILL.md'))
    } else await rename(source, destination)
    const view = await this.afterWrite()
    return Object.freeze({ ...view, skills: Object.freeze(view.skills.filter(item => item.name !== name)) })
  }
  async restore(id: string): Promise<DesktopSkillsView> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*--[0-9a-f-]{36}$/u.test(id)) throw new Error('Invalid recycled Skill')
    const source = resolve(recycleRoot(), id); const name = id.slice(0, id.lastIndexOf('--'))
    const info = await lstat(source)
    if (!info.isDirectory()) throw new Error('Recycled Skill is missing')
    const target = resolve(skillLibraryRoot(), name)
    const restored = skillDocument(await readFile(resolve(source, 'SKILL.md'), 'utf8'))
    if (restored.name !== name) throw new Error('Recycled Skill name does not match its document')
    if (await lstat(target).catch(cause => (cause as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(cause)) !== undefined) throw new Error(`A user Skill named ${name} already exists`)
    await rename(source, target)
    const view = await this.afterWrite()
    return Object.freeze({ ...view, skills: Object.freeze(view.skills.some(skill => skill.name === name) ? view.skills : [...view.skills, restored]) })
  }
  async purge(ids: unknown): Promise<{ deleted: string[]; failed: string[] }> {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 10_000 || ids.some(id => typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*--[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(id))
      || new Set(ids).size !== ids.length) throw new TypeError('Invalid recycled Skill IDs')
    const root = recycleRoot()
    const rootInfo = await lstat(root).catch(cause => {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw cause
    })
    if (rootInfo === undefined) return { deleted: ids as string[], failed: [] }
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || await realpath(root) !== resolve(await realpath(skillLibraryRoot()), '.recycle')) throw new Error('Invalid recycle directory')
    const deleted: string[] = []; const failed: string[] = []
    for (const id of ids as string[]) {
      const target = resolve(root, id)
      try {
        const info = await lstat(target)
        if (!info.isDirectory() || info.isSymbolicLink()) { failed.push(id); continue }
        await rm(target, { recursive: true })
        deleted.push(id)
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') deleted.push(id)
        else failed.push(id)
      }
    }
    return { deleted, failed }
  }
}

async function handleAction(controller: DesktopSkillsController, value: unknown): Promise<object> {
  if (!isRecord(value) || typeof value.action !== 'string') throw new TypeError('invalid Skills action')
  if (value.action === 'purge') return controller.purge(value.ids)
  if (value.action === 'import-bundle') return controller.importBundle(value.files)
  if (value.action === 'files' && typeof value.name === 'string') return controller.files(value.name)
  if (value.action === 'file' && typeof value.name === 'string' && typeof value.path === 'string') return controller.file(value.name, value.path)
  if (value.action === 'detail' && typeof value.name === 'string') return await controller.detail(value.name)
  if (value.action === 'set-model-invocable' && typeof value.name === 'string' && typeof value.enabled === 'boolean') {
    return await controller.setModelInvocable(value.name, value.enabled)
  }
  if (value.action === 'set-user-invocable' && typeof value.name === 'string' && typeof value.enabled === 'boolean') return await controller.setUserInvocable(value.name, value.enabled)
  if (value.action === 'import' && typeof value.content === 'string' && value.content.length <= MAX_SKILL_CONTENT_BYTES) return await controller.importDocument(value.content)
  if (value.action === 'create') return await controller.create(skillInput(value.input))
  if (value.action === 'update' && typeof value.name === 'string') {
    if (typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(value.revision)) throw new TypeError('skillEditConflict')
    return await controller.update(value.name, skillInput(value.input, value.name), value.revision)
  }
  if (value.action === 'recycle' && typeof value.name === 'string') return await controller.recycle(value.name)
  if (value.action === 'restore' && typeof value.id === 'string') return await controller.restore(value.id)
  throw new TypeError('invalid Skills action')
}

export function apply(ctx: Context): void {
  const controller = new DesktopSkillsController(ctx)
  registerDesktopJsonApi(ctx, { label: 'Skills', readPath: DESKTOP_SKILLS_PATH, actionPath: DESKTOP_SKILLS_ACTION_PATH,
    maxBodyBytes: MAX_SKILL_BUNDLE_BYTES * 2,
    read: () => controller.read(), action: async value => {
      if (!isRecord(value)) throw new TypeError('Invalid Skills action')
      if (value.action === 'workspaces') return { workspaces: (ctx.get('workspaceRegistry')?.list() ?? []).map(workspace => ({ id: workspace.id, title: workspace.title, path: workspace.path })) }
      if (value.action === 'presets') {
        const presets = ctx.get('agentPresets')
        return { presets: presets === undefined ? [] : (await presets.list()).map((preset: { id: string, name?: string }) => ({ id: preset.id, name: preset.name ?? preset.id })) }
      }
      if (value.preset !== undefined && (typeof value.preset !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.preset))) throw new TypeError('Invalid Agent preset')
      for (const key of ['workspaceId', 'sessionId'] as const) {
        if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length === 0 || value[key].length > 512 || value[key].includes('\0'))) throw new TypeError(`Invalid ${key}`)
      }
      const selection: DesktopSkillsScope = {
        ...(typeof value.workspaceId === 'string' ? { workspaceId: value.workspaceId } : {}),
        ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
      }
      const scoped = new DesktopSkillsController(ctx, value.preset as string | undefined, selection)
      return value.action === 'read' ? scoped.read() : handleAction(scoped, value)
    } })
}
