import { describe, expect, it, vi } from 'vitest'
import {
  CLAWCLAW_UPDATE_BASE_URL,
  checkForStableUpdate,
  desktopReleaseManifestUrl,
  fetchDesktopReleaseManifest,
  MAX_VERSION_RESPONSE_BYTES,
} from '../src/update-checker.ts'

const sha512 = Buffer.alloc(64, 7).toString('base64')
function manifest(version: string, channel: 'stable' = 'stable'): Response {
  return Response.json({ version, channel, artifacts: {
    darwin: { url: `https://clawclaw.xzinfra.com/releases/${channel}/ClawClaw-${version}.dmg`, sha512, size: 1024 },
    win32: { url: `https://clawclaw.xzinfra.com/releases/${channel}/ClawClaw-${version}.exe`, sha512, size: 1024 },
  } })
}

describe('ClawClaw release manifest', () => {
  it('uses the stable static manifest URL', () => {
    expect(CLAWCLAW_UPDATE_BASE_URL).toBe('https://clawclaw.xzinfra.com/updates')
    expect(desktopReleaseManifestUrl('stable')).toBe('https://clawclaw.xzinfra.com/updates/stable/release.json')
  })

  it('checks a newer stable release without sending installation identifiers', async () => {
    const request = vi.fn(async (_url: string, _init: RequestInit) => manifest('2.1.0'))
    await expect(checkForStableUpdate({ currentVersion: '2.0.0', request })).resolves.toEqual({
      status: 'update-available', currentVersion: '2.0.0', latestVersion: '2.1.0',
    })
    expect(request.mock.calls[0]![0]).toBe(desktopReleaseManifestUrl('stable'))
    expect([...new Headers(request.mock.calls[0]![1].headers).entries()]).toEqual([])
  })

  it('silently ignores network failure and caller cancellation', async () => {
    await expect(checkForStableUpdate({
      currentVersion: '2.0.0',
      request: async () => { throw new Error('offline') },
    })).resolves.toBeNull()

    const controller = new AbortController()
    controller.abort()
    const request = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBe(controller.signal)
      throw new DOMException('cancelled', 'AbortError')
    })
    await expect(checkForStableUpdate({
      currentVersion: '2.0.0', request, signal: controller.signal,
    })).resolves.toBeNull()
    expect(request).toHaveBeenCalledOnce()
  })

  it.each([
    [{ version: '2.1.0', channel: 'stable', artifacts: {} }],
    [{ version: '2.1.0', channel: 'stable', artifacts: { darwin: { url: 'http://bad.test/a', sha512, size: 1 }, win32: { url: 'https://ok.test/a', sha512, size: 1 } } }],
    [{ version: 'v2.1.0', channel: 'stable', artifacts: { darwin: { url: 'https://ok.test/a', sha512, size: 1 }, win32: { url: 'https://ok.test/b', sha512, size: 1 } } }],
  ])('rejects malformed manifests', async value => {
    await expect(fetchDesktopReleaseManifest('stable', async () => Response.json(value))).resolves.toBeNull()
  })

  it('rejects oversized manifest responses and invalid installed versions before comparison', async () => {
    await expect(fetchDesktopReleaseManifest('stable', async () => new Response('{}', { headers: { 'content-length': String(MAX_VERSION_RESPONSE_BYTES + 1) } }))).resolves.toBeNull()
    const request = vi.fn(async (_url: string, _init: RequestInit) => manifest('2.1.0'))
    await expect(checkForStableUpdate({ currentVersion: 'v2.0.0', request })).resolves.toBeNull()
    expect(request).not.toHaveBeenCalled()
  })

  it('silently ignores declared and streamed oversized responses', async () => {
    await expect(fetchDesktopReleaseManifest('stable', async () => new Response('{}', {
      headers: { 'content-length': String(MAX_VERSION_RESPONSE_BYTES + 1) },
    }))).resolves.toBeNull()
    await expect(fetchDesktopReleaseManifest('stable', async () => new Response(
      'x'.repeat(MAX_VERSION_RESPONSE_BYTES + 1),
    ))).resolves.toBeNull()
  })
  it('cancels a stalled manifest read when the caller aborts', async () => {
    const controller = new AbortController()
    let reading!: () => void
    const ready = new Promise<void>(resolve => { reading = resolve })
    const cancel = vi.fn()
    const request = async () => new Response(new ReadableStream<Uint8Array>({ pull() { reading() }, cancel }))
    const check = fetchDesktopReleaseManifest('stable', request, controller.signal)
    await ready
    controller.abort()
    await expect(check).resolves.toBeNull()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('cancels oversized manifest streams without consuming the remaining body', async () => {
    const cancel = vi.fn()
    const request = async () => new Response(new ReadableStream<Uint8Array>({
      start(stream) { stream.enqueue(new Uint8Array(MAX_VERSION_RESPONSE_BYTES + 1)) }, cancel,
    }))
    await expect(fetchDesktopReleaseManifest('stable', request)).resolves.toBeNull()
    expect(cancel).toHaveBeenCalledOnce()
  })

})
