/** Stage and assemble installers from one GitHub Actions run. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectRelease } from './upload-update.mjs'

const platforms = { darwin: 'macos', win32: 'windows' }
const positiveInteger = /^[1-9][0-9]*$/u

export function validateContext(context) {
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(context.version ?? '')
    || !/^[0-9a-f]{40}$/u.test(context.commit ?? '')
    || !positiveInteger.test(context.runId ?? '')
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(context.repository ?? '')) {
    throw new Error('Invalid release version or GitHub build identity')
  }
}

function installerName(version, platform) {
  if (!Object.hasOwn(platforms, platform)) throw new Error('Unsupported release platform')
  return `ClawClaw-${version}-${platform === 'darwin' ? 'universal.dmg' : 'x64-Setup.exe'}`
}

async function inspect(file) {
  const info = await lstat(file)
  if (!info.isFile() || info.size <= 0 || info.size > 1024 ** 3) {
    throw new Error('Installer must be a nonempty regular file no larger than 1 GiB (legacy client limit)')
  }
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return { size: info.size, sha512: hash.digest('base64') }
}

export async function stageInstaller({ file, output, platform, context, buildAttempt = '1' }) {
  validateContext(context)
  if (!positiveInteger.test(buildAttempt)) throw new Error('Invalid build attempt')
  const name = installerName(context.version, platform)
  if (basename(file) !== name) throw new Error('Installer filename does not match version and platform')
  const metadata = { ...context, platform, buildAttempt, name, ...await inspect(file) }
  await mkdir(output)
  await copyFile(file, join(output, name))
  await writeFile(join(output, 'build-info.json'), `${JSON.stringify(metadata, null, 2)}\n`)
}

export async function assembleRelease({ input, output, context,
  origin = 'https://clawclaw.xzinfra.com:9528' }) {
  validateContext(context)
  const url = new URL(origin)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
    || url.search || url.hash) throw new Error('Update origin must be a bare HTTPS origin')
  const entries = []
  for (const [platform, artifact] of Object.entries(platforms)) {
    const directory = join(input, `desktop-platform-${artifact}`)
    const metadata = JSON.parse(await readFile(join(directory, 'build-info.json'), 'utf8'))
    for (const key of ['version', 'commit', 'runId', 'repository']) {
      if (metadata[key] !== context[key]) throw new Error(`Build ${key} differs from this release run`)
    }
    const name = installerName(context.version, platform)
    if (metadata.platform !== platform || metadata.name !== name
      || !positiveInteger.test(metadata.buildAttempt ?? '')) throw new Error('Invalid platform build metadata')
    const file = join(directory, name)
    const actual = await inspect(file)
    if (actual.size !== metadata.size || actual.sha512 !== metadata.sha512) {
      throw new Error('Installer bytes differ from build metadata')
    }
    entries.push({ platform, name, buildAttempt: metadata.buildAttempt, ...actual, file })
  }
  await mkdir(output)
  for (const entry of entries) await copyFile(entry.file, join(output, entry.name))
  const manifest = { version: context.version, channel: 'stable', artifacts: Object.fromEntries(
    entries.map(({ platform, name, size, sha512 }) => [platform, {
      url: `${url.origin}/releases/dsh/${context.version}/${encodeURIComponent(name)}`, size, sha512,
    }]),
  ) }
  const provenance = { ...context, artifacts: entries.map(({ file, ...entry }) => entry) }
  await writeFile(join(output, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(join(output, 'build-info.json'), `${JSON.stringify(provenance, null, 2)}\n`)
  collectRelease(output)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = flag => process.argv[process.argv.indexOf(flag) + 1]
  const required = flag => {
    if (!process.argv.includes(flag) || !option(flag) || option(flag).startsWith('--')) {
      throw new Error(`${flag} is required`)
    }
    return option(flag)
  }
  const { version } = JSON.parse(await readFile(new URL('../dsh-plugin-desktop/package.json', import.meta.url), 'utf8'))
  const context = { version, commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
    repository: process.env.GITHUB_REPOSITORY }
  if (process.argv[2] === 'stage') {
    await stageInstaller({ context, file: required('--file'), output: required('--output'),
      platform: required('--platform'), buildAttempt: process.env.GITHUB_RUN_ATTEMPT })
  } else if (process.argv[2] === 'assemble') {
    await assembleRelease({ context, input: required('--input'), output: required('--output') })
  } else throw new Error('Expected stage or assemble')
}
