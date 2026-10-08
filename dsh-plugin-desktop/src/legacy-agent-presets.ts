/** Read-only compatibility registration for pre-0.1.7 user preset directories. */

import { lstat, readFile, readdir, rm } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { entryListProblem } from '@deepseek-ai/dsh-agent-preset-registry'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { parseDocument } from 'yaml'
import { registerDesktopJsonApi } from './desktop-json-api.ts'
import { DESKTOP_LEGACY_AGENT_PRESETS_ACTION_PATH, DESKTOP_LEGACY_AGENT_PRESETS_PATH, type DesktopLegacyAgentPreset, type DesktopLegacyAgentPresetsView } from './legacy-agent-presets-contract.ts'

const MAX_PRESET_FILE_BYTES = 4 * 1024 * 1024
const PRESET_ID = /^[A-Za-z0-9_-]{1,128}$/u
const SKILL_FILESYSTEM_ID = 'skill-filesystem'
const SKILL_FILESYSTEM_PACKAGE = '@deepseek-ai/dsh-skill-filesystem'
const CLAWCLAW_SKILL_FILESYSTEM_ID = 'clawclaw-skill-filesystem'
const CLAWCLAW_SKILL_FILESYSTEM_PACKAGE = 'dsh-plugin-desktop/clawclaw-skill-filesystem'
const require = createRequire(import.meta.url)
const BUNDLED_SKILL_ROOT = join(dirname(require.resolve('@deepseek-ai/dsh-agent-preset/package.json')), 'skills')

export const name = 'desktop-legacy-agent-presets'
export const inject = ['agentPresets', 'webServer', 'connection']

export interface LegacyAgentPresetsConfig {
  readonly root?: string
}

function presetRoot(config: LegacyAgentPresetsConfig): string {
  return resolve(config.root ?? join(resolveDshHome(), '.agent-presets'))
}

function assertPresetId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !PRESET_ID.test(value)) throw new TypeError('Invalid Agent preset id')
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function regularFile(path: string): Promise<string> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('must be a regular file')
  if (info.size > MAX_PRESET_FILE_BYTES) throw new Error(`exceeds ${String(MAX_PRESET_FILE_BYTES)} bytes`)
  return await readFile(path, 'utf8')
}

function parseYaml(path: string, source: string, expressions = false): unknown {
  const document = parseDocument(source, {
    prettyErrors: true,
    ...(expressions ? {
      customTags: [{
        tag: 'tag:yaml.org,2002:js',
        resolve: (value: string) => ({ __jsExpr: value }),
      }],
    } : {}),
  })
  if (document.errors.length > 0) {
    throw new Error(`${path}: ${document.errors.map(error => error.message).join('; ')}`)
  }
  return document.toJS()
}

function anchorPluginNames(rows: unknown[], directory: string): void {
  for (const row of rows) {
    if (!record(row)) continue
    if (typeof row.name === 'string'
      && (isAbsolute(row.name) || row.name.startsWith('./') || row.name.startsWith('../'))) {
      row.name = pathToFileURL(resolve(directory, row.name)).href
    }
    if (row.group === true && Array.isArray(row.config)) anchorPluginNames(row.config, directory)
  }
}

function isolateSkillRoots(rows: PresetDefinition['plugins']): PresetDefinition['plugins'] {
  const plugins = [...rows]
  const filesystemIndex = plugins.findIndex(row => row.id === SKILL_FILESYSTEM_ID)
  if (filesystemIndex >= 0 && plugins[filesystemIndex]?.name !== SKILL_FILESYSTEM_PACKAGE) {
    throw new Error(`${SKILL_FILESYSTEM_ID} has a conflicting package identity`)
  }
  const existingFilesystem = filesystemIndex < 0 ? undefined : plugins[filesystemIndex]
  const filesystem = {
    ...(existingFilesystem ?? {}),
    id: SKILL_FILESYSTEM_ID,
    name: SKILL_FILESYSTEM_PACKAGE,
    config: {
      includeDefaultRoots: false,
      customSkillDirs: [join(resolveDshHome(), 'skills')],
      bundledSkillDir: BUNDLED_SKILL_ROOT,
    },
  }
  if (filesystemIndex < 0) plugins.push(filesystem)
  else plugins[filesystemIndex] = filesystem

  const projectIndex = plugins.findIndex(row => row.id === CLAWCLAW_SKILL_FILESYSTEM_ID)
  if (projectIndex >= 0 && plugins[projectIndex]?.name !== CLAWCLAW_SKILL_FILESYSTEM_PACKAGE) {
    throw new Error(`${CLAWCLAW_SKILL_FILESYSTEM_ID} has a conflicting package identity`)
  }
  if (projectIndex < 0) plugins.push({ id: CLAWCLAW_SKILL_FILESYSTEM_ID, name: CLAWCLAW_SKILL_FILESYSTEM_PACKAGE })
  return plugins
}

