import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { app } from '../host/desktop';
import { nativeRequest } from '../host/transport';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

export type CoreProvider = {
  id: string; vendorId: string; label: string; authMode: 'api_key' | 'oauth_device' | 'oauth_browser' | 'local';
  baseUrl?: string; apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  model?: string; enabled: boolean; isDefault: boolean; createdAt: string; updatedAt: string;
};

/** Provider metadata lives in SQLite; credentials only ever live in the OS keychain. */
export class CoreProviderStore {
  private readonly db: InstanceType<typeof DatabaseSync>;
  private readonly importedSecrets = new Map<string, string>();
  constructor(filePath = join(app.getPath('userData'), 'clawcore.sqlite')) {
    this.db = new DatabaseSync(filePath, { enableForeignKeyConstraints: true, timeout: 5_000 });
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS core_providers (
        id TEXT PRIMARY KEY, data_json TEXT NOT NULL, api_key TEXT, secret_present INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;`);
    try { this.db.exec('ALTER TABLE core_providers ADD COLUMN secret_present INTEGER NOT NULL DEFAULT 0'); } catch { /* Existing databases already have it. */ }
    this.importLegacyCatalog();
  }
  /** Moves legacy plaintext credentials once the Tauri native bridge is available. */
  async initializeSecrets(): Promise<void> {
    const rows = this.db.prepare("SELECT id, api_key FROM core_providers WHERE api_key IS NOT NULL AND api_key != ''").all() as { id: string; api_key: string }[];
    for (const row of rows) this.importedSecrets.set(row.id, row.api_key);
    for (const [id, value] of this.importedSecrets) {
      try {
        await this.writeSecret(id, value);
        this.db.prepare('UPDATE core_providers SET api_key=NULL, secret_present=1, updated_at=? WHERE id=?').run(new Date().toISOString(), id);
      } catch { /* Preserve a legacy value until a future launch can safely migrate it. */ }
    }
    this.importedSecrets.clear();
  }
  list(): CoreProvider[] {
    return (this.db.prepare('SELECT data_json FROM core_providers ORDER BY updated_at DESC').all() as { data_json: string }[]).map(row => JSON.parse(row.data_json));
  }
  get(id: string): CoreProvider | undefined {
    const row = this.db.prepare('SELECT data_json FROM core_providers WHERE id=?').get(id) as { data_json: string } | undefined;
    return row ? JSON.parse(row.data_json) : undefined;
  }
  getDefault(): CoreProvider | undefined { return this.list().find(provider => provider.isDefault); }
  hasApiKey(id: string): boolean {
    const row = this.db.prepare('SELECT secret_present, api_key FROM core_providers WHERE id=?').get(id) as { secret_present: number; api_key: string | null } | undefined;
    return Boolean(row?.secret_present || row?.api_key);
  }
  async getApiKey(id: string): Promise<string | undefined> {
    const value = await nativeRequest<string | null>('secret:get', { account: this.secretAccount(id) });
    if (value) return value;
    this.db.prepare('UPDATE core_providers SET secret_present=0 WHERE id=?').run(id);
    return undefined;
  }
  save(input: Partial<CoreProvider> & { id: string; vendorId: string }): CoreProvider {
    const now = new Date().toISOString(); const existing = this.get(input.id);
    const provider: CoreProvider = { id: input.id, vendorId: input.vendorId, label: input.label || input.vendorId,
      authMode: input.authMode || 'api_key', baseUrl: input.baseUrl, apiProtocol: input.apiProtocol,
      model: input.model, enabled: input.enabled ?? true, isDefault: input.isDefault ?? false,
      createdAt: existing?.createdAt || now, updatedAt: now };
    if (provider.isDefault) this.db.exec('UPDATE core_providers SET data_json=json_set(data_json,\'$.isDefault\',json(\'false\'))');
    this.db.prepare(`INSERT INTO core_providers (id,data_json,secret_present,created_at,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at`)
      .run(provider.id, JSON.stringify(provider), this.hasApiKey(provider.id) ? 1 : 0, provider.createdAt, provider.updatedAt);
    return provider;
  }
  async setApiKey(id: string, apiKey: string): Promise<void> {
    if (!this.get(id)) throw new Error('Provider not found');
    if (!apiKey) return this.deleteApiKey(id);
    await this.writeSecret(id, apiKey);
    this.db.prepare('UPDATE core_providers SET api_key=NULL, secret_present=1, updated_at=? WHERE id=?').run(new Date().toISOString(), id);
  }
  async deleteApiKey(id: string): Promise<void> {
    await nativeRequest('secret:delete', { account: this.secretAccount(id) });
    this.db.prepare('UPDATE core_providers SET api_key=NULL, secret_present=0, updated_at=? WHERE id=?').run(new Date().toISOString(), id);
  }
  setDefault(id: string): CoreProvider {
    const target = this.get(id); if (!target) throw new Error('Provider not found');
    for (const provider of this.list()) this.save({ ...provider, isDefault: provider.id === id });
    return { ...target, isDefault: true };
  }
  async delete(id: string): Promise<void> { await this.deleteApiKey(id); this.db.prepare('DELETE FROM core_providers WHERE id=?').run(id); }
  close(): void { this.db.close(); }
  private secretAccount(id: string) { return `provider:${id}`; }
  private async writeSecret(id: string, value: string): Promise<void> { await nativeRequest('secret:set', { account: this.secretAccount(id), value }); }
  private importLegacyCatalog(): void {
    const count = (this.db.prepare('SELECT COUNT(*) AS count FROM core_providers').get() as { count: number }).count;
    if (count) return;
    const legacy = join(app.getPath('userData'), 'clawclaw-providers.json');
    if (!existsSync(legacy)) return;
    try {
      const source = JSON.parse(readFileSync(legacy, 'utf8')) as { providerAccounts?: Record<string, CoreProvider>; apiKeys?: Record<string, string>; defaultProviderAccountId?: string };
      for (const provider of Object.values(source.providerAccounts || {})) {
        this.save({ ...provider, isDefault: provider.id === source.defaultProviderAccountId || provider.isDefault });
        const key = source.apiKeys?.[provider.id]; if (key) this.importedSecrets.set(provider.id, key);
      }
    } catch { /* A corrupt legacy catalog must not prevent the new runtime from starting. */ }
  }
}
