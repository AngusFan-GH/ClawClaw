import { describe, expect, it, vi } from 'vitest'
import {
  CLAWCLAW_UPDATE_BASE_URL,
  checkForDesktopUpdate,
  checkForStableUpdate,
  desktopReleaseManifestUrl,
  fetchDesktopReleaseManifest,
  MAX_VERSION_RESPONSE_BYTES,
} from '../src/update-checker.ts'

const sha512 = Buffer.alloc(64, 7).toString('base64')
function manifest(version: string, channel: 'stable' | 'beta' = 'stable'): Response {
  return Response.json({ version, channel, artifacts: {
    darwin: { url: `https://clawclaw.xzinfra.com/releases/${channel}/ClawClaw-${version}.dmg`, sha512, size: 1024 },
    win32: { url: `https://clawclaw.xzinfra.com/releases/${channel}/ClawClaw-${version}.exe`, sha512, size: 1024 },
  } })
}

describe('ClawClaw release manifest', () => {
  it('uses isolated static manifest URLs for stable and beta', () => {
    expect(CLAWCLAW_UPDATE_BASE_URL).toBe('https://clawclaw.xzinfra.com/updates')
    expect(desktopReleaseManifestUrl('stable')).toBe('https://clawclaw.xzinfra.com/updates/stable/release.json')
    expect(desktopReleaseManifestUrl('beta')).toBe('https://clawclaw.xzinfra.com/updates/beta/release.json')
  })

  it('checks a newer stable release without sending installation identifiers', async () => {
    const request = vi.fn(async (_url: string, _init: RequestInit) => manifest('2.1.0'))
    await expect(checkForStableUpdate({ currentVersion: '2.0.0', request })).resolves.toEqual({
      status: 'update-available', currentVersion: '2.0.0', latestVersion: '2.1.0',
    })
    expect(request.mock.calls[0]![0]).toBe(desktopReleaseManifestUrl('stable'))
    expect([...new Headers(request.mock.calls[0]![1].headers).entries()]).toEqual([])
  })

  it('keeps beta releases isolated', async () => {
    await expect(checkForDesktopUpdate({ currentVersion: '2.0.0-beta.1', channel: 'beta', request: async () => manifest('2.0.0-beta.2', 'beta') })).resolves.toMatchObject({ status: 'update-available' })
    await expect(checkForDesktopUpdate({ currentVersion: '2.0.0-beta.1', channel: 'beta', request: async () => manifest('2.0.0', 'stable') })).resolves.toBeNull()
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
})
