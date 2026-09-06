// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { CoreDatabase } from '@backend/core/db/database';
import { ProviderStore } from '@backend/core/provider-store';
import { Keychain } from '@backend/core/secrets/keychain';
import { FakeSecretBridge } from '@backend/core/native/secret-bridge';
import { tempDir } from './helpers/runtime-harness';

const require = createRequire(import.meta.url);

function legacyDatabase(path: string): void {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE core_providers (id TEXT PRIMARY KEY, data_json TEXT NOT NULL, api_key TEXT, secret_present INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT) STRICT;
    CREATE TABLE core_agents (id TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at TEXT) STRICT;
    CREATE TABLE core_cron_jobs (id TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at TEXT) STRICT;
    CREATE TABLE core_skills (id TEXT PRIMARY KEY, data_json TEXT NOT NULL) STRICT;
    CREATE TABLE core_runs (id TEXT PRIMARY KEY, workspace_id TEXT, conversation_id TEXT, agent_id TEXT, source TEXT, status TEXT, idempotency_key TEXT, created_at TEXT, updated_at TEXT, budget_json TEXT, turn_count INTEGER, tool_call_count INTEGER, error_json TEXT) STRICT;
    CREATE TABLE core_run_events (event_id TEXT, run_id TEXT, sequence INTEGER, type TEXT, occurred_at TEXT, payload_json TEXT) STRICT;
    CREATE TABLE core_conversation_messages (id TEXT PRIMARY KEY, workspace_id TEXT, conversation_id TEXT, run_id TEXT, role TEXT, content TEXT, created_at TEXT, metadata_json TEXT) STRICT;
  `);
  const t = '2024-01-01T00:00:00.000Z';
  db.prepare("INSERT INTO core_providers (id,data_json,api_key,secret_present,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run('p1', JSON.stringify({ vendorId: 'anthropic', label: 'Anthropic', authMode: 'api_key', model: 'claude', enabled: true, isDefault: true }), 'sk-plaintext-leak', 0, t, t);
  db.prepare("INSERT INTO core_agents (id,data_json,updated_at) VALUES (?,?,?)")
    .run('main', JSON.stringify({ id: 'main', name: 'Main', channelBindings: [], isDefault: true }), t);
  db.prepare("INSERT INTO core_cron_jobs (id,data_json,updated_at) VALUES (?,?,?)")
    .run('job1', JSON.stringify({ id: 'job1', name: 'Daily', message: 'hi', schedule: '0 9 * * *', enabled: true }), t);
  db.prepare("INSERT INTO core_skills (id,data_json) VALUES (?,?)")
    .run('summarizer', JSON.stringify({ slug: 'summarizer', enabled: true, installedOnDisk: true }));
  db.prepare("INSERT INTO core_runs (id,workspace_id,conversation_id,agent_id,source,status,idempotency_key,created_at,updated_at,budget_json,turn_count,tool_call_count,error_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run('r1', 'default', 'c1', 'main', 'chat', 'completed', 'k1', t, t, JSON.stringify({}), 1, 0, null);
  db.prepare("INSERT INTO core_run_events (event_id,run_id,sequence,type,occurred_at,payload_json) VALUES (?,?,?,?,?,?)")
    .run('e1', 'r1', 1, 'run.started', t, '{}');
  db.prepare("INSERT INTO core_conversation_messages (id,workspace_id,conversation_id,run_id,role,content,created_at,metadata_json) VALUES (?,?,?,?,?,?,?,?)")
    .run('m1', 'default', 'c1', 'r1', 'user', 'legacy question', t, null);
  db.close();
}

describe('legacy database reconciliation', () => {
  it('migrates every entity, stages the plaintext key, and drops old tables', () => {
    const dir = tempDir();
    const path = join(dir, 'clawcore.sqlite');
    legacyDatabase(path);

    const db = new CoreDatabase(path);
    // old tables gone
    const tables = new Set((db.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(r => r.name));
    expect(tables.has('core_providers')).toBe(false);
    expect(tables.has('core_provider')).toBe(true);

    // provider migrated without a secret column value
    const provider = db.db.prepare('SELECT * FROM core_provider WHERE id=?').get('p1') as Record<string, unknown>;
    expect(provider.vendor_id).toBe('anthropic');
    expect(provider.is_default).toBe(1);
    expect(provider.has_secret).toBe(0);

    // agents/cron/skills/messages/runs/events migrated
    expect(db.db.prepare('SELECT * FROM core_agent WHERE id=?').get('main')).toBeTruthy();
    expect(db.db.prepare('SELECT * FROM core_cron_job WHERE id=?').get('job1')).toBeTruthy();
    expect(db.db.prepare('SELECT * FROM core_skill WHERE slug=?').get('summarizer')).toBeTruthy();
    expect(db.db.prepare('SELECT * FROM core_message WHERE conversation_id=?').all('c1')).toHaveLength(1);
    expect(db.db.prepare('SELECT * FROM core_run WHERE id=?').get('r1')).toBeTruthy();
    expect(db.db.prepare('SELECT * FROM core_run_event WHERE run_id=?').all('r1')).toHaveLength(1);

    // plaintext staged, never in a canonical column
    const staged = db.db.prepare('SELECT account, value FROM core_secret_migration').all() as Array<{ account: string; value: string }>;
    expect(staged[0].account).toBe('provider:default:p1');
    expect(staged[0].value).toBe('sk-plaintext-leak');
    db.close();
  });

  it('migrates staged secrets into the keychain (read-back verified), then purges bytes', async () => {
    const dir = tempDir();
    const path = join(dir, 'clawcore.sqlite');
    legacyDatabase(path);
    const bridge = new FakeSecretBridge();
    const db = new CoreDatabase(path);
    const providers = new ProviderStore(db, new Keychain(bridge));
    const result = await providers.migrateLegacySecrets();
    expect(result.migrated).toBe(1);
    expect(bridge.store.get('provider:default:p1')).toBe('sk-plaintext-leak');
    expect(providers.get('default', 'p1')?.hasSecret).toBe(true);
    expect(db.db.prepare('SELECT COUNT(*) c FROM core_secret_migration').get() as { c: number }).toMatchObject({ c: 0 });
    db.close();
    // VACUUM + checkpoint removed the plaintext from the files
    expect(readFileSync(path, 'utf8')).not.toContain('sk-plaintext-leak');
  });

  it('is idempotent across reopens', () => {
    const dir = tempDir();
    const path = join(dir, 'c.sqlite');
    legacyDatabase(path);
    const a = new CoreDatabase(path);
    a.close();
    const b = new CoreDatabase(path);
    expect(b.db.prepare('SELECT COUNT(*) c FROM core_provider').get() as { c: number }).toMatchObject({ c: 1 });
    expect(b.db.prepare('SELECT COUNT(*) c FROM core_message').get() as { c: number }).toMatchObject({ c: 1 });
    b.close();
  });

  it('keeps the legacy secret pending when the keychain is unavailable, without exposing it', async () => {
    const dir = tempDir();
    const path = join(dir, 'c.sqlite');
    legacyDatabase(path);
    const bridge = new FakeSecretBridge().denyAccess();
    const db = new CoreDatabase(path);
    const providers = new ProviderStore(db, new Keychain(bridge));
    await providers.migrateLegacySecrets();
    const view = providers.get('default', 'p1')!;
    expect(view.hasSecret).toBe(false); // never a false positive
    expect(db.db.prepare('SELECT COUNT(*) c FROM core_secret_migration').get() as { c: number }).toMatchObject({ c: 1 });
    db.close();
  });
});
