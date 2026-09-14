#!/usr/bin/env node
/** Generate the immutable ClawClaw static update manifest from packaged installers. */
import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const args = process.argv.slice(2)
function value(flag) { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1] }
const channel = value('--channel')
const directory = resolve(value('--directory') ?? 'dist')
const baseUrl = value('--base-url')
const output = resolve(value('--output') ?? join(directory, 'release.json'))
if (channel !== 'stable' && channel !== 'beta') throw new Error('--channel must be stable or beta')
if (baseUrl === undefined || !baseUrl.startsWith('https://')) throw new Error('--base-url must be an HTTPS URL')
const files = await readdir(directory)
function select(extension) {
  const candidates = files.filter(file => file.startsWith(channel === 'beta' ? 'ClawClaw-Beta-' : 'ClawClaw-') && file.endsWith(extension))
  if (candidates.length !== 1) throw new Error(`expected exactly one ${extension} installer in ${directory}, found ${candidates.length}`)
  return candidates[0]
}
async function artifact(file) {
  const path = join(directory, file); const content = await readFile(path); const info = await stat(path)
  return { url: `${baseUrl.replace(/\/$/u, '')}/${encodeURIComponent(file)}`, sha512: createHash('sha512').update(content).digest('base64'), size: info.size }
}
const manifest = { version: JSON.parse(await readFile(resolve(channel === 'beta' ? 'dsh-plugin-desktop-beta/package.json' : 'dsh-plugin-desktop/package.json'), 'utf8')).version, channel, artifacts: { darwin: await artifact(select('.dmg')), win32: await artifact(select('.exe')) } }
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`wrote ${output}`)
