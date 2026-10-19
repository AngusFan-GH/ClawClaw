/** Build native installers and combine artifacts from exactly one GitLab pipeline. */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transportOptions, uploadStagedInstaller, downloadStagedInstallers, verifyInternalOrigin, originRequestAtAddress } from './gitlab-release-transport.mjs'
import { uploadUpdate } from './upload-update.mjs'

const platforms = ['darwin', 'win32']
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))

export function installerName(version, platform) {
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(version)) {
    throw new Error('Expected a canonical stable desktop version')
  }
  if (!platforms.includes(platform)) throw new Error(`Unsupported platform: ${platform}`)
  return `ClawClaw-${version}-${platform === 'darwin' ? 'universal.dmg' : 'x64-Setup.exe'}`
}

async function artifactInfo(path) {
  const info = await lstat(path)
  if (!info.isFile() || info.size === 0) throw new Error(`Expected a nonempty regular installer: ${path}`)
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return { size: info.size, sha512: hash.digest('base64') }
}

export function pipelineIdentity(env) {
  if (!/^[0-9a-f]{40}$/u.test(env.CI_COMMIT_SHA ?? '') || !/^[1-9][0-9]*$/u.test(env.CI_PIPELINE_ID ?? '')) {
    throw new Error('CI_COMMIT_SHA and CI_PIPELINE_ID are required')
  }
  return { commit: env.CI_COMMIT_SHA, pipelineId: env.CI_PIPELINE_ID }
}

export async function stageInstaller(root, platform, identity) {
  const { version } = await readJson(join(root, 'dsh-plugin-desktop/package.json'))
  const name = installerName(version, platform)
  const source = join(root, 'dsh-plugin-desktop/dist', ...(platform === 'darwin' ? ['mac-smoke'] : []), name)
  const artifact = await artifactInfo(source)
  const directory = join(root, 'ci-artifacts', platform)
  await mkdir(directory, { recursive: true })
  await copyFile(source, join(directory, name))
  await writeFile(join(directory, 'build-info.json'), `${JSON.stringify({
    ...identity, version, platform, name, ...artifact,
  }, null, 2)}\n`)
}

