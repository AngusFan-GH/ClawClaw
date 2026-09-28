/** Read-only compatibility registration for pre-0.1.7 user preset directories. */

import { lstat, readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { entryListProblem } from '@deepseek-ai/dsh-agent-preset-registry'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { parseDocument } from 'yaml'

const MAX_PRESET_FILE_BYTES = 4 * 1024 * 1024
const PRESET_ID = /^[A-Za-z0-9_-]{1,128}$/u

export const name = 'desktop-legacy-agent-presets'
export const inject = ['agentPresets']

export interface LegacyAgentPresetsConfig {
  readonly root?: string
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
    plugins: rows as PresetDefinition['plugins'],
  }
}

export async function apply(ctx: Context, config: LegacyAgentPresetsConfig = {}): Promise<void> {
  const root = resolve(config.root ?? join(resolveDshHome(), '.agent-presets'))
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
    throw cause
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
}
