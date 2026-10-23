import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { FEED, ORIGIN, verifyDeployment } from './wait-for-update.mjs'

function fixture() {
  const content = { darwin: Buffer.from('dmg'), win32: Buffer.from('exe') }
  const manifest = { version: '0.2.12', channel: 'stable', artifacts: Object.fromEntries(Object.entries(content).map(([platform, data]) => [platform, {
    url: `${ORIGIN}/releases/dsh/0.2.12/ClawClaw-0.2.12-${platform === 'darwin' ? 'universal.dmg' : 'x64-Setup.exe'}`,
    size: data.length, sha512: createHash('sha512').update(data).digest('base64'),
  }])) }
  const info = { version: '0.2.12', repository: 'AngusFan-GH/ClawClaw', commit: 'a'.repeat(40) }
  const request = async (url, init) => {
    assert.equal(init.redirect, 'error')
    assert.equal(init.cache, 'no-store')
    if (url === FEED) return Response.json(manifest)
    if (url.endsWith('build-info.json')) return Response.json(info)
    const platform = url.endsWith('.dmg') ? 'darwin' : 'win32'
    const data = content[platform]
    if (init.headers?.Range) return new Response(data, { status: 206, headers: { 'content-range': `bytes 0-${data.length - 1}/${data.length}` } })
    return new Response(data)
  }
  return { manifest, info, content, request }
}

test('waits for a stale feed, verifies provenance and complete downloads', async () => {
  const f = fixture(); let ticks = 0
  await verifyDeployment(f.manifest, f.info, { now: () => ticks, pause: async ms => { ticks += ms }, request: async (url, init) => {
    if (url === FEED && ticks === 0) return Response.json({ version: '0.2.11' })
    return f.request(url, init)
  } })
  assert.equal(ticks, 20000)
})

test('refuses same-version different metadata without waiting forever', async () => {
  const f = fixture()
  await assert.rejects(verifyDeployment(f.manifest, f.info, { request: async () => Response.json({ ...f.manifest, artifacts: {} }) }), /different metadata/)
})

test('refuses a mismatched deployed build', async () => {
  const f = fixture()
  await assert.rejects(verifyDeployment(f.manifest, f.info, { request: async (url, init) => url.endsWith('build-info.json') ? Response.json({ ...f.info, commit: 'b'.repeat(40) }) : f.request(url, init) }), /provenance/)
})

test('detects wrong bytes with an unchanged size', async () => {
  const f = fixture()
  await assert.rejects(verifyDeployment(f.manifest, f.info, { request: async (url, init) => url.endsWith('.dmg') ? new Response('bad') : f.request(url, init) }), /SHA-512 mismatch/)
})

test('rejects trial URLs before making any requests', async () => {
  const f = fixture(); f.manifest.artifacts.darwin.url = `${ORIGIN}/releases/dsh/trials/42/package.dmg`
  await assert.rejects(verifyDeployment(f.manifest, f.info, { request: () => { throw new Error('must not request') } }), /Expected values/)
})

test('times out rather than treating an old manifest as deployed', async () => {
  const f = fixture(); let ticks = 0
  await assert.rejects(verifyDeployment(f.manifest, f.info, { timeoutMs: 100, now: () => ticks, pause: async ms => { ticks += ms }, request: async () => Response.json({ version: '0.2.11' }) }), /Timed out/)
})
