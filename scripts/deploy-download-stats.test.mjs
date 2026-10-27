import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { deploy, settings, sshArgs, remoteScript, quote } from './deploy-download-stats.mjs'

test('defaults to administrative SSH without reusing restricted release credentials', () => {
  const options = settings([], { UPDATE_HOST: '192.168.103.220', UPDATE_USER: 'clawclaw-release', UPDATE_SSH_KEY_FILE: '/release/key' })
  assert.equal(options.user, 'root')
  assert.equal(options.identityFile, undefined)
  assert.equal(options.host, '192.168.103.220')
  assert.equal(settings(['--page-only', '--dry-run'], {}).pageOnly, true)
  for (const env of [{ STATS_DEPLOY_HOST: '-oProxyCommand=bad' }, { STATS_DEPLOY_USER: 'root;id' }, { STATS_DEPLOY_PORT: '0' }, { STATS_DEPLOY_PORT: '65536' }]) assert.throws(() => settings([], env))
  assert.throws(() => settings(['--page-onyl'], {}))
})
test('preserves host fingerprint checks and explicit administrative identity', () => {
  const args = sshArgs({ ...settings([], {}), identityFile: '/admin key', knownHostsFile: '/known hosts' })
  assert.ok(args.includes('StrictHostKeyChecking=yes'))
  assert.ok(args.includes('IdentitiesOnly=yes'))
  assert.ok(args.includes('/admin key'))
  assert.ok(args.includes('UserKnownHostsFile=/known hosts'))
})
test('dry run never invokes commands or connects to the server', () => {
  deploy(settings(['--dry-run'], {}), () => { throw Error('Unexpected command') })
})
test('both generated modes pass bash syntax checks and protect state', () => {
  for (const pageOnly of [true, false]) {
    const script = remoteScript('/tmp/clawclaw-stats.ABC123', pageOnly)
    execFileSync('bash', ['-n'], { input: script })
    assert.match(script, /files.tgz/)
    assert.match(script, /curl --noproxy/)
    assert.match(script, /trap.*EXIT/)
    assert.equal(script.includes('bash "$stage/deploy/download-stats/install.sh"'), !pageOnly)
    assert.doesNotMatch(script, /ip-hmac|downloads.sqlite/)
  }
  assert.throws(() => remoteScript('/tmp/anything;id', false))
  assert.equal(execFileSync('bash', ['-c', `printf %s ${quote("a'b $c")}`], { encoding: 'utf8' }), "a'b $c")
})
test('page deployment sends only assets, verifies remotely and cleans temporary source', () => {
  const calls = []
  deploy(settings(['--page-only'], {}), (command, args, options) => {
    calls.push({ command, args, options })
    if (args.at(-1)?.includes('mktemp -d /tmp/')) return '/tmp/clawclaw-stats.ABC123\n'
    return Buffer.from('archive')
  })
  const archive = calls.find(call => call.command === 'tar')
  assert.ok(archive.args.includes('deploy/download-stats/index.html'))
  assert.ok(!archive.args.includes('scripts/download-stats.py'))
  assert.match(calls.find(call => call.args.at(-1) === 'bash -s').options.input, /Deployment and HTTP verification/)
  assert.match(calls.at(-1).args.at(-1), /^rm -rf -- '\/tmp\/clawclaw-stats\./)
})
test('a failed remote install remains a failure and still cleans staging', () => {
  let cleaned = false
  assert.throws(() => deploy(settings(['--page-only'], {}), (command, args) => {
    if (args.at(-1)?.includes('mktemp -d /tmp/')) return '/tmp/clawclaw-stats.ABC123\n'
    if (args.at(-1) === 'bash -s') throw Error('verification failed')
    if (args.at(-1)?.startsWith('rm -rf')) cleaned = true
    return Buffer.from('archive')
  }), /verification failed/)
  assert.equal(cleaned, true)
})
