#!/usr/bin/env node
/** Deploy using ignored local environment settings; tracked files are templates only. */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isIP } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('../', import.meta.url))
export const PAGE_FILES = ['index.html', 'dashboard.css', 'dashboard.js']
const SERVER_FILES = ['clawclaw-download-stats.service', 'clawclaw-download-stats.timer', 'install.sh', 'logrotate.conf', 'nginx-log.conf', 'nginx-report.conf']
const PATH_KEYS = ['PROGRAM_DIR', 'DATA_DIR', 'LOG_DIR', 'BACKUP_DIR', 'NGINX_CONFIG', 'ACCESS_LOG']
export const HELP = `Usage: corepack pnpm deploy:stats [--page-only] [--dry-run]
Copy .env.server.example to ignored .env.server.local and configure all STATS_* values.
No host, administrator or deployment-directory defaults are stored in the repository.
--page-only  Update dashboard assets only.
--dry-run    Print the plan without connecting or changing the server.
Existing SSH config/agent works; non-root administrators need passwordless sudo.
`
export const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`
function required(env, name) {
  const value = env[name]
  if (!value || /[<>\r\n]/.test(value)) throw Error(`Configure ${name} in .env.server.local`)
  return value
}
export function settings(args, env = process.env) {
  if (args.some(arg => !['--page-only', '--dry-run', '--help'].includes(arg))) throw Error(HELP)
  const host = required(env, 'STATS_DEPLOY_HOST'), user = required(env, 'STATS_DEPLOY_USER')
  const port = env.STATS_DEPLOY_PORT ?? '22'
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host)) throw Error('Invalid STATS_DEPLOY_HOST')
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(user)) throw Error('Invalid STATS_DEPLOY_USER')
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw Error('Invalid STATS_DEPLOY_PORT')
  const values = {}
  for (const key of PATH_KEYS) {
    const name = 'STATS_' + key, value = required(env, name)
    if (!/^\/[A-Za-z0-9_./-]+$/.test(value) || value.split('/').includes('..') || value === '/') throw Error(`Invalid ${name}`)
    values[name] = value.replace(/\/$/, '')
  }
  values.STATS_BIND_ADDRESS = required(env, 'STATS_BIND_ADDRESS')
  if (isIP(values.STATS_BIND_ADDRESS) !== 4 || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(values.STATS_BIND_ADDRESS)) throw Error('STATS_BIND_ADDRESS must be a private IPv4 address')
  values.STATS_HTTP_PORT = required(env, 'STATS_HTTP_PORT')
  if (!/^\d+$/.test(values.STATS_HTTP_PORT) || Number(values.STATS_HTTP_PORT) < 1 || Number(values.STATS_HTTP_PORT) > 65535) throw Error('Invalid STATS_HTTP_PORT')
  const cidrs = required(env, 'STATS_ALLOWED_CIDRS').split(',').map(value => value.trim())
  if (cidrs.some(value => { const [ip, bits, extra] = value.split('/'); return isIP(ip) !== 4 || !/^\d+$/.test(bits ?? '') || Number(bits) < 1 || Number(bits) > 32 || extra !== undefined })) throw Error('Invalid STATS_ALLOWED_CIDRS')
  values.STATS_ALLOW_RULES = cidrs.map(cidr => `    allow ${cidr};`).join('\n')
  values.STATS_PRIVATE_DIR = values.STATS_DATA_DIR + '/private'
  values.STATS_REPORT_DIR = values.STATS_DATA_DIR + '/report'
  values.STATS_NGINX_DIR = dirname(values.STATS_NGINX_CONFIG)
  return { host, user, port, values, pageOnly: args.includes('--page-only'), dryRun: args.includes('--dry-run'),
    identityFile: env.STATS_DEPLOY_SSH_KEY_FILE, knownHostsFile: env.STATS_DEPLOY_SSH_KNOWN_HOSTS_FILE }
}
export function render(text, values) {
  return text.replace(/@@([A-Z_]+)@@/g, (_, key) => {
    if (!(key in values)) throw Error(`Missing template value: ${key}`)
    return values[key]
  })
}
export function runtimeEnv(options) {
  return Object.entries(options.values).filter(([key]) => key !== 'STATS_ALLOW_RULES').map(([key, value]) => `export ${key}=${quote(value)}`).join('\n') + '\n'
}
export function sshArgs(options) {
  return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-p', options.port,
    ...(options.identityFile ? ['-o', 'IdentitiesOnly=yes', '-i', options.identityFile] : []),
    ...(options.knownHostsFile ? ['-o', `UserKnownHostsFile=${options.knownHostsFile}`] : []), `${options.user}@${options.host}`]
}
export function remoteScript(stage, options) {
  if (!/^\/tmp\/clawclaw-stats\.[a-zA-Z0-9]+$/.test(stage)) throw Error('Unexpected remote staging path')
  return `set -euo pipefail
