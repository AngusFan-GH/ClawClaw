import { createRequire } from 'node:module';
import { join } from 'node:path';
import { app } from '../host/desktop';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
export type CoreCronJob = { id: string; name: string; message: string; schedule: string; enabled: boolean; agentId?: string; delivery?: unknown; sessionTarget?: string; createdAt: string; updatedAt: string; lastRun?: { time: string; success: boolean; error?: string } };

export class CoreCronStore {
  private readonly db: InstanceType<typeof DatabaseSync>;
  constructor(file = join(app.getPath('userData'), 'clawcore.sqlite')) { this.db = new DatabaseSync(file); this.db.exec('CREATE TABLE IF NOT EXISTS core_cron_jobs (id TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;'); }
  list(): CoreCronJob[] { return (this.db.prepare('SELECT data_json FROM core_cron_jobs ORDER BY updated_at DESC').all() as { data_json: string }[]).map(row => JSON.parse(row.data_json)); }
  get(id: string): CoreCronJob | undefined { const row = this.db.prepare('SELECT data_json FROM core_cron_jobs WHERE id=?').get(id) as { data_json: string } | undefined; return row && JSON.parse(row.data_json); }
  save(input: Partial<CoreCronJob> & { id?: string; name: string; message: string; schedule: string }): CoreCronJob { const old = input.id ? this.get(input.id) : undefined; const now = new Date().toISOString(); const job: CoreCronJob = { ...old, ...input, id: input.id || crypto.randomUUID(), enabled: input.enabled ?? old?.enabled ?? true, createdAt: old?.createdAt || now, updatedAt: now }; this.db.prepare('INSERT INTO core_cron_jobs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at').run(job.id, JSON.stringify(job), job.updatedAt); return job; }
  delete(id: string): void { this.db.prepare('DELETE FROM core_cron_jobs WHERE id=?').run(id); }
  close(): void { this.db.close(); }
}
