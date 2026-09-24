#!/usr/bin/env node
/** Publish a validated DSH Desktop release to the self-hosted update origin. */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_HOST = '101.200.13.235'
const DEFAULT_USER = 'root'
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

function releaseVersion(text) {
  const value = JSON.parse(text)
  if (value === null || typeof value !== 'object' || typeof value.version !== 'string' || !VERSION_PATTERN.test(value.version)) {
    throw new Error('release.json must contain a canonical stable version')
  }
  return value.version
}

function metadataVersion(path) {
  const match = /^version:\s*['"]?([^'"\r\n]+)['"]?\s*$/mu.exec(readFileSync(path, 'utf8'))
  return match?.[1]?.trim()
}

/** Return the release files after checking all three update metadata formats agree. */
export function collectRelease(directory, channel = 'stable', unsignedMac = false) {
  if (!CHANNEL_PATTERN.test(channel)) throw new Error(`Invalid update channel: ${channel}`)
  const root = resolve(directory)
  const manifest = requiredFile(join(root, 'release.json'))
  const windows = requiredFile(join(root, 'latest.yml'))
  const macPath = join(root, 'latest-mac.yml')
  const mac = existsSync(macPath) ? requiredFile(macPath) : undefined
  if (mac === undefined && !unsignedMac) throw new Error(`Required release file is missing: ${macPath}`)
  const version = releaseVersion(readFileSync(manifest, 'utf8'))
  for (const metadata of [windows, ...(mac === undefined ? [] : [mac])]) {
    if (metadataVersion(metadata) !== version) throw new Error(`${basename(metadata)} version must match release.json (${version})`)
  }
  const manifestValue = JSON.parse(readFileSync(manifest, 'utf8'))
  const artifacts = manifestValue.artifacts
  if (artifacts === null || typeof artifacts !== 'object') throw new Error('release.json must contain platform artifacts')
  const files = [manifest, windows, ...(mac === undefined ? [] : [mac])]
  for (const platform of ['darwin', 'win32']) {
    const artifact = artifacts[platform]
    if (artifact === null || typeof artifact !== 'object' || typeof artifact.url !== 'string' || typeof artifact.size !== 'number') {
      throw new Error(`release.json has no ${platform} artifact`)
    }
    const name = decodeURIComponent(basename(new URL(artifact.url).pathname))
    const path = releaseFile(root, name)
    if (statSync(path).size !== artifact.size) throw new Error(`${name} size differs from release.json`)
    files.push(path)
  }
  for (const path of [windows, ...(mac === undefined ? [] : [mac])]) {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
      const match = /^\s*-\s+url:\s+['"]?([^'"\r\n]+)['"]?\s*$/u.exec(line)
      if (match === null) continue
      const artifact = releaseFile(root, match[1])
      files.push(artifact)
      if (existsSync(`${artifact}.blockmap`)) files.push(`${artifact}.blockmap`)
    }
  }
  return { files: [...new Set(files)], macMetadata: mac !== undefined, version }
}

/** Remote transaction: retain an immutable version directory before switching the feed. */
export function remotePublishScript({ archive, channel, macMetadata = true, root, version }) {
  return `set -euo pipefail
root=${shell(root)}
channel=${shell(channel)}
version=${shell(version)}
archive=${shell(archive)}
stable="$root/updates/dsh/$channel"
staging=$(mktemp -d "$root/updates/.incoming.XXXXXX")
cleanup() { rm -rf "$staging" "$archive"; }
trap cleanup EXIT
tar -xzf "$archive" -C "$staging"
test -f "$staging/release.json"
test -f "$staging/latest.yml"
${macMetadata ? 'test -f "$staging/latest-mac.yml"' : ''}
archive_dir="$root/releases/dsh/$version"
install -d -m 0755 "$stable" "$archive_dir"
find "$staging" -maxdepth 1 -type f -exec install -m 0644 {} "$archive_dir" \\;
find "$staging" -maxdepth 1 -type f ! -name '*.yml' ! -name 'release.json' -exec install -m 0644 {} "$stable" \\;
install -m 0644 "$staging/latest.yml" "$stable/latest.yml.new"
${macMetadata ? 'install -m 0644 "$staging/latest-mac.yml" "$stable/latest-mac.yml.new"' : ''}
install -m 0644 "$staging/release.json" "$stable/release.json.new"
mv "$stable/latest.yml.new" "$stable/latest.yml"
${macMetadata ? 'mv "$stable/latest-mac.yml.new" "$stable/latest-mac.yml"' : ''}
mv "$stable/release.json.new" "$stable/release.json"
`
}

function shell(value) {
  return `'${String(value).replaceAll("'", "'\\\"'\\\"'")}'`
}

function remoteRunner(password) {
  if (password === '') return { scp: { command: 'scp', args: [] }, ssh: { command: 'ssh', args: [] } }
  if (process.platform === 'win32') throw new Error('Password-based publishing requires sshpass or expect on a POSIX host')
  try {
    execFileSync('sshpass', ['-V'], { stdio: 'ignore' })
    return {
      scp: { command: 'sshpass', args: ['-e', 'scp'] },
      ssh: { command: 'sshpass', args: ['-e', 'ssh'] },
    }
  } catch {
    throw new Error('UPDATE_PASSWORD is set but sshpass is unavailable; install sshpass or use an SSH key')
  }
}

export function uploadUpdate(options) {
  const release = collectRelease(options.directory, options.channel, options.unsignedMac)
  console.log(`[upload-update] version ${release.version}; ${release.files.length} files prepared`)
  for (const file of release.files) console.log(`  - ${file}`)
  if (options.dryRun) return release

  const temporary = mkdtempSync(join(tmpdir(), 'clawclaw-update-'))
  const archiveName = `clawclaw-dsh-${release.version}-${process.pid}.tar.gz`
  const archive = join(temporary, archiveName)
  const destination = `${options.user}@${options.host}`
  const runner = remoteRunner(options.password)
  try {
    run('tar', ['-C', resolve(options.directory), '-czf', archive, ...release.files.map(file => basename(file))])
    run(runner.scp.command, [...runner.scp.args, '-o', 'StrictHostKeyChecking=yes', '-P', options.port, archive, `${destination}:/tmp/${archiveName}`], {
      env: { ...process.env, SSHPASS: options.password },
    })
    const remote = Buffer.from(remotePublishScript({
      archive: `/tmp/${archiveName}`, channel: options.channel, macMetadata: release.macMetadata,
      root: options.root, version: release.version,
    })).toString('base64')
    run(runner.ssh.command, [...runner.ssh.args, '-o', 'StrictHostKeyChecking=yes', '-p', options.port, destination, `printf %s ${shell(remote)} | base64 -d | bash`], {
      env: { ...process.env, SSHPASS: options.password },
    })
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
    unsignedMac: process.argv.includes('--unsigned-mac'),
    host: process.env.UPDATE_HOST ?? DEFAULT_HOST,
    user: process.env.UPDATE_USER ?? DEFAULT_USER,
    port: process.env.UPDATE_PORT ?? DEFAULT_PORT,
    root: process.env.UPDATE_REMOTE_ROOT ?? DEFAULT_ROOT,
    password: process.env.UPDATE_PASSWORD ?? '',
  })
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
