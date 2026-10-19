/** Transfer native CI installers over SSH instead of GitLab's artifact store. */
import { chmod, mkdir, readFile, stat } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { randomUUID } from 'node:crypto'
import { get } from 'node:https'
import { isIP } from 'node:net'

const shell = value => `'${String(value).replaceAll("'", "'\\\"'\\\"'")}'`

export function transportOptions(env) {
  const host = env.UPDATE_HOST ?? ''
  const user = env.UPDATE_USER ?? ''
  const port = env.UPDATE_PORT ?? '22'
  const stagingRoot = env.UPDATE_STAGING_ROOT ?? ''
  const identityFile = env.UPDATE_SSH_KEY_FILE ?? ''
  const knownHostsFile = env.UPDATE_SSH_KNOWN_HOSTS_FILE ?? ''
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/u.test(host) || !/^[a-z_][a-z0-9_-]*$/u.test(user)) {
    throw new Error('A valid UPDATE_HOST and UPDATE_USER are required')
  }
  if (!/^[0-9]+$/u.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid UPDATE_PORT')
  if (!/^\/[a-zA-Z0-9_./-]+$/u.test(stagingRoot) || posix.normalize(stagingRoot) !== stagingRoot || stagingRoot === '/') {
    throw new Error('UPDATE_STAGING_ROOT must be a normalized absolute directory')
  }
  if (!identityFile || !knownHostsFile) throw new Error('SSH identity and known-hosts file variables are required')
  return { host, user, port, stagingRoot, identityFile, knownHostsFile }
}

function directory(options, identity, platform) {
  if (!/^[0-9a-f]{40}$/u.test(identity.commit) || !/^[1-9][0-9]*$/u.test(identity.pipelineId)
    || !['darwin', 'win32'].includes(platform)) throw new Error('Invalid staging identity')
  return `${options.stagingRoot}/${identity.pipelineId}-${identity.commit}/${platform}`
}

async function connection(options) {
  await stat(options.identityFile)
  await stat(options.knownHostsFile)
  if (process.platform !== 'win32') await chmod(options.identityFile, 0o600)
  return ['-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
    '-o', `UserKnownHostsFile=${options.knownHostsFile}`, '-i', options.identityFile]
}

/** Publish the ready metadata last, so interrupted transfers cannot look complete. */
export async function uploadStagedInstaller(root, platform, identity, options, run) {
  const remote = directory(options, identity, platform)
  const local = join(root, 'ci-artifacts', platform)
  const metadata = JSON.parse(await readFile(join(local, 'build-info.json'), 'utf8'))
  if (metadata.commit !== identity.commit || metadata.pipelineId !== identity.pipelineId || metadata.platform !== platform
    || !/^ClawClaw-[0-9]+\.[0-9]+\.[0-9]+-(universal\.dmg|x64-Setup\.exe)$/u.test(metadata.name)) {
    throw new Error('Installer metadata does not match the staging identity')
  }
  const args = await connection(options)
  const target = `${options.user}@${options.host}`
  const temporary = `.incoming-${randomUUID()}`
  await run(root, 'ssh', [...args, '-p', options.port, target, `umask 077; mkdir -p -- ${shell(remote)}`])
  await run(root, 'scp', [...args, '-P', options.port, join(local, metadata.name), `${target}:${remote}/${temporary}`])
  await run(root, 'scp', [...args, '-P', options.port, join(local, 'build-info.json'), `${target}:${remote}/${temporary}.json`])
  await run(root, 'ssh', [...args, '-p', options.port, target,
    `set -eu; mv -- ${shell(`${remote}/${temporary}`)} ${shell(`${remote}/${metadata.name}`)}; mv -- ${shell(`${remote}/${temporary}.json`)} ${shell(`${remote}/build-info.json`)}`])
  console.log(`Staged ${platform} installer for pipeline ${identity.pipelineId}`)
}

/** Download only expected installer names; assembleInstallers verifies both hashes. */
export async function downloadStagedInstallers(root, identity, version, options, run) {
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(version)) throw new Error('Invalid release version')
  const args = await connection(options)
  const target = `${options.user}@${options.host}`
  for (const platform of ['darwin', 'win32']) {
    const remote = directory(options, identity, platform)
    const local = join(root, 'ci-artifacts', platform)
    const name = `ClawClaw-${version}-${platform === 'darwin' ? 'universal.dmg' : 'x64-Setup.exe'}`
    await mkdir(local, { recursive: true })
    for (const file of ['build-info.json', name]) {
      await run(root, 'scp', [...args, '-P', options.port, `${target}:${remote}/${file}`, join(local, file)])
    }
  }
}

/** Pre-DNS publication still authenticates TLS against the original hostname. */
export function originRequestAtAddress(address) {
  const family = isIP(address)
  if (!family) throw new Error('UPDATE_ORIGIN_VERIFY_IP must be a literal IP address')
  return async (url, options) => await new Promise((resolve, reject) => {
    const request = get(url, {
      signal: options.signal,
      servername: url.hostname,
      rejectUnauthorized: true,
      lookup: (_hostname, settings, callback) => {
        if (settings.all) callback(null, [{ address, family }])
        else callback(null, address, family)
      },
    }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
        if (body.length > 256) response.destroy(new Error('Unexpected origin health response'))
      })
      response.on('error', reject)
      response.on('end', () => resolve(new Response(body, { status: response.statusCode })))
    })
    request.on('error', reject)
  })
}

/** Require trusted HTTPS and the marker of the intended download service. */
export async function verifyInternalOrigin(baseUrl, request = fetch) {
  const url = new URL(baseUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('UPDATE_BASE_URL must be an HTTPS origin without credentials')
  }
  const response = await request(new URL('/healthz', url), { redirect: 'error', signal: AbortSignal.timeout(15_000) })
  if (response.status !== 200 || await response.text() !== 'clawclaw-internal-release-origin\n') {
    throw new Error('The download domain does not reach the internal release origin; check DNS before publishing')
  }
}
