#!/usr/bin/env node
/** Wait for server-side publication, then verify the real public update downloads. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'

export const ORIGIN = 'https://clawclaw.xzinfra.com:9528'
export const FEED = `${ORIGIN}/updates/dsh/stable/release.json`

export async function verifyDeployment(manifest, provenance, options = {}) {
  const request = options.request ?? fetch
  const now = options.now ?? Date.now
  const pause = options.pause ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const deadline = now() + (options.timeoutMs ?? 18 * 60 * 1000)
  const version = manifest.version
  assert.match(version, /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u)
  assert.equal(manifest.channel, 'stable')
  assert.equal(provenance.version, version)
  assert.equal(provenance.repository, 'AngusFan-GH/ClawClaw')
  assert.match(provenance.commit, /^[0-9a-f]{40}$/u)
  for (const [platform, suffix] of [['darwin', 'universal.dmg'], ['win32', 'x64-Setup.exe']]) {
    assert.equal(manifest.artifacts[platform].url, `${ORIGIN}/releases/dsh/${version}/ClawClaw-${version}-${suffix}`)
  }
  const get = (url, init = {}) => request(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000), ...init })
  let last = 'not checked'
  let ready = false
  while (now() < deadline) {
    try {
      const response = await get(FEED)
      if (response.status === 200) {
        const text = await response.text()
        assert.ok(Buffer.byteLength(text) <= 16384)
        const live = JSON.parse(text)
        if (live.version === version) {
          assert.deepEqual(live, manifest, 'The same version is already published with different metadata')
          ready = true
          break
        }
        last = `server still advertises ${live.version}`
      } else last = `manifest HTTP ${response.status}`
    } catch (error) {
      if (error.code === 'ERR_ASSERTION') throw error
      last = error.message
    }
    console.log(`Waiting for server publication: ${last}`)
    await pause(20_000)
  }
  assert.ok(ready, `Timed out waiting for ${version}: ${last}`)
  const liveInfo = await get(`${ORIGIN}/releases/dsh/${version}/build-info.json`)
  assert.equal(liveInfo.status, 200)
  assert.ok(isDeepStrictEqual(await liveInfo.json(), provenance), 'Deployed build provenance differs from this workflow')
  for (const [platform, entry] of Object.entries(manifest.artifacts)) {
    assert.ok(Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= 1024 ** 3)
    const response = await get(entry.url, { signal: AbortSignal.timeout(10 * 60 * 1000) })
    assert.equal(response.status, 200)
    const hash = createHash('sha512')
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.byteLength
      assert.ok(size <= entry.size, 'Download exceeds the declared installer size')
      hash.update(chunk)
    }
    assert.equal(size, entry.size)
    assert.equal(hash.digest('base64'), entry.sha512, `${platform} installer SHA-512 mismatch`)
    for (const start of new Set([0, Math.max(0, size - 65536)])) {
      const end = Math.min(size - 1, start + 65535)
      const range = await get(entry.url, { headers: { Range: `bytes=${start}-${end}` } })
      assert.equal(range.status, 206)
      assert.equal(range.headers.get('content-range'), `bytes ${start}-${end}/${size}`)
      assert.equal((await range.arrayBuffer()).byteLength, end - start + 1)
    }
    console.log(`${platform}: public HTTPS, full size, SHA-512 and Range verified`)
  }
  console.log(`Formal ${version} deployment verified at ${FEED}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2]
  assert.ok(directory, 'Usage: node scripts/wait-for-update.mjs <release-metadata-directory>')
  const manifest = JSON.parse(await readFile(`${directory}/release.json`, 'utf8'))
  const provenance = JSON.parse(await readFile(`${directory}/build-info.json`, 'utf8'))
  assert.equal(provenance.commit, process.env.GITHUB_SHA, 'Release does not come from this workflow commit')
  await verifyDeployment(manifest, provenance)
}
