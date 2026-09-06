/**
 * Single SQLite connection for the whole ClawCore process.
 *
 * One connection is essential: cross-table writes must participate in the same
 * transaction (provider default uniqueness, run/message/plan creation, etc.).
 * Schema changes are idempotent and applied on every launch.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CANONICAL_DDL, reconcileLegacy, seedDefaults } from './schema';

const DatabaseSyncCtor: typeof DatabaseSync = DatabaseSync;

export interface Migration {
  version: number;
  name: string;
  up(db: DatabaseSync): void;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'canonical_core_schema',
    up(db) {
      for (const statement of CANONICAL_DDL) db.exec(statement);
      reconcileLegacy(db);
      seedDefaults(db);
    },
  },
];

export class CoreDatabase {
  readonly db: InstanceType<typeof DatabaseSync>;

  constructor(filePath?: string) {
    const resolved = filePath ?? defaultDatabasePath();
    mkdirSync(dirname(resolved), { recursive: true });
    this.db = new DatabaseSyncCtor(resolved, { enableForeignKeyConstraints: true, timeout: 10_000 });
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000; PRAGMA secure_delete = ON;');
    this.migrate();
  }

  private migrate(): void {
    // Bootstrap the ledger before any migration checks it.
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
    ) STRICT;`);
    for (const migration of migrations) {
      const applied = this.db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(migration.version);
      if (applied) continue;
      this.transaction(() => {
        migration.up(this.db);
        this.db.prepare('INSERT OR REPLACE INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
          .run(migration.version, migration.name, new Date().toISOString());
      });
    }
  }

  /** Run `fn` inside an immediate transaction; roll back on throw. */
  transaction<T>(fn: () => T): T {
    this.db.exec('SAVEPOINT core_tx');
    try {
      const result = fn();
      this.db.exec('RELEASE SAVEPOINT core_tx');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK TO SAVEPOINT core_tx');
      this.db.exec('RELEASE SAVEPOINT core_tx');
      throw error;
    }
  }

  close(): void {
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* best effort */ }
    this.db.close();
  }
}

// Default data root. The composition root (core/main.ts) normally passes the
// OS userData dir explicitly; this fallback honors CLAWCLAW_DATA_DIR (used by
// tests and the smoke harness) and otherwise stays inside the working dir.
export function defaultDataDir(): string {
  const envDir = process.env.CLAWCLAW_DATA_DIR;
  if (envDir) return isAbsolute(envDir) ? envDir : join(process.cwd(), envDir);
  return join(process.cwd(), '.data');
}

export function defaultDatabasePath(): string {
  return join(defaultDataDir(), 'clawcore.sqlite');
}

export function resolveDataDir(dataDir?: string): string {
  if (dataDir) return isAbsolute(dataDir) ? dataDir : join(process.cwd(), dataDir);
  return defaultDataDir();
}
