#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

function readOption(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

async function selectInstaller(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const installers = entries
    .filter((entry) => entry.isFile() && /^ClawClaw-[0-9].*-Setup\.exe$/.test(entry.name))
    .map((entry) => join(directory, entry.name))

  if (installers.length !== 1) {
    throw new Error(`Expected exactly one Windows installer in ${directory}; found ${installers.length}.`)
  }
  return installers[0]
}

export async function generateWindowsUpdateMetadata({ directory, version }) {
  const installer = await selectInstaller(directory)
  const contents = await readFile(installer)
  const checksum = createHash('sha512').update(contents).digest('base64')
  const size = (await stat(installer)).size
  const filename = basename(installer)
  const metadata = [
    `version: ${version}`,
    'files:',
    `  - url: ${filename}`,
    `    sha512: ${checksum}`,
    `    size: ${size}`,
    `path: ${filename}`,
    `sha512: ${checksum}`,
    `releaseDate: ${new Date().toISOString()}`,
    '',
  ].join('\n')

  const output = join(directory, 'latest.yml')
  await writeFile(output, metadata)
  return output
}

async function main() {
  const directory = resolve(readOption('--directory', 'dsh-plugin-desktop/dist'))
  const packageJson = JSON.parse(await readFile(resolve('dsh-plugin-desktop/package.json'), 'utf8'))
  const output = await generateWindowsUpdateMetadata({ directory, version: packageJson.version })
  process.stdout.write(`Generated ${output}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 1
  })
}
