import { createHash } from 'node:crypto'
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  UpdateDownloadError, desktopUpdateDestination, desktopUpdateFilename, downloadDesktopUpdate,
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
  it('creates a private app-owned installer destination', async () => {
    const directory = await temp()
    const destination = await desktopUpdateDestination(directory, 'win32', '2.1.0')
    const installerDirectory = join(directory, 'updates', 'installers')
    expect(destination).toBe(join(installerDirectory, 'ClawClaw-2.1.0-windows.exe'))
    expect((await lstat(installerDirectory)).mode & 0o777).toBe(0o700)
  })

  it('downloads a manifest-declared DMG atomically and verifies SHA-512', async () => {
    const directory = await temp(); const artifact = dmg()
    const destinationPath = join(directory, desktopUpdateFilename('darwin', '2.1.0'))
    const result = await downloadDesktopUpdate({ platform: 'darwin', version: '2.1.0', destinationPath, request: requestFor('2.1.0', { darwin: artifact, win32: exe() }) })
    expect(result).toBe(join(directory, 'ClawClaw-2.1.0-mac.dmg'))
    expect(await readFile(result)).toEqual(artifact)
  })

  it('reports byte progress and clears native progress after completion', async () => {
    const directory = await temp(); const artifact = dmg(); const progress = vi.fn()
    const base = requestFor('2.1.0', { darwin: artifact, win32: exe() })
    const request: UpdateArtifactRequest = async (url, init) => {
      if (url.endsWith('release.json')) return base(url, init)
      return new Response(new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(artifact.subarray(0, 256))
          stream.enqueue(artifact.subarray(256))
          stream.close()
        },
      }))
    }
    await downloadDesktopUpdate({
      platform: 'darwin', version: '2.1.0',
      destinationPath: join(directory, 'ClawClaw-2.1.0-mac.dmg'), request, progress,
    })
    expect(progress.mock.calls.map(call => call[0])).toEqual([0, 0.25, 1, -1])
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

  it('passes the caller signal and removes a partial file when aborted during streaming', async () => {
    const directory = await temp(); const artifact = dmg(); const controller = new AbortController()
    const destinationPath = join(directory, 'ClawClaw-2.3.0-mac.dmg')
    const request: UpdateArtifactRequest = async (url, init) => {
      expect(init.signal).toBe(controller.signal)
      if (url.endsWith('release.json')) return requestFor('2.3.0', { darwin: artifact, win32: exe() })(url, init)
      return new Response(new ReadableStream<Uint8Array>({
        start(stream) { stream.enqueue(artifact.subarray(0, 128)); controller.abort() },
      }))
    }
    await expect(downloadDesktopUpdate({
      platform: 'darwin', version: '2.3.0', destinationPath, request, signal: controller.signal,
    })).rejects.toMatchObject({ code: 'aborted' })
    expect(await readdir(directory)).toEqual([])
  })

  it('keeps an existing destination until its validated replacement is ready', async () => {
    const directory = await temp(); const good = dmg(); const bad = Buffer.from(good); bad[0] = 1
    const destinationPath = join(directory, 'ClawClaw-2.3.0-mac.dmg')
    await writeFile(destinationPath, 'existing installer')
    const request: UpdateArtifactRequest = async (url, init) => url.endsWith('release.json')
      ? requestFor('2.3.0', { darwin: good, win32: exe() })(url, init)
      : new Response(bad)
    await expect(downloadDesktopUpdate({
      platform: 'darwin', version: '2.3.0', destinationPath, request,
    })).rejects.toMatchObject({ code: 'invalid-artifact' })
    expect(await readFile(destinationPath, 'utf8')).toBe('existing installer')
    expect((await readdir(directory)).filter(name => name.endsWith('.partial'))).toEqual([])
  })

  it.each([1023, 1025])('rejects manifest size %i even when the checksum matches', async size => {
    const directory = await temp()
    const base = requestFor('2.3.0', { darwin: dmg(), win32: exe() })
    const request: UpdateArtifactRequest = async (url, init) => {
      const response = await base(url, init)
      if (!url.endsWith('release.json')) return response
      const manifest = await response.json()
      manifest.artifacts.darwin.size = size
      return Response.json(manifest)
    }
    const destinationPath = join(directory, 'update.dmg')
    await writeFile(destinationPath, 'previous installer')
    await expect(downloadDesktopUpdate({ platform: 'darwin', version: '2.3.0', destinationPath, request }))
      .rejects.toMatchObject({ code: 'invalid-artifact' })
    expect(await readFile(destinationPath, 'utf8')).toBe('previous installer')
    expect(await readdir(directory)).toEqual(['update.dmg'])
  })

  it('cancels a stalled body read and removes its partial file', async () => {
    const directory = await temp()
    const controller = new AbortController()
    let reading!: () => void
    const ready = new Promise<void>(resolve => { reading = resolve })
    const cancel = vi.fn()
    const base = requestFor('2.3.0', { darwin: dmg(), win32: exe() })
    const request: UpdateArtifactRequest = async (url, init) => url.endsWith('release.json')
      ? base(url, init)
      : new Response(new ReadableStream<Uint8Array>({ pull() { reading() }, cancel }))
    const download = downloadDesktopUpdate({ platform: 'darwin', version: '2.3.0',
      destinationPath: join(directory, 'update.dmg'), request, signal: controller.signal })
    const rejected = expect(download).rejects.toMatchObject({ code: 'aborted' })
    await ready
    controller.abort()
    await rejected
    expect(cancel).toHaveBeenCalledOnce()
    expect(await readdir(directory)).toEqual([])
  })

  it('rejects a conflicting Content-Length and cancels the unconsumed body', async () => {
    const directory = await temp()
    const cancel = vi.fn()
    const base = requestFor('2.3.0', { darwin: dmg(), win32: exe() })
    const request: UpdateArtifactRequest = async (url, init) => url.endsWith('release.json')
      ? base(url, init)
      : new Response(new ReadableStream<Uint8Array>({ cancel }), { headers: { 'content-length': '1025' } })
    await expect(downloadDesktopUpdate({ platform: 'darwin', version: '2.3.0',
      destinationPath: join(directory, 'update.dmg'), request })).rejects.toMatchObject({ code: 'invalid-artifact' })
    expect(cancel).toHaveBeenCalledOnce()
    expect(await readdir(directory)).toEqual([])
  })

  it('atomically replaces an existing installer after validation', async () => {
    const directory = await temp()
    const destinationPath = join(directory, 'update.dmg')
    await writeFile(destinationPath, 'previous installer')
    await downloadDesktopUpdate({ platform: 'darwin', version: '2.3.0', destinationPath,
      request: requestFor('2.3.0', { darwin: dmg(), win32: exe() }) })
    expect(await readFile(destinationPath)).toEqual(dmg())
    expect(await readdir(directory)).toEqual(['update.dmg'])
  })

  it('retains and resolves a completed installer after the new version starts', async () => {
    const data = await temp(); const path = join(data, 'ClawClaw-2.4.0-windows.exe'); await writeFile(path, exe())
    await recordDesktopUpdateArtifact(data, { platform: 'win32', version: '2.4.0', path })
    await expect(pendingDesktopUpdateArtifact(data, '2.4.0', 'win32')).resolves.toMatchObject({ path })
    await resolveDesktopUpdateArtifact(data, { platform: 'win32', version: '2.4.0', path }, true)
    await expect(pendingDesktopUpdateArtifact(data, '2.4.0', 'win32')).resolves.toBeUndefined()
  })
})
