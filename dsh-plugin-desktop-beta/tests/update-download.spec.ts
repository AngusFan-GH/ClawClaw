import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  UpdateDownloadError, desktopUpdateFilename, downloadDesktopUpdate,
  pendingDesktopUpdateArtifact, recordDesktopUpdateArtifact, resolveDesktopUpdateArtifact,
  type DesktopDownloadPlatform, type UpdateArtifactRequest,
} from '../src/update-download.ts'

const roots: string[] = []
async function temp() { const root = await mkdtemp(join(tmpdir(), 'clawclaw-update-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
function dmg() { const value = Buffer.alloc(1024, 0x5a); value.write('koly', 512, 'ascii'); return value }
function exe() { const value = Buffer.alloc(512); value.write('MZ'); value.writeUInt32LE(0x80, 0x3c); value.set([0x50, 0x45, 0, 0], 0x80); return value }
function sha(value: Uint8Array) { return createHash('sha512').update(value).digest('base64') }
function requestFor(version: string, artifacts: Record<DesktopDownloadPlatform, Uint8Array>): UpdateArtifactRequest {
  return async url => url.endsWith('release.json')
    ? Response.json({ version, channel: 'stable', artifacts: {
      darwin: { url: 'https://clawclaw.xzinfra.com/releases/ClawClaw.dmg', sha512: sha(artifacts.darwin), size: artifacts.darwin.byteLength },
      win32: { url: 'https://clawclaw.xzinfra.com/releases/ClawClaw.exe', sha512: sha(artifacts.win32), size: artifacts.win32.byteLength },
    } })
    : new Response(Buffer.from(artifacts[url.endsWith('.dmg') ? 'darwin' : 'win32']))
}

describe('ClawClaw installer download', () => {
  it('downloads a manifest-declared DMG atomically and verifies SHA-512', async () => {
    const directory = await temp(); const artifact = dmg()
    const destinationPath = join(directory, desktopUpdateFilename('darwin', '2.1.0'))
    const result = await downloadDesktopUpdate({ platform: 'darwin', version: '2.1.0', destinationPath, request: requestFor('2.1.0', { darwin: artifact, win32: exe() }) })
    expect(result).toBe(join(directory, 'ClawClaw-2.1.0-mac.dmg'))
    expect(await readFile(result)).toEqual(artifact)
  })

  it('rejects an installer whose content does not match the published checksum', async () => {
    const directory = await temp(); const good = dmg(); const bad = Buffer.from(good); bad[0] = 1
    const request = async (url: string): Promise<Response> => url.endsWith('release.json')
      ? Response.json({ version: '2.2.0', channel: 'stable', artifacts: {
        darwin: { url: 'https://clawclaw.xzinfra.com/releases/ClawClaw.dmg', sha512: sha(good), size: good.byteLength },
        win32: { url: 'https://clawclaw.xzinfra.com/releases/ClawClaw.exe', sha512: sha(exe()), size: 512 },
      } }) : new Response(bad)
    await expect(downloadDesktopUpdate({ platform: 'darwin', version: '2.2.0', destinationPath: join(directory, 'update.dmg'), request })).rejects.toMatchObject({ code: 'invalid-artifact' } satisfies Partial<UpdateDownloadError>)
  })

  it('rejects a changed release manifest before downloading', async () => {
    const directory = await temp()
    await expect(downloadDesktopUpdate({ platform: 'win32', version: '2.3.0', destinationPath: join(directory, 'update.exe'), request: requestFor('2.3.1', { darwin: dmg(), win32: exe() }) })).rejects.toMatchObject({ code: 'invalid-artifact' })
  })

  it('retains and resolves a completed installer after the new version starts', async () => {
    const data = await temp(); const path = join(data, 'ClawClaw-2.4.0-windows.exe'); await writeFile(path, exe())
    await recordDesktopUpdateArtifact(data, { platform: 'win32', version: '2.4.0', path })
    await expect(pendingDesktopUpdateArtifact(data, '2.4.0', 'win32')).resolves.toMatchObject({ path })
    await resolveDesktopUpdateArtifact(data, { platform: 'win32', version: '2.4.0', path }, true)
    await expect(pendingDesktopUpdateArtifact(data, '2.4.0', 'win32')).resolves.toBeUndefined()
  })
})
