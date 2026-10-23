import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assembleRelease, stageInstaller, validateContext } from './github-release.mjs'
import { collectRelease } from './upload-update.mjs'

const context = { version: '0.2.11', commit: 'a'.repeat(40), runId: '42', repository: 'owner/repo' }

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'clawclaw-github-release-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const [platform, artifact, suffix] of [
    ['darwin', 'macos', 'universal.dmg'], ['win32', 'windows', 'x64-Setup.exe'],
  ]) {
    const file = join(root, `ClawClaw-${context.version}-${suffix}`)
    await writeFile(file, `${platform} installer fixture`)
    await stageInstaller({ file, output: join(root, `desktop-platform-${artifact}`), platform, context })
  }
  return { root, input: root, output: join(root, 'release'), context }
}

test('assembles both platforms with immutable origin URLs and verified provenance', async t => {
  const options = await fixture(t)
  await assembleRelease(options)
  const manifest = JSON.parse(await readFile(join(options.output, 'release.json'), 'utf8'))
  assert.equal(manifest.version, context.version)
  assert.equal(manifest.channel, 'stable')
  assert.equal(manifest.artifacts.darwin.url,
    'https://clawclaw.xzinfra.com:8443/releases/dsh/0.2.11/ClawClaw-0.2.11-universal.dmg')
  assert.equal(collectRelease(options.output).files.length, 4)
  const info = JSON.parse(await readFile(join(options.output, 'build-info.json'), 'utf8'))
  assert.equal(info.commit, context.commit)
  assert.equal(info.runId, context.runId)
  assert.deepEqual(info.artifacts.map(entry => entry.platform), ['darwin', 'win32'])
})

for (const [key, value] of Object.entries({ version: '0.2.10', commit: 'b'.repeat(40),
  runId: '41', repository: 'other/repo', platform: 'darwin', name: '../installer.exe' })) {
  test(`rejects a Windows artifact with mismatched ${key}`, async t => {
    const options = await fixture(t)
    const file = join(options.root, 'desktop-platform-windows', 'build-info.json')
    const metadata = JSON.parse(await readFile(file, 'utf8'))
    metadata[key] = value
    await writeFile(file, JSON.stringify(metadata))
    await assert.rejects(assembleRelease(options), /differs|Invalid platform/u)
  })
}

test('rejects bytes changed after platform staging', async t => {
  const options = await fixture(t)
  await writeFile(join(options.root, 'desktop-platform-windows', 'ClawClaw-0.2.11-x64-Setup.exe'), 'changed')
  await assert.rejects(assembleRelease(options), /bytes differ/u)
})

test('does not assemble when one platform is missing', async t => {
  const options = await fixture(t)
  await rm(join(options.root, 'desktop-platform-windows'), { recursive: true })
  await assert.rejects(assembleRelease(options), /ENOENT/u)
})

test('retains successful jobs from an earlier attempt of the same run', async t => {
  const options = await fixture(t)
  const file = join(options.root, 'desktop-platform-windows', 'build-info.json')
  const metadata = JSON.parse(await readFile(file, 'utf8'))
  metadata.buildAttempt = '2'
  await writeFile(file, JSON.stringify(metadata))
  await assembleRelease(options)
  const info = JSON.parse(await readFile(join(options.output, 'build-info.json'), 'utf8'))
  assert.deepEqual(info.artifacts.map(entry => entry.buildAttempt), ['1', '2'])
})

test('requires valid source identity and HTTPS origin', async t => {
  assert.throws(() => validateContext({ ...context, commit: 'HEAD' }), /Invalid release/u)
  const options = await fixture(t)
  for (const origin of ['http://example.test', 'https://user:password@example.test', 'https://example.test/path']) {
    await assert.rejects(assembleRelease({ ...options, origin }), /bare HTTPS origin/u)
  }
})

test('staging refuses filenames from another release', async t => {
  const options = await fixture(t)
  await assert.rejects(stageInstaller({ context, platform: 'win32',
    file: join(options.root, 'ClawClaw-0.2.10-x64-Setup.exe'), output: join(options.root, 'other') }),
  /filename does not match/u)
})
