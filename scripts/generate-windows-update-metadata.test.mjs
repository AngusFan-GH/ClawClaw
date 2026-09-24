import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { generateWindowsUpdateMetadata } from './generate-windows-update-metadata.mjs'

test('creates electron-updater metadata for the single Windows installer', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'clawclaw-update-metadata-'))
  t.after(() => rm(directory, { recursive: true, force: true }))

  const installerName = 'ClawClaw-0.2.2-x64-Setup.exe'
  const installerContents = Buffer.from('test Windows installer')
  await writeFile(join(directory, installerName), installerContents)

  await generateWindowsUpdateMetadata({ directory, version: '0.2.2' })

  const metadata = await readFile(join(directory, 'latest.yml'), 'utf8')
  const checksum = createHash('sha512').update(installerContents).digest('base64')
  assert.match(metadata, /^version: 0\.2\.2$/m)
  assert.ok(metadata.includes(`url: ${installerName}`))
  assert.ok(metadata.includes(`sha512: ${checksum}`))
  assert.match(metadata, /^    size: 22$/m)
})

test('rejects a directory without exactly one Windows installer', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'clawclaw-update-metadata-'))
  t.after(() => rm(directory, { recursive: true, force: true }))

  await assert.rejects(
    generateWindowsUpdateMetadata({ directory, version: '0.2.2' }),
    /Expected exactly one Windows installer/,
  )
})
