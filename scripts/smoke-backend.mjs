/**
 * Standalone smoke test for the built ClawCore backend (dist-backend/entry.mjs).
 *
 * Spawns the backend over stdio with an isolated data directory, impersonates
 * the native keychain (secret:*) like the Tauri host would, and exercises the
 * allowlisted IPC surface. No real keychain, network or user data is touched.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const dataDir = await mkdtemp(join(tmpdir(), 'clawclaw-smoke-'));
await new Promise((resolve) => setTimeout(resolve, 50));

const child = spawn(process.execPath, [join(root, 'dist-backend', 'entry.mjs')], {
  cwd: root,
  env: { ...process.env, CLAWCLAW_DATA_DIR: dataDir, CLAWCLAW_APP_ROOT: root, CLAWCLAW_RESOURCES: join(root, 'resources'), CLAWCLAW_PACKAGED: '0' },
  stdio: ['pipe', 'pipe', 'pipe'],
});

const secrets = new Map();
let nextId = 1;
const pending = new Map();
let ready = false;
const failures = [];

function request(channel, ...args) {
  const id = String(nextId++);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ type: 'request', id, channel, args }) + '\n');
  });
}

function assert(condition, message) {
  if (condition) console.log(`  ✓ ${message}`);
  else { console.error(`  ✗ ${message}`); failures.push(message); }
}

function handleNative(message) {
  if (message.type !== 'native' || !message.command) return;
  const { id, command, payload = {} } = message;
  let result = null;
  if (command === 'secret:set') { secrets.set(payload.account, payload.value ?? null); result = undefined; }
  else if (command === 'secret:get') { result = secrets.has(payload.account) ? secrets.get(payload.account) : null; }
  else if (command === 'secret:delete') { secrets.delete(payload.account); result = undefined; }
  else if (command === 'dialog:open' || command === 'dialog:save') { result = { canceled: true, filePaths: [] }; }
  else if (command === 'app:request') { result = null; }
  else if (command.startsWith('window:') || command.startsWith('shell:')) { result = null; }
  child.stdin.write(JSON.stringify({ type: 'native_result', id, data: result }) + '\n');
}

const rl = createInterface({ input: child.stdout });
rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'native') { handleNative(message); return; }
  if (message.type === 'ready') { ready = true; return; }
  if (message.type === 'response') {
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    if (message.error) p.reject(new Error(message.error));
    else p.resolve(message.data);
  }
  if (message.type === 'event') {
    // core:run:event etc. — ignored by smoke
  }
});

createInterface({ input: child.stderr }).on('line', line => {
  if (process.env.SMOKE_DEBUG) console.error('[backend]', line);
});

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Backend did not become ready')), 15_000);
    const check = setInterval(() => { if (ready) { clearTimeout(timer); clearInterval(check); resolve(); } }, 50);
  });
  console.log('ready frame received');

  const version = await request('app:version');
  assert(version === '0.1.23', `app:version → ${version}`);

  await request('settings:set', 'setupComplete', true);
  assert((await request('settings:get', 'setupComplete')) === true, 'settings roundtrip');

  const catalog = await request('provider:catalog');
  assert(Array.isArray(catalog) && catalog.length >= 8, 'provider catalog exposed');

  const provider = await request('provider:create', 'default', { vendorId: 'ollama', model: 'llama3.1', authMode: 'local' });
  assert(provider.isDefault === true, 'first provider becomes default');
  assert(provider.hasSecret === false, 'local provider needs no secret');
  const readiness = await request('app:readiness', 'default');
  assert(readiness.defaultConfigured === true, 'readiness reports a configured default');

  const agents = await request('agent:list', 'default');
  assert(agents.some(a => a.id === 'main' && a.isDefault), 'default agent seeded');

  const channelCatalog = await request('channel:catalog');
  const webhook = channelCatalog.find(c => c.type === 'webhook');
  const wechat = channelCatalog.find(c => c.type === 'wechat');
  assert(webhook?.supported === true && webhook.capability.inbound === true, 'webhook channel supported');
  assert(wechat?.supported === false, 'WeChat QR channel honestly unsupported');
  await request('channel:create', 'default', { adapter: 'wechat', displayName: 'W' })
    .then(() => assert(false, 'wechat create rejected'))
    .catch(e => assert(/UNSUPPORTED/.test(e.message), `QR channel rejected (${e.message.split(':')[0]})`));

  const account = await request('channel:create', 'default', {
    adapter: 'webhook', displayName: 'Hook',
    config: { endpointUrl: 'http://127.0.0.1:9/hook' }, secrets: { authToken: 'tok' },
  });
  assert(account.status === 'configured', 'webhook account configured');
  assert((await request('channel:list', 'default')).some(a => a.id === account.id), 'account listed');

  const skills = await request('skill:list', 'default');
  assert(Array.isArray(skills), 'local skill catalog listed');

  const artifact = await request('artifact:stageBuffer', 'default', Buffer.from('smoke', 'utf8').toString('base64'), 'smoke.txt', 'text/plain');
  assert(artifact.byteSize === 5 && /^[0-9a-f]{64}$/.test(artifact.sha256), 'artifact staged with hash, no path in metadata');
  assert(!JSON.stringify(artifact).includes(dataDir), 'artifact metadata has no absolute path');

  await request('cron:save', { workspaceId: 'default', name: 'n', message: 'm', schedule: 'not cron' })
    .then(() => assert(false, 'invalid cron rejected'))
    .catch(e => assert(/CRON_EXPRESSION_INVALID/.test(e.message), 'invalid cron rejected'));
  const job = await request('cron:save', { workspaceId: 'default', name: 'daily', message: 'summary', schedule: '0 9 * * 1-5', timezone: 'UTC' });
  assert((await request('cron:list', 'default')).some(j => j.id === job.id), 'valid cron persisted');

  const mem = await request('memory:add', 'default', { content: 'smoke memory fact' });
  assert((await request('memory:search', 'default', 'smoke')).some(m => m.id === mem.id), 'FTS memory search works');

  try { await request('definitely:not-a-channel'); assert(false, 'unknown channel rejected'); }
  catch (e) { assert(/Unsupported/.test(e.message), 'unknown IPC channel rejected'); }

  // secret isolation: channel token lives in the impersonated keychain, not SQLite
  const { readFileSync } = await import('node:fs');
  const dbBytes = readFileSync(join(dataDir, 'clawcore.sqlite'), 'utf8');
  assert(!dbBytes.includes('"authToken"'), 'channel secret never written to SQLite');
} catch (error) {
  console.error('SMOKE FAILED:', error);
  failures.push(error.message);
} finally {
  child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  child.on('exit', () => {
    clearTimeout(timer);
    if (failures.length) { console.error(`\n${failures.length} smoke assertion(s) failed`); process.exit(1); }
    console.log('\nSMOKE OK');
  });
}
