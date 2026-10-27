import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deploy, settings, sshArgs, remoteScript, quote, render, runtimeEnv } from './deploy-download-stats.mjs'

const fixture = {
  STATS_DEPLOY_HOST: 'stats.example.invalid', STATS_DEPLOY_USER: 'testadmin',
  STATS_PROGRAM_DIR: '/srv/stats-fixture/program', STATS_DATA_DIR: '/srv/stats-fixture/data',
  STATS_LOG_DIR: '/srv/stats-fixture/logs', STATS_BACKUP_DIR: '/srv/stats-fixture/backups',
  STATS_NGINX_CONFIG: '/srv/stats-fixture/nginx/download.conf', STATS_ACCESS_LOG: '/srv/stats-fixture/access.log',
  STATS_BIND_ADDRESS: '10.20.30.40', STATS_HTTP_PORT: '19529', STATS_ALLOWED_CIDRS: '10.20.0.0/16',
}
const options = (args = [], changes = {}) => settings(args, { ...fixture, ...changes })

test('requires explicit local settings and never reuses release credentials', () => {
  for (const key of Object.keys(fixture)) assert.throws(() => options([], { [key]: '' }), /Configure/)
  assert.throws(() => settings([], { UPDATE_HOST: 'release.example.invalid', UPDATE_USER: 'release' }), /STATS_DEPLOY_HOST/)
  assert.equal(options([], { UPDATE_USER: 'release', UPDATE_SSH_KEY_FILE: '/release/key' }).identityFile, undefined)
  for (const changes of [{ STATS_DEPLOY_HOST: '-oProxyCommand=bad' }, { STATS_DEPLOY_USER: 'admin;id' }, { STATS_DEPLOY_PORT: '0' }, { STATS_DEPLOY_PORT: '65536' }, { STATS_PROGRAM_DIR: '/srv/../etc' }, { STATS_DATA_DIR: '/' }, { STATS_BIND_ADDRESS: '0.0.0.0' }, { STATS_ALLOWED_CIDRS: '10.0.0.0/0' }, { STATS_LOG_DIR: '/srv/x;id' }]) assert.throws(() => options([], changes))
  assert.throws(() => options(['--page-onyl']))
})
test('preserves strict fingerprint verification and explicit identity', () => {
  const args = sshArgs({ ...options(), identityFile: '/admin key', knownHostsFile: '/known hosts' })
  assert.ok(args.includes('StrictHostKeyChecking=yes'))
  assert.ok(args.includes('IdentitiesOnly=yes'))
  assert.ok(args.includes('/admin key'))
  assert.ok(args.includes('UserKnownHostsFile=/known hosts'))
})
test('dry run never invokes commands or connects', () => {
  deploy(options(['--dry-run']), () => { throw Error('Unexpected command') })
})
test('renders local configuration while preserving native Nginx variables', () => {
  const result = render('root @@STATS_REPORT_DIR@@; return $uri; @@STATS_ALLOW_RULES@@', options().values)
  assert.match(result, /root \/srv\/stats-fixture\/data\/report;/)
  assert.match(result, /return \$uri;/)
  assert.match(result, /allow 10\.20\.0\.0\/16;/)
  assert.throws(() => render('@@MISSING@@', {}), /Missing template/)
  const env = runtimeEnv({ ...options(), identityFile: '/secret/key' })
  assert.doesNotMatch(env, /secret|testadmin|STATS_DEPLOY_HOST/)
  execFileSync('bash', ['-n'], { input: env })
})
test('generated scripts use configured paths and pass bash syntax checks', () => {
  for (const pageOnly of [true, false]) {
    const script = remoteScript('/tmp/clawclaw-stats.ABC123', { ...options(), pageOnly })
    execFileSync('bash', ['-n'], { input: script })
    assert.match(script, /files.tgz/)
    assert.match(script, /STATS_REPORT_DIR='\/srv\/stats-fixture\/data\/report'/)
    assert.equal(script.includes('bash "$stage/deploy/download-stats/install.sh"'), !pageOnly)
    assert.doesNotMatch(script, /ip-hmac|downloads.sqlite/)
  }
  assert.throws(() => remoteScript('/tmp/anything;id', options()))
  assert.equal(execFileSync('bash', ['-c', `printf %s ${quote("a'b $c")}`], { encoding: 'utf8' }), "a'b $c")
})
test('uploads rendered allowlisted files, excludes local credentials and cleans render directory', () => {
  const calls = []; let local
  deploy(options(), (command, args, config) => {
    calls.push({ command, args, config })
    if (args.at(-1)?.includes('mktemp -d /tmp/')) return '/tmp/clawclaw-stats.ABC123\n'
    if (command === 'tar') {
      local = args[args.indexOf('-C') + 1]
      const nginx = readFileSync(join(local, 'deploy/download-stats/nginx-report.conf'), 'utf8')
      assert.match(nginx, /listen 10\.20\.30\.40:19529;/)
      assert.doesNotMatch(nginx, /@@/)
      assert.ok(args.includes('runtime.env'))
      assert.ok(!args.includes('.env.server.local'))
    }
    return Buffer.from('archive')
  })
  assert.equal(existsSync(local), false)
  assert.match(calls.find(call => call.args.at(-1) === 'sudo -n bash -s').config.input, /Deployment and HTTP verification/)
  assert.match(calls.at(-1).args.at(-1), /^sudo -n rm -rf/)
})
test('page-only mode uploads three assets; failed verification still cleans staging', () => {
  let cleaned = false
  assert.throws(() => deploy(options(['--page-only']), (command, args) => {
    if (args.at(-1)?.includes('mktemp -d /tmp/')) return '/tmp/clawclaw-stats.ABC123\n'
    if (command === 'tar') assert.ok(!args.includes('scripts/download-stats.py'))
    if (args.at(-1) === 'sudo -n bash -s') throw Error('verification failed')
    if (args.at(-1)?.startsWith('sudo -n rm -rf')) cleaned = true
    return Buffer.from('archive')
  }), /verification failed/)
  assert.equal(cleaned, true)
})
