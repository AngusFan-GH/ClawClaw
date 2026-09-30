import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import { collectRelease, remotePublishScript } from './upload-update.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'clawclaw-release-'))
  const dmg = Buffer.from('dmg')
  const exe = Buffer.from('exe')
  const artifact = (name, content) => ({ url: `https://example.test/${name}`, sha512: createHash('sha512').update(content).digest('base64'), size: content.length })
  writeFileSync(join(directory, 'ClawClaw-2.0.2.dmg'), dmg)
  writeFileSync(join(directory, 'ClawClaw-2.0.2.exe'), exe)
  writeFileSync(join(directory, 'release.json'), JSON.stringify({ version: '2.0.2', channel: 'stable', artifacts: { darwin: artifact('ClawClaw-2.0.2.dmg', dmg), win32: artifact('ClawClaw-2.0.2.exe', exe) } }))
  return directory
}

test('collects matching cross-platform release files', () => {
  const directory = fixture()
  try {
    assert.deepEqual(collectRelease(directory), { version: '2.0.2', files: [
      join(directory, 'release.json'),
      join(directory, 'ClawClaw-2.0.2.dmg'), join(directory, 'ClawClaw-2.0.2.exe'),
    ] })
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('rejects installer bytes whose SHA-512 differs from release.json', () => {
  const directory = fixture()
  try {
    writeFileSync(join(directory, 'ClawClaw-2.0.2.dmg'), 'changed')
    assert.throws(() => collectRelease(directory), /size differs|SHA-512 differs/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('rejects a manifest for another channel', () => {
  const directory = fixture()
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'release.json'), 'utf8'))
    manifest.channel = 'beta'
    writeFileSync(join(directory, 'release.json'), JSON.stringify(manifest))
    assert.throws(() => collectRelease(directory), /channel must match stable/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('rejects metadata paths that escape the release directory', () => {
  const directory = fixture()
  try {
    const dmg = Buffer.from('dmg')
    const exe = Buffer.from('exe')
    const artifact = (url, content) => ({ url, sha512: createHash('sha512').update(content).digest('base64'), size: content.length })
    writeFileSync(join(directory, 'release.json'), JSON.stringify({ version: '2.0.2', channel: 'stable', artifacts: {
      darwin: artifact('https://example.test/%2e%2e%2foutside.dmg', dmg),
      win32: artifact('https://example.test/ClawClaw-2.0.2.exe', exe),
    } }))
    assert.throws(() => collectRelease(directory), /must be a file in the release directory/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('publishes installers before atomically switching release.json', () => {
  const script = remotePublishScript({ archive: '/tmp/a.tgz', channel: 'stable', root: '/var/www/xzinfra', version: '2.0.2' })
  assert.ok(script.indexOf("! -name 'release.json'") < script.indexOf('release.json.new'))
  assert.ok(script.indexOf('release.json.new') < script.indexOf('mv "$stable/release.json.new"'))
  assert.ok(script.indexOf('test ! -e "$archive_dir"') < script.indexOf('mv -T "$version_staging" "$archive_dir"'))
  assert.match(script, /mktemp -d "\$stable\/\.incoming\.XXXXXX"/u)
  assert.doesNotMatch(script, /latest(?:-mac)?\.yml/u)
})

test('generates the single cross-platform release manifest without loading whole installers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'clawclaw-manifest-'))
  const version = JSON.parse(readFileSync(join(repositoryRoot, 'dsh-plugin-desktop/package.json'), 'utf8')).version
  const dmg = Buffer.from('dmg-content')
  const exe = Buffer.from('exe-content')
  const dmgName = `ClawClaw-${version}-universal.dmg`
  const exeName = `ClawClaw-${version}-x64-Setup.exe`
  try {
    writeFileSync(join(directory, dmgName), dmg)
    writeFileSync(join(directory, exeName), exe)
    execFileSync(process.execPath, [
      'scripts/generate-release-manifest.mjs',
      '--directory', directory,
      '--output', join(directory, 'release.json'),
      '--base-url', 'https://updates.example.test/stable',
    ], { cwd: repositoryRoot })
    const manifest = JSON.parse(readFileSync(join(directory, 'release.json'), 'utf8'))
    assert.equal(manifest.version, version)
    assert.equal(manifest.channel, 'stable')
    assert.deepEqual(manifest.artifacts.darwin, {
      url: `https://updates.example.test/stable/${dmgName}`,
      sha512: createHash('sha512').update(dmg).digest('base64'),
      size: dmg.length,
    })
    assert.deepEqual(manifest.artifacts.win32, {
      url: `https://updates.example.test/stable/${exeName}`,
      sha512: createHash('sha512').update(exe).digest('base64'),
      size: exe.length,
    })
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
