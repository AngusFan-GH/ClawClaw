import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stageInstaller, assembleInstallers, installerName } from './gitlab-desktop-release.mjs'
import { uploadStagedInstaller, downloadStagedInstallers, transportOptions, verifyInternalOrigin } from './gitlab-release-transport.mjs'

const identity = { commit: 'b'.repeat(40), pipelineId: '456' }

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'clawclaw-transfer-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const remoteRoot = join(root, 'server')
  const build = join(root, 'build')
  const coordinator = join(root, 'coordinator')
  for (const dir of [build, coordinator]) {
    await mkdir(join(dir, 'dsh-plugin-desktop'), { recursive: true })
    await writeFile(join(dir, 'dsh-plugin-desktop/package.json'), '{"version":"0.2.10"}')
  }
  const key = join(root, 'key')
  const known = join(root, 'known')
  await writeFile(key, 'fixture only')
  await writeFile(known, 'fixture only')
  const options = transportOptions({ UPDATE_HOST: 'internal.test', UPDATE_USER: 'release',
    UPDATE_STAGING_ROOT: '/incoming', UPDATE_SSH_KEY_FILE: key, UPDATE_SSH_KNOWN_HOSTS_FILE: known })
  const prefix = 'release@internal.test:'
  const map = path => {
    assert.ok(path.startsWith('/incoming/'))
    assert.ok(!path.includes('..'))
    return join(remoteRoot, path.slice(1))
  }
  // Exercise SSH/SCP file effects without requiring an SSH daemon in unit tests.
  const calls = []
  const run = async (_cwd, command, args) => {
    calls.push({ command, args })
    assert.ok(args.includes('StrictHostKeyChecking=yes'))
    assert.ok(args.includes(key))
    if (command === 'scp') {
      const [source, destination] = args.slice(-2)
      await copyFile(source.startsWith(prefix) ? map(source.slice(prefix.length)) : source,
        destination.startsWith(prefix) ? map(destination.slice(prefix.length)) : destination)
    } else {
      const script = args.at(-1)
      const paths = [...script.matchAll(/'([^']*)'/gu)].map(match => map(match[1]))
      if (script.includes('mkdir -p')) await mkdir(paths[0], { recursive: true })
      else {
        assert.equal(paths.length, 4)
        await rename(paths[0], paths[1])
        await rename(paths[2], paths[3])
      }
    }
  }
  for (const platform of ['darwin', 'win32']) {
    const directory = join(build, 'dsh-plugin-desktop/dist', ...(platform === 'darwin' ? ['mac-smoke'] : []))
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, installerName('0.2.10', platform)), `installer ${platform}`)
    await stageInstaller(build, platform, identity)
  }
  return { build, coordinator, remoteRoot, options, run, calls }
}

test('transfers and assembles both native installers with their original identity and hashes', async t => {
  const f = await fixture(t)
  for (const platform of ['darwin', 'win32']) await uploadStagedInstaller(f.build, platform, identity, f.options, f.run)
  await downloadStagedInstallers(f.coordinator, identity, '0.2.10', f.options, f.run)
  const result = await assembleInstallers(f.coordinator, identity)
  assert.equal(result.artifacts.length, 2)
  assert.equal(result.commit, identity.commit)
  assert.equal(result.pipelineId, identity.pipelineId)
})

test('an interrupted transfer leaves no ready metadata and can be retried', async t => {
  const f = await fixture(t)
  let count = 0
  const interrupted = async (...args) => {
    if (++count === 3) throw new Error('connection lost')
    return f.run(...args)
  }
  await assert.rejects(uploadStagedInstaller(f.build, 'darwin', identity, f.options, interrupted), /connection lost/u)
  const metadata = join(f.remoteRoot, 'incoming', `${identity.pipelineId}-${identity.commit}`, 'darwin/build-info.json')
  await assert.rejects(readFile(metadata), { code: 'ENOENT' })
  await uploadStagedInstaller(f.build, 'darwin', identity, f.options, f.run)
  assert.equal(JSON.parse(await readFile(metadata)).commit, identity.commit)
})

test('rejects corrupted installer bytes after downloading from staging', async t => {
  const f = await fixture(t)
  for (const platform of ['darwin', 'win32']) await uploadStagedInstaller(f.build, platform, identity, f.options, f.run)
  const path = join(f.remoteRoot, 'incoming', `${identity.pipelineId}-${identity.commit}`, 'win32', installerName('0.2.10', 'win32'))
  const bytes = await readFile(path)
  bytes[0] ^= 1
  await writeFile(path, bytes)
  await downloadStagedInstallers(f.coordinator, identity, '0.2.10', f.options, f.run)
  await assert.rejects(assembleInstallers(f.coordinator, identity), /SHA-512 differs/u)
})

test('rejects unsafe destinations and staging identities before SSH', async t => {
  const f = await fixture(t)
  for (const UPDATE_STAGING_ROOT of ['/', '/data/../incoming', 'relative', '/data/incoming;touch /tmp/x']) {
    assert.throws(() => transportOptions({ UPDATE_HOST: 'host', UPDATE_USER: 'release', UPDATE_STAGING_ROOT,
      UPDATE_SSH_KEY_FILE: 'key', UPDATE_SSH_KNOWN_HOSTS_FILE: 'known' }), /STAGING_ROOT/u)
  }
  await assert.rejects(uploadStagedInstaller(f.build, 'darwin', { ...identity, pipelineId: '../1' }, f.options, f.run), /staging identity/u)
  assert.equal(f.calls.length, 0)
})

test('publishing requires trusted HTTPS and the internal origin marker', async () => {
  await verifyInternalOrigin('https://clawclaw.example.test', async (url, options) => {
    assert.equal(url.pathname, '/healthz')
    assert.equal(options.redirect, 'error')
    return new Response('clawclaw-internal-release-origin\n')
  })
  await assert.rejects(verifyInternalOrigin('https://old.example.test', async () => new Response('old origin')), /check DNS/u)
  await assert.rejects(verifyInternalOrigin('http://internal.test'), /HTTPS origin/u)
})
