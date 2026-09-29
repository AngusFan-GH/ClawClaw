#!/usr/bin/env node
/** Generate the immutable ClawClaw static update manifest from packaged installers. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const args = process.argv.slice(2)
function value(flag) { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1] }
const channel = 'stable'
const directory = resolve(value('--directory') ?? 'dist')
const baseUrl = value('--base-url')
const output = resolve(value('--output') ?? join(directory, 'release.json'))
const version = JSON.parse(await readFile(resolve('dsh-plugin-desktop/package.json'), 'utf8')).version
if (typeof version !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(version)) {
  throw new Error('dsh-plugin-desktop/package.json must contain a canonical stable version')
}
if (baseUrl === undefined) throw new Error('--base-url must be an HTTPS URL')
const parsedBaseUrl = new URL(baseUrl)
if (parsedBaseUrl.protocol !== 'https:' || parsedBaseUrl.username !== '' || parsedBaseUrl.password !== '') {
  throw new Error('--base-url must be an HTTPS URL without credentials')
}
const files = await readdir(directory)
function select(extension) {
  const candidates = files.filter(file => file.startsWith(`ClawClaw-${version}-`) && file.endsWith(extension))
  if (candidates.length !== 1) throw new Error(`expected exactly one ${extension} installer in ${directory}, found ${candidates.length}`)
  return candidates[0]
}
async function artifact(file) {
  const path = join(directory, file)
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  const info = await stat(path)
  return {
    url: `${baseUrl.replace(/\/$/u, '')}/${encodeURIComponent(file)}`,
    sha512: hash.digest('base64'),
    size: info.size,
  }
}
const manifest = { version, channel, artifacts: { darwin: await artifact(select('.dmg')), win32: await artifact(select('.exe')) } }
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`wrote ${output}`)
