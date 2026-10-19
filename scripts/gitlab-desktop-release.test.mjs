import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installerName, pipelineIdentity, stageInstaller, assembleInstallers } from './gitlab-desktop-release.mjs'

const identity = { commit: 'a'.repeat(40), pipelineId: '123' }

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'clawclaw-ci-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'dsh-plugin-desktop/dist/mac-smoke'), { recursive: true })
  await writeFile(join(root, 'dsh-plugin-desktop/package.json'), JSON.stringify({ version: '0.2.10' }))
  for (const platform of ['darwin', 'win32']) {
    const name = installerName('0.2.10', platform)
    const path = join(root, 'dsh-plugin-desktop/dist', ...(platform === 'darwin' ? ['mac-smoke'] : []), name)
    await writeFile(path, `fixture installer for ${platform}`)
    await stageInstaller(root, platform, identity)
  }
  return root
}

test('combines both installers and retains verified provenance without generating an update feed', async t => {
  const root = await fixture(t)
  const metadata = await assembleInstallers(root, identity)
  assert.equal(metadata.commit, identity.commit)
  assert.equal(metadata.pipelineId, identity.pipelineId)
  assert.equal(metadata.artifacts.length, 2)
  for (const artifact of metadata.artifacts) {
    assert.equal(await readFile(join(root, 'release', artifact.name), 'utf8'), `fixture installer for ${artifact.platform}`)
    assert.equal(Buffer.from(artifact.sha512, 'base64').length, 64)
  }
  await assert.rejects(readFile(join(root, 'release/release.json')), { code: 'ENOENT' })
})

for (const field of ['commit', 'pipelineId', 'version', 'platform', 'name']) {
  test(`rejects a Windows artifact with mismatched ${field}`, async t => {
    const root = await fixture(t)
    const path = join(root, 'ci-artifacts/win32/build-info.json')
    const metadata = JSON.parse(await readFile(path, 'utf8'))
    metadata[field] = 'other'
    await writeFile(path, JSON.stringify(metadata))
    await assert.rejects(assembleInstallers(root, identity), /another commit, pipeline, version, or platform/)
    await assert.rejects(readFile(join(root, 'release/build-info.json')), { code: 'ENOENT' })
  })
}

test('rejects modified installer bytes even when size is unchanged', async t => {
  const root = await fixture(t)
  const path = join(root, 'ci-artifacts/win32', installerName('0.2.10', 'win32'))
  const bytes = await readFile(path)
  bytes[0] ^= 1
  await writeFile(path, bytes)
  await assert.rejects(assembleInstallers(root, identity), /SHA-512 differs/)
})

test('rejects a missing platform instead of assembling a partial release', async t => {
  const root = await fixture(t)
  await rm(join(root, 'ci-artifacts/win32'), { recursive: true })
  await assert.rejects(assembleInstallers(root, identity), { code: 'ENOENT' })
})

test('requires an explicit pipeline identity', () => {
  assert.throws(() => pipelineIdentity({}), /required/)
  assert.deepEqual(pipelineIdentity({ CI_COMMIT_SHA: identity.commit, CI_PIPELINE_ID: '123' }), identity)
})
