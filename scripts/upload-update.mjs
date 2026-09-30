#!/usr/bin/env node
/** Publish a validated DSH Desktop release to the self-hosted update origin. */

import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PORT = '22'
const DEFAULT_ROOT = '/var/www/xzinfra'
const CHANNEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/u
const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u

function argument(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function run(command, args, options = {}) {
  console.log(`[upload-update] ${command} ${args.join(' ')}`)
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

function requiredFile(path) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Required release file is missing: ${path}`)
  return path
}

function releaseFile(root, name) {
  if (typeof name !== 'string' || name.length === 0 || name !== basename(name)) {
    throw new Error(`Release artifact must be a file in the release directory: ${String(name)}`)
  }
  return requiredFile(join(root, name))
}

function releaseManifest(text, channel) {
  const value = JSON.parse(text)
  if (value === null || typeof value !== 'object' || typeof value.version !== 'string' || !VERSION_PATTERN.test(value.version)) {
    throw new Error('release.json must contain a canonical stable version')
  }
  if (value.channel !== channel) throw new Error(`release.json channel must match ${channel}`)
  return value
}

function sha512(path) {
  const descriptor = openSync(path, 'r')
  const hash = createHash('sha512')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    for (;;) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    closeSync(descriptor)
  }
  return hash.digest('base64')
}

/** Return the release files after checking the manifest against both installer bytes. */
export function collectRelease(directory, channel = 'stable') {
  if (!CHANNEL_PATTERN.test(channel)) throw new Error(`Invalid update channel: ${channel}`)
  const root = resolve(directory)
  const manifest = requiredFile(join(root, 'release.json'))
  const manifestValue = releaseManifest(readFileSync(manifest, 'utf8'), channel)
  const version = manifestValue.version
  const artifacts = manifestValue.artifacts
  if (artifacts === null || typeof artifacts !== 'object') throw new Error('release.json must contain platform artifacts')
  const files = [manifest]
  for (const platform of ['darwin', 'win32']) {
    const artifact = artifacts[platform]
    if (artifact === null || typeof artifact !== 'object' || typeof artifact.url !== 'string'
      || typeof artifact.sha512 !== 'string' || typeof artifact.size !== 'number') {
      throw new Error(`release.json has no ${platform} artifact`)
    }
    const url = new URL(artifact.url)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
      throw new Error(`release.json ${platform} artifact must use HTTPS without credentials`)
    }
    const name = decodeURIComponent(basename(url.pathname))
    const path = releaseFile(root, name)
    if (statSync(path).size !== artifact.size) throw new Error(`${name} size differs from release.json`)
    const digest = sha512(path)
    if (digest !== artifact.sha512) throw new Error(`${name} SHA-512 differs from release.json`)
    files.push(path)
  }
  return { files: [...new Set(files)], version }
}

/** Remote transaction: retain an immutable version directory before switching the feed. */
export function remotePublishScript({ archive, channel, root, version }) {
  return `set -euo pipefail
root=${shell(root)}
channel=${shell(channel)}
version=${shell(version)}
archive=${shell(archive)}
stable="$root/updates/dsh/$channel"
versions="$root/releases/dsh"
archive_dir="$versions/$version"
staging=
version_staging=
cleanup() { rm -rf "\${staging:-}" "\${version_staging:-}" "$archive"; }
trap cleanup EXIT
test ! -e "$archive_dir" || { echo "release archive already exists: $archive_dir" >&2; exit 1; }
install -d -m 0755 "$root/updates" "$stable" "$versions"
staging=$(mktemp -d "$stable/.incoming.XXXXXX")
version_staging=$(mktemp -d "$versions/.$version.incoming.XXXXXX")
tar -xzf "$archive" -C "$staging"
test -f "$staging/release.json"
find "$staging" -maxdepth 1 -type f -exec install -m 0644 {} "$version_staging" \\;
mv -T "$version_staging" "$archive_dir"
find "$staging" -maxdepth 1 -type f ! -name 'release.json' -exec install -m 0644 {} "$stable" \\;
install -m 0644 "$staging/release.json" "$stable/release.json.new"
mv "$stable/release.json.new" "$stable/release.json"
`
}

function shell(value) {
  return `'${String(value).replaceAll("'", "'\\\"'\\\"'")}'`
}

export function uploadUpdate(options) {
  const release = collectRelease(options.directory, options.channel)
  console.log(`[upload-update] version ${release.version}; ${release.files.length} files prepared`)
  for (const file of release.files) console.log(`  - ${file}`)
  if (options.dryRun) return release

  if (options.host === '') throw new Error('UPDATE_HOST is required for publishing')
  if (options.user === '') throw new Error('UPDATE_USER is required for publishing')
  const port = Number(options.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('UPDATE_PORT must be an integer from 1 to 65535')
  if (!options.root.startsWith('/')) throw new Error('UPDATE_REMOTE_ROOT must be an absolute path')

  const temporary = mkdtempSync(join(tmpdir(), 'clawclaw-update-'))
  const archiveName = `clawclaw-dsh-${release.version}-${randomUUID()}.tar.gz`
  const archive = join(temporary, archiveName)
  const destination = `${options.user}@${options.host}`
  try {
    run('tar', ['-C', resolve(options.directory), '-czf', archive, ...release.files.map(file => basename(file))])
    run('scp', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-P', options.port, archive, `${destination}:/tmp/${archiveName}`])
    const remote = Buffer.from(remotePublishScript({
      archive: `/tmp/${archiveName}`, channel: options.channel,
      root: options.root, version: release.version,
    })).toString('base64')
    run('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-p', options.port, destination, `printf %s ${shell(remote)} | base64 -d | bash`])
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
  return release
}

function main() {
  const channel = argument('--channel') ?? process.env.UPDATE_CHANNEL ?? 'stable'
  const directory = argument('--directory') ?? 'release'
  uploadUpdate({
    channel,
    directory,
    dryRun: process.argv.includes('--dry-run') || process.env.UPDATE_DRY_RUN === '1',
    host: process.env.UPDATE_HOST ?? '',
    user: process.env.UPDATE_USER ?? '',
    port: process.env.UPDATE_PORT ?? DEFAULT_PORT,
    root: process.env.UPDATE_REMOTE_ROOT ?? DEFAULT_ROOT,
  })
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