/** Parse one historical directory without modifying any user-owned files. */
export async function readLegacyAgentPreset(directory: string, id: string): Promise<PresetDefinition> {
  if (!PRESET_ID.test(id)) throw new Error(`invalid preset directory id: ${id}`)
  const metadataPath = join(directory, 'preset.yml')
  const pluginsPath = join(directory, 'agent.cordis.yml')
  const metadata = parseYaml(metadataPath, await regularFile(metadataPath))
  if (!record(metadata)) throw new Error(`${metadataPath}: metadata must be a map`)
  const plugins = parseYaml(pluginsPath, await regularFile(pluginsPath), true)
  const problem = entryListProblem(plugins)
  if (problem !== undefined) throw new Error(`${pluginsPath}: ${problem}`)
  const rows = structuredClone(plugins) as unknown[]
  anchorPluginNames(rows, directory)
  const optionalText = (key: string): string | undefined => {
    const value = metadata[key]
    if (value === undefined) return undefined
    if (typeof value !== 'string' || value.length === 0) throw new Error(`${metadataPath}: ${key} must be non-empty text`)
    return value
  }
  const order = metadata.order
  if (order !== undefined && (typeof order !== 'number' || !Number.isFinite(order))) {
    throw new Error(`${metadataPath}: order must be a finite number`)
  }
  const presetName = optionalText('name')
  const description = optionalText('description')
  return {
    id,
    ...(presetName === undefined ? {} : { name: presetName }),
    ...(description === undefined ? {} : { description }),
    ...(order === undefined ? {} : { order }),
    plugins: isolateSkillRoots(rows as unknown as PresetDefinition['plugins']),
  }
}

/** List only directories which this compatibility plugin owns and may delete. */
export async function listLegacyAgentPresets(root: string): Promise<DesktopLegacyAgentPresetsView> {
  let entries: Dirent[]
  try { entries = await readdir(root, { withFileTypes: true }) } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return Object.freeze({ presets: Object.freeze([]) })
    throw cause
  }
  const presets: DesktopLegacyAgentPreset[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !PRESET_ID.test(entry.name)) continue
    try {
      const definition = await readLegacyAgentPreset(join(root, entry.name), entry.name)
      presets.push(Object.freeze({ id: definition.id, name: definition.name ?? definition.id,
        ...(definition.description === undefined ? {} : { description: definition.description }) }))
    } catch { /* A broken legacy directory is not a managed preset. */ }
  }
  return Object.freeze({ presets: Object.freeze(presets) })
}

/** Delete exactly one non-symlink legacy preset directory; never follows links. */
export async function deleteLegacyAgentPreset(root: string, id: string): Promise<void> {
  assertPresetId(id)
  const target = resolve(root, id)
  if (target !== join(root, id)) throw new TypeError('Invalid Agent preset id')
  let info
  try { info = await lstat(target) } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') throw new TypeError('Agent preset not found')
    throw cause
  }
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError('Agent preset is not a removable directory')
  await rm(target, { recursive: true, force: false })
}

export async function apply(ctx: Context, config: LegacyAgentPresetsConfig = {}): Promise<void> {
  const root = presetRoot(config)
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') entries = []
    else throw cause
  }
  const disposers: Array<() => Promise<void>> = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    try {
      const definition = await readLegacyAgentPreset(join(root, entry.name), entry.name)
      disposers.push(await ctx.agentPresets.register(definition))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (message.includes(`Duplicate agent preset: ${entry.name}`)) {
        ctx.logger.warn('legacy agent preset %s is shadowed by an official preset', entry.name)
      } else {
        ctx.logger.warn('legacy agent preset %s was skipped: %s', entry.name, message)
      }
    }
  }
  ctx.effect(() => async () => {
    for (const dispose of disposers.reverse()) await dispose()
  })
  registerDesktopJsonApi(ctx, {
    label: 'Legacy Agent presets', readPath: DESKTOP_LEGACY_AGENT_PRESETS_PATH, actionPath: DESKTOP_LEGACY_AGENT_PRESETS_ACTION_PATH,
    read: () => listLegacyAgentPresets(root),
    action: async (value) => {
      if (!record(value) || value.action !== 'delete') throw new TypeError('Invalid Agent preset action')
      const id = value.id
      assertPresetId(id)
      await deleteLegacyAgentPreset(root, id)
      return await listLegacyAgentPresets(root)
    },
  })
}
