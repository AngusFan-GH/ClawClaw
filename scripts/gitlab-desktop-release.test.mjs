import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installerName, pipelineIdentity, stageInstaller, assembleInstallers, prepareUpstream } from './gitlab-desktop-release.mjs'

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

test('initializes a pinned submodule offline and restores its official origin without changing tracked files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'clawclaw-offline-upstream-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'source')
  const root = join(directory, 'product')
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commitFiles = cwd => {
    git(cwd, 'add', '.')
    git(cwd, '-c', 'user.name=CI fixture', '-c', 'user.email=ci@example.test', 'commit', '-qm', 'fixture')
  }
  await mkdir(source)
  await mkdir(root)
  git(source, 'init', '-q')
  await writeFile(join(source, 'README.md'), 'pinned source')
  commitFiles(source)
  const commit = git(source, 'rev-parse', 'HEAD')
  git(root, 'init', '-q')
  git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, 'deepseek-harness')
  const official = 'https://example.invalid/upstream.git'
  git(root, 'config', '-f', '.gitmodules', 'submodule.deepseek-harness.url', official)
  await writeFile(join(root, 'upstream.json'), JSON.stringify({ commit }))
  commitFiles(root)
  git(root, 'submodule', 'deinit', '-f', 'deepseek-harness')
  await rm(join(root, '.git/modules/deepseek-harness'), { recursive: true, force: true })
  await prepareUpstream(root, source)
  assert.equal(git(join(root, 'deepseek-harness'), 'rev-parse', 'HEAD'), commit)
  assert.equal(git(join(root, 'deepseek-harness'), 'remote', 'get-url', 'origin'), official)
  assert.equal(git(root, 'status', '--porcelain'), '')
})
