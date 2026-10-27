#!/usr/bin/env node
/** Publish the two generic installation PDFs without touching installers or release feeds. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { quote } from './deploy-download-stats.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const env = process.env
const required = name => {
  const value = env[name]
  if (!value || /[\r\n]/.test(value)) throw Error(`Configure ${name} in .env.server.local`)
  return value
}
const host = required('UPDATE_HOST'), user = required('UPDATE_SSH_ADMIN_USER')
const port = env.UPDATE_PORT ?? '22'
if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(host) || !/^[a-z_][a-z0-9_-]*$/.test(user)
  || !/^\d+$/.test(port)) throw Error('Invalid deployment host, user, or port')
const remoteRoot = required('UPDATE_REMOTE_ROOT')
const config = env.DOCS_NGINX_CONFIG ?? required('STATS_NGINX_CONFIG')
for (const path of [remoteRoot, config]) {
  if (!/^\/[A-Za-z0-9_./-]+$/.test(path) || path.split('/').includes('..') || path === '/') throw Error('Invalid remote path')
}
const baseURL = new URL(required('UPDATE_BASE_URL'))
if (baseURL.protocol !== 'https:' || baseURL.pathname !== '/' || baseURL.username || baseURL.password) throw Error('Expected a bare HTTPS origin')
const ssh = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-p', port,
  ...((env.DOCS_SSH_KEY_FILE ?? env.STATS_DEPLOY_SSH_KEY_FILE) ? ['-o', 'IdentitiesOnly=yes', '-i', env.DOCS_SSH_KEY_FILE ?? env.STATS_DEPLOY_SSH_KEY_FILE] : []),
  ...((env.DOCS_SSH_KNOWN_HOSTS_FILE ?? env.STATS_DEPLOY_SSH_KNOWN_HOSTS_FILE) ? ['-o', `UserKnownHostsFile=${env.DOCS_SSH_KNOWN_HOSTS_FILE ?? env.STATS_DEPLOY_SSH_KNOWN_HOSTS_FILE}`] : []), `${user}@${host}`]
const remote = (command, options = {}) => execFileSync('ssh', [...ssh, command], { encoding: 'utf8', ...options })
const files = [['windows', 'Windows'], ['macos', 'macOS']].map(([platform, label]) => {
  const path = join(root, 'output/pdf', `ClawClaw-${label}-安装说明.pdf`)
  const bytes = readFileSync(path)
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw Error(`Not a PDF: ${path}`)
  return { platform, path, name: `install-${platform}.pdf`, sha: createHash('sha256').update(bytes).digest('hex') }
})
const template = readFileSync(join(root, 'deploy/clawclaw-internal.nginx.conf'), 'utf8')
const block = template.match(/    # BEGIN ClawClaw installation guides\n[\s\S]*?    # END ClawClaw installation guides\n/)[0]
  .replaceAll('@@UPDATE_REMOTE_ROOT@@', remoteRoot)
if (process.argv.includes('--dry-run')) {
  console.log('Validated both PDFs. Would publish /docs/install-windows.pdf and /docs/install-macos.pdf with inline/download headers and cache revalidation.')
  process.exit(0)
}
if (process.argv.slice(2).length) throw Error('Usage: corepack pnpm deploy:docs [--dry-run]')
const local = mkdtempSync(join(tmpdir(), 'clawclaw-docs-'))
let stage
try {
  stage = remote('umask 077; mktemp -d /tmp/clawclaw-docs.XXXXXXXX').trim()
  if (!/^\/tmp\/clawclaw-docs\.[A-Za-z0-9]+$/.test(stage)) throw Error('Unexpected staging path')
  for (const file of files) copyFileSync(file.path, join(local, file.name))
  writeFileSync(join(local, 'locations.conf'), block)
  writeFileSync(join(local, 'SHA256SUMS'), files.map(file => `${file.sha}  ${file.name}`).join('\n') + '\n')
  const archive = execFileSync('tar', ['-czf', '-', '-C', local, ...files.map(file => file.name), 'locations.conf', 'SHA256SUMS'],
    { env: { ...env, COPYFILE_DISABLE: '1' } })
  remote(`tar -xzf - -C ${quote(stage)}`, { input: archive })
  const script = `set -euo pipefail
stage=${quote(stage)}
root=${quote(remoteRoot)}
config=${quote(config)}
test "$(id -u)" = 0
cd "$stage"
sha256sum -c SHA256SUMS
test -f "$config"
backup=$(mktemp -d /etc/clawclaw/installation-docs.XXXXXXXX)
cp -p "$config" "$backup/nginx.conf"
for name in install-windows.pdf install-macos.pdf; do
  if test -f "$root/docs/$name"; then cp -p "$root/docs/$name" "$backup/$name"; fi
done
rollback() {
  cp -p "$backup/nginx.conf" "$config"
  for name in install-windows.pdf install-macos.pdf; do
    if test -f "$backup/$name"; then cp -p "$backup/$name" "$root/docs/$name"; else rm -f "$root/docs/$name"; fi
  done
  nginx -t && systemctl reload nginx
}
trap 'rollback' ERR
install -d -m 755 "$root/docs"
for name in install-windows.pdf install-macos.pdf; do
  install -m 644 "$stage/$name" "$root/docs/$name.next"
  mv "$root/docs/$name.next" "$root/docs/$name"
done
python3 - "$config" "$stage/locations.conf" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text();block=Path(sys.argv[2]).read_text()
pattern=r'    # BEGIN ClawClaw installation guides\\n[\\s\\S]*?    # END ClawClaw installation guides\\n'
if re.search(pattern,s): s=re.sub(pattern,lambda _:block,s)
else:
    assert 'location = /docs/install-' not in s, 'Existing unmanaged guide routes require review'
    end=s.rfind('}')
    assert end>0 and not s[end+1:].strip(), 'Unexpected nginx config layout'
    s=s[:end]+block+'\\n'+s[end:]
p.write_text(s)
PY
nginx -t
systemctl reload nginx
for name in install-windows.pdf install-macos.pdf; do
  for query in '' '?download=1'; do
    for attempt in 1 2 3 4 5; do
      if curl --noproxy '*' -fsS --max-time 15 --resolve '${baseURL.hostname}:${baseURL.port || 443}:127.0.0.1' '${baseURL.origin}/docs/'"$name$query" -o /dev/null; then break; fi
      test "$attempt" -lt 5
      sleep 1
    done
  done
done
trap - ERR
printf 'Installation PDFs deployed. Backup: %s\\n' "$backup"
`
  console.log(remote(`${user === 'root' ? '' : 'sudo -n '}bash -s`, { input: script, stdio: ['pipe', 'pipe', 'pipe'] }))
  for (const file of files) {
    for (const query of ['', '?download=1']) {
      const response = await fetch(`${baseURL.origin}/docs/${file.name}${query}`, { signal: AbortSignal.timeout(20000) })
      if (!response.ok || !response.headers.get('content-type')?.startsWith('application/pdf')
        || !response.headers.get('content-disposition')?.startsWith(query ? 'attachment;' : 'inline;')
        || !response.headers.get('cache-control')?.includes('no-cache')) throw Error(`PDF response verification failed: ${file.name}${query}`)
      const sha = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')
      if (sha !== file.sha) throw Error(`PDF download hash mismatch: ${file.name}`)
    }
    console.log(`Verified HTTPS, PDF headers, preview/download, and SHA-256: ${file.name}`)
  }
} finally {
  rmSync(local, { recursive: true, force: true })
  if (stage) remote(`rm -rf -- ${quote(stage)}`)
}