export async function assembleInstallers(root, identity) {
  const { version } = await readJson(join(root, 'dsh-plugin-desktop/package.json'))
  const artifacts = []
  // Validate both platforms before copying either one to the release directory.
  for (const platform of platforms) {
    const directory = join(root, 'ci-artifacts', platform)
    const metadata = await readJson(join(directory, 'build-info.json'))
    const name = installerName(version, platform)
    if (metadata.commit !== identity.commit || metadata.pipelineId !== identity.pipelineId
      || metadata.version !== version || metadata.platform !== platform || metadata.name !== name) {
      throw new Error(`${platform} artifact belongs to another commit, pipeline, version, or platform`)
    }
    const actual = await artifactInfo(join(directory, name))
    if (actual.size !== metadata.size || actual.sha512 !== metadata.sha512) {
      throw new Error(`${platform} installer size or SHA-512 differs from build metadata`)
    }
    artifacts.push({ platform, name, ...actual })
  }
  const release = join(root, 'release')
  await mkdir(release, { recursive: true })
  for (const artifact of artifacts) {
    await copyFile(join(root, 'ci-artifacts', artifact.platform, artifact.name), join(release, artifact.name))
  }
  // This is provenance, not the client's release.json: the internal download URL
  // is not configured yet, so this pipeline must not switch the update feed.
  const metadata = { ...identity, version, artifacts }
  await writeFile(join(release, 'build-info.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  console.log(`Assembled ClawClaw ${version} from commit ${identity.commit}, pipeline ${identity.pipelineId}`)
  return metadata
}

async function runCommand(root, command, args, shell = false) {
  console.log(`[${new Date().toISOString()}] ${command} ${args.join(' ')}`)
  const child = spawn(command, args, {
    cwd: root, stdio: 'inherit', shell,
  })
  const timer = setInterval(() => {
    console.log(`[${new Date().toISOString()}] Still running: ${command} ${args.join(' ')}`)
  }, 60_000)
  try {
    await new Promise((ok, fail) => {
      child.once('error', fail)
      child.once('exit', (code, signal) => code === 0 ? ok() : fail(new Error(`${command} exited with ${code ?? signal}`)))
    })
  } finally { clearInterval(timer) }
}

async function runPnpm(root, args) {
  await runCommand(root, process.platform === 'win32' ? 'corepack.cmd' : 'corepack', ['pnpm', ...args], process.platform === 'win32')
}

/** Clone exact Git objects from an optional local source, then restore official remotes. */
export async function prepareUpstream(root, source) {
  const { commit } = await readJson(join(root, 'upstream.json'))
  const args = []
  if (source) {
    const local = resolve(source)
    // Verify the fixed commit exists before touching the CI submodule checkout.
    execFileSync('git', ['-C', local, 'cat-file', '-e', `${commit}^{commit}`], { stdio: 'pipe' })
    args.push('-c', 'protocol.file.allow=always', '-c', `submodule.deepseek-harness.url=${local}`)
  }
  await runCommand(root, 'git', ['submodule', 'init'])
  await runCommand(root, 'git', [...args, 'submodule', 'update', '--init', '--recursive'])
  await runCommand(root, 'git', ['submodule', 'sync', '--recursive'])
}

async function main() {
  const root = resolve(import.meta.dirname, '..')
  const [action, platform] = process.argv.slice(2)
  const identity = pipelineIdentity(process.env)
  if (action === 'assemble') {
    if (process.env.CLAWCLAW_DIRECT_UPLOAD === '1') {
      const { version } = await readJson(join(root, 'dsh-plugin-desktop/package.json'))
      const options = transportOptions(process.env)
      const verifyAddress = process.env.UPDATE_ORIGIN_VERIFY_IP
      if (verifyAddress && verifyAddress !== options.host) {
        throw new Error('The origin verification IP must match UPDATE_HOST')
      }
      await verifyInternalOrigin(process.env.UPDATE_BASE_URL,
        verifyAddress ? originRequestAtAddress(verifyAddress) : undefined)
      await downloadStagedInstallers(root, identity, version, options, runCommand)
      await assembleInstallers(root, identity)
      await runCommand(root, process.execPath, ['scripts/generate-release-manifest.mjs', '--directory', 'release',
        '--base-url', `${process.env.UPDATE_BASE_URL.replace(/\/$/u, '')}/releases/dsh/${version}`])
      uploadUpdate({ directory: join(root, 'release'), channel: 'stable', ...options,
        root: process.env.UPDATE_REMOTE_ROOT })
      return
    }
    await assembleInstallers(root, identity)
    return
  }
  if (action !== 'build' || !platforms.includes(platform) || process.platform !== platform) {
    throw new Error('Use build darwin on macOS, build win32 on Windows, or assemble')
  }
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (!((major === 22 && minor >= 19) || major === 24)) throw new Error('Packaging requires Node 22.19+ or Node 24.x')
  const { version } = await readJson(join(root, 'dsh-plugin-desktop/package.json'))
  installerName(version, platform)
  await prepareUpstream(root, process.env.CLAWCLAW_UPSTREAM_SOURCE)
  await runPnpm(root, ['--version'])
  await runPnpm(root, ['install', '--frozen-lockfile'])
  await runPnpm(root, ['run', 'upstream:prepare-runtime'])
  await runPnpm(root, ['install', '--frozen-lockfile'])
  await runPnpm(root, ['check'])
  await runPnpm(root, [platform === 'darwin' ? 'dist:mac' : 'dist:win'])
  await stageInstaller(root, platform, identity)
  if (process.env.CLAWCLAW_DIRECT_UPLOAD === '1') {
    await uploadStagedInstaller(root, platform, identity, transportOptions(process.env), runCommand)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
