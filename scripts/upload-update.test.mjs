import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { collectRelease, remotePublishScript } from './upload-update.mjs'

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'clawclaw-release-'))
  const dmg = Buffer.from('dmg')
  const exe = Buffer.from('exe')
  const artifact = (name, content) => ({ url: `https://example.test/${name}`, sha512: createHash('sha512').update(content).digest('base64'), size: content.length })
  writeFileSync(join(directory, 'ClawClaw-2.0.2.dmg'), dmg)
  writeFileSync(join(directory, 'ClawClaw-2.0.2.exe'), exe)
  writeFileSync(join(directory, 'release.json'), JSON.stringify({ version: '2.0.2', channel: 'stable', artifacts: { darwin: artifact('ClawClaw-2.0.2.dmg', dmg), win32: artifact('ClawClaw-2.0.2.exe', exe) } }))
  writeFileSync(join(directory, 'latest.yml'), 'version: 2.0.2\nfiles:\n  - url: ClawClaw-2.0.2.exe\n')
  writeFileSync(join(directory, 'latest-mac.yml'), 'version: 2.0.2\nfiles:\n  - url: ClawClaw-2.0.2.dmg\n')
  return directory
}

test('collects matching cross-platform release files', () => {
  const directory = fixture()
  try {
    assert.deepEqual(collectRelease(directory), { version: '2.0.2', files: [
      join(directory, 'release.json'), join(directory, 'latest.yml'), join(directory, 'latest-mac.yml'),
      join(directory, 'ClawClaw-2.0.2.dmg'), join(directory, 'ClawClaw-2.0.2.exe'),
    ] })
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('rejects mismatched updater metadata before transfer', () => {
  const directory = fixture()
  try {
    writeFileSync(join(directory, 'latest-mac.yml'), 'version: 2.0.1\n')
    assert.throws(() => collectRelease(directory), /latest-mac.yml version/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('rejects metadata paths that escape the release directory', () => {
  const directory = fixture()
  try {
    writeFileSync(join(directory, 'latest.yml'), 'version: 2.0.2\nfiles:\n  - url: ../outside.exe\n')
    assert.throws(() => collectRelease(directory), /must be a file in the release directory/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('publishes installers before switching all feed metadata', () => {
  const script = remotePublishScript({ archive: '/tmp/a.tgz', channel: 'stable', root: '/var/www/xzinfra', version: '2.0.2' })
  assert.ok(script.indexOf("! -name '*.yml'") < script.indexOf('latest.yml.new'))
  assert.ok(script.indexOf('mv "$stable/latest-mac.yml.new"') < script.indexOf('mv "$stable/release.json.new"'))
})
