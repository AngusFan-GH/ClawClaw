#!/usr/bin/env node
/** Deploy the internal download dashboard from a local checkout over verified SSH. */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
export const PAGE_FILES = ['index.html', 'dashboard.css', 'dashboard.js']
export const HELP = `Usage: corepack pnpm deploy:stats [--page-only] [--dry-run]
Default: update collector, dashboard, Nginx configuration and timer.
--page-only  Update dashboard assets only.
--dry-run    Print the plan without connecting or changing the server.
Optional .env.server.local settings:
STATS_DEPLOY_HOST=192.168.103.220
STATS_DEPLOY_USER=root
STATS_DEPLOY_PORT=22
STATS_DEPLOY_SSH_KEY_FILE=/absolute/path/to/admin-key
STATS_DEPLOY_SSH_KNOWN_HOSTS_FILE=/absolute/path/to/known_hosts
Non-root administrators need passwordless sudo. Existing SSH config/agent works.
`
export function settings(args, env = process.env) {
  if (args.some(arg => !['--page-only', '--dry-run', '--help'].includes(arg))) throw Error(HELP)
  const host = env.STATS_DEPLOY_HOST ?? env.UPDATE_HOST ?? '192.168.103.220'
  const user = env.STATS_DEPLOY_USER ?? 'root'
  const port = env.STATS_DEPLOY_PORT ?? '22'
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host)) throw Error('Invalid STATS_DEPLOY_HOST')
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(user)) throw Error('Invalid STATS_DEPLOY_USER')
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw Error('Invalid STATS_DEPLOY_PORT')
  return { host, user, port, pageOnly: args.includes('--page-only'), dryRun: args.includes('--dry-run'),
    identityFile: env.STATS_DEPLOY_SSH_KEY_FILE, knownHostsFile: env.STATS_DEPLOY_SSH_KNOWN_HOSTS_FILE }
}
export const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`
export function sshArgs(options) {
  return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-p', options.port,
    ...(options.identityFile ? ['-o', 'IdentitiesOnly=yes', '-i', options.identityFile] : []),
    ...(options.knownHostsFile ? ['-o', `UserKnownHostsFile=${options.knownHostsFile}`] : []), `${options.user}@${options.host}`]
}
export function remoteScript(stage, pageOnly) {
  if (!/^\/tmp\/clawclaw-stats\.[a-zA-Z0-9]+$/.test(stage)) throw Error('Unexpected remote staging path')
  return `set -euo pipefail
stage=${quote(stage)}
trap 'rm -rf -- "$stage"' EXIT
test "$(id -u)" = 0
backup=$(mktemp -d /etc/clawclaw/stats-deploy-backup.XXXXXXXX)
echo "Backup: $backup"
report=/var/lib/clawclaw-download-stats/report
files=(var/lib/clawclaw-download-stats/report/index.html var/lib/clawclaw-download-stats/report/dashboard.css var/lib/clawclaw-download-stats/report/dashboard.js opt/clawclaw-download-stats/download-stats.py etc/nginx/conf.d/clawclaw.conf etc/nginx/conf.d/00-clawclaw-download-log.conf etc/nginx/conf.d/clawclaw-download-report.conf etc/logrotate.d/clawclaw-downloads etc/systemd/system/clawclaw-download-stats.service etc/systemd/system/clawclaw-download-stats.timer)
existing=()
for file in "\u0024{files[@]}"; do if test -f "/$file"; then existing+=("$file"); fi; done
if test "\u0024{#existing[@]}" -gt 0; then tar -czf "$backup/files.tgz" -C / "\u0024{existing[@]}"; fi
${pageOnly ? `test -d "$report"
for name in index.html dashboard.css dashboard.js; do
  install -m 644 "$stage/deploy/download-stats/$name" "$report/$name"
done` : `bash "$stage/deploy/download-stats/install.sh"
systemctl start clawclaw-download-stats.service
systemctl is-active --quiet clawclaw-download-stats.timer`}
for resource in / /dashboard.css /dashboard.js /stats.json; do
  curl --noproxy '*' -fsS --connect-timeout 5 --max-time 15 "http://127.0.0.1:9529$resource" -o /dev/null
done
curl --noproxy '*' -fsS --connect-timeout 5 --max-time 15 http://127.0.0.1:9529/stats.json | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["schema"] == 1 and isinstance(d["rows"], list); print("Report updated:", d["generatedAt"])'
echo 'Deployment and HTTP verification completed.'
`
}
export function deploy(options, run = execFileSync) {
  const files = options.pageOnly ? PAGE_FILES.map(name => `deploy/download-stats/${name}`)
    : ['scripts/download-stats.py', ...readdirSync(resolve(ROOT, 'deploy/download-stats'), { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => `deploy/download-stats/${entry.name}`)]
  for (const file of files) if (!existsSync(resolve(ROOT, file))) throw Error(`Missing deployment file: ${file}`)
  for (const file of [options.identityFile, options.knownHostsFile].filter(Boolean)) if (!existsSync(file)) throw Error(`SSH file missing: ${file}`)
  console.log(`Mode: ${options.pageOnly ? 'dashboard only' : 'full installation/update'}`)
  console.log(`Target: ${options.user}@${options.host}:${options.port}; ${files.length} files`)
  if (options.dryRun) { console.log(files.join('\n')); console.log('Dry run: no server connection or changes.'); return }
  run(process.execPath, ['--check', resolve(ROOT, 'deploy/download-stats/dashboard.js')], { stdio: 'inherit' })
  if (!options.pageOnly) {
    run('python3', [resolve(ROOT, 'scripts/download-stats.test.py')], { stdio: 'inherit' })
    run('bash', ['-n', resolve(ROOT, 'deploy/download-stats/install.sh')], { stdio: 'inherit' })
  }
  const ssh = sshArgs(options)
  const privilege = options.user === 'root' ? '' : 'sudo -n '
  run('ssh', [...ssh, `${privilege}sh -c 'test "$(id -u)" = 0 && command -v python3 >/dev/null && command -v curl >/dev/null && test -d /etc/clawclaw'`], { stdio: 'inherit' })
  const stage = run('ssh', [...ssh, 'umask 077; mktemp -d /tmp/clawclaw-stats.XXXXXXXX'], { encoding: 'utf8' }).trim()
  if (!/^\/tmp\/clawclaw-stats\.[a-zA-Z0-9]+$/.test(stage)) throw Error('Unexpected remote staging path')
  try {
    const archive = run('tar', [...(process.platform === 'darwin' ? ['--no-xattrs'] : []), '-C', ROOT, '-czf', '-', ...files],
      { env: { ...process.env, COPYFILE_DISABLE: '1' }, maxBuffer: 16 * 1024 * 1024 })
    run('ssh', [...ssh, `tar -xzf - -C ${quote(stage)}`], { input: archive, stdio: ['pipe', 'inherit', 'inherit'] })
    run('ssh', [...ssh, `${privilege}bash -s`], { input: remoteScript(stage, options.pageOnly), stdio: ['pipe', 'inherit', 'inherit'] })
    console.log('View on the company network: http://192.168.103.220:9529/')
  } finally {
    run('ssh', [...ssh, `${privilege}rm -rf -- ${quote(stage)}`], { stdio: 'inherit' })
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--help')) console.log(HELP)
    else deploy(settings(process.argv.slice(2)))
  } catch (error) { console.error(`[deploy:stats] ${error.message}`); process.exitCode = 1 }
}