${runtimeEnv(options)}
stage=${quote(stage)}
trap 'rm -rf -- "$stage"' EXIT
test "$(id -u)" = 0
install -d -m 700 "$STATS_BACKUP_DIR"
backup=$(mktemp -d "$STATS_BACKUP_DIR/stats-deploy-backup.XXXXXXXX")
echo "Backup: $backup"
report=$STATS_REPORT_DIR
files=("$report/index.html" "$report/dashboard.css" "$report/dashboard.js" "$STATS_PROGRAM_DIR/download-stats.py" "$STATS_NGINX_CONFIG" "$STATS_NGINX_DIR/00-clawclaw-download-log.conf" "$STATS_NGINX_DIR/clawclaw-download-report.conf" /etc/logrotate.d/clawclaw-downloads /etc/systemd/system/clawclaw-download-stats.service /etc/systemd/system/clawclaw-download-stats.timer)
existing=()
for file in "\u0024{files[@]}"; do if test -f "$file"; then existing+=("\u0024{file#/}"); fi; done
if test "\u0024{#existing[@]}" -gt 0; then tar -czf "$backup/files.tgz" -C / "\u0024{existing[@]}"; fi
${options.pageOnly ? `test -d "$report"
for name in index.html dashboard.css dashboard.js; do install -m 644 "$stage/deploy/download-stats/$name" "$report/$name"; done` : `bash "$stage/deploy/download-stats/install.sh"
systemctl start clawclaw-download-stats.service
systemctl is-active --quiet clawclaw-download-stats.timer`}
for resource in / /dashboard.css /dashboard.js /stats.json; do
  curl --noproxy '*' -fsS --connect-timeout 5 --max-time 15 "http://127.0.0.1:$STATS_HTTP_PORT$resource" -o /dev/null
done
curl --noproxy '*' -fsS --connect-timeout 5 --max-time 15 "http://127.0.0.1:$STATS_HTTP_PORT/stats.json" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["schema"] == 1 and isinstance(d["rows"], list); print("Report updated:", d["generatedAt"])'
echo 'Deployment and HTTP verification completed.'
`
}
export function deploy(options, run = execFileSync) {
  const files = [...PAGE_FILES, ...(options.pageOnly ? [] : SERVER_FILES)].map(name => `deploy/download-stats/${name}`)
  if (!options.pageOnly) files.push('scripts/download-stats.py')
  for (const file of files) if (!existsSync(resolve(ROOT, file))) throw Error(`Missing deployment file: ${file}`)
  for (const file of [options.identityFile, options.knownHostsFile].filter(Boolean)) if (!existsSync(file)) throw Error(`SSH file missing: ${file}`)
  console.log(`Mode: ${options.pageOnly ? 'dashboard only' : 'full installation/update'}`)
  console.log(`Target: ${options.user}@${options.host}:${options.port}; ${files.length} source files`)
  if (options.dryRun) { console.log(files.join('\n')); console.log('Dry run: no server connection or changes.'); return }
  run(process.execPath, ['--check', resolve(ROOT, 'deploy/download-stats/dashboard.js')], { stdio: 'inherit' })
  if (!options.pageOnly) {
    run('python3', [resolve(ROOT, 'scripts/download-stats.test.py')], { stdio: 'inherit' })
    run('bash', ['-n', resolve(ROOT, 'deploy/download-stats/install.sh')], { stdio: 'inherit' })
  }
  const ssh = sshArgs(options), privilege = options.user === 'root' ? '' : 'sudo -n '
  run('ssh', [...ssh, `${privilege}sh -c 'test "$(id -u)" = 0 && command -v python3 >/dev/null && command -v curl >/dev/null'`], { stdio: 'inherit' })
  const stage = run('ssh', [...ssh, 'umask 077; mktemp -d /tmp/clawclaw-stats.XXXXXXXX'], { encoding: 'utf8' }).trim()
  if (!/^\/tmp\/clawclaw-stats\.[a-zA-Z0-9]+$/.test(stage)) throw Error('Unexpected remote staging path')
  const local = mkdtempSync(join(tmpdir(), 'clawclaw-stats-render-'))
  try {
    for (const file of files) {
      const path = join(local, file)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, render(readFileSync(resolve(ROOT, file), 'utf8'), options.values), { mode: 0o600 })
    }
    writeFileSync(join(local, 'runtime.env'), runtimeEnv(options), { mode: 0o600 })
    const archive = run('tar', [...(process.platform === 'darwin' ? ['--no-xattrs'] : []), '-C', local, '-czf', '-', ...files, 'runtime.env'],
      { env: { ...process.env, COPYFILE_DISABLE: '1' }, maxBuffer: 16 * 1024 * 1024 })
    run('ssh', [...ssh, `tar -xzf - -C ${quote(stage)}`], { input: archive, stdio: ['pipe', 'inherit', 'inherit'] })
    run('ssh', [...ssh, `${privilege}bash -s`], { input: remoteScript(stage, options), stdio: ['pipe', 'inherit', 'inherit'] })
    console.log(`View on the company network: http://${options.values.STATS_BIND_ADDRESS}:${options.values.STATS_HTTP_PORT}/`)
  } finally {
    rmSync(local, { recursive: true, force: true })
    run('ssh', [...ssh, `${privilege}rm -rf -- ${quote(stage)}`], { stdio: 'inherit' })
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--help')) console.log(HELP)
    else deploy(settings(process.argv.slice(2)))
  } catch (error) { console.error(`[deploy:stats] ${error.message}`); process.exitCode = 1 }
}
