/**
 * Canonical ClawCore SQLite schema and one-time reconciliation from the
 * pre-release 0.1.x tables.
 *
 * Design rules:
 *  - Every domain entity has id / created_at / updated_at.
 *  - workspace_id is the isolation boundary for every user-scoped entity.
 *  - No reversible secret is stored anywhere. `has_secret` only records that a
 *    verified value exists in the OS keychain; legacy plaintext is staged in
 *    `core_secret_migration` until it has been written + read back.
 *  - Migrations are idempotent and safe to run on every launch.
 */
import type { DatabaseSync } from 'node:sqlite';

type DB = InstanceType<typeof DatabaseSync>;

/** Canonical DDL. Statements use IF NOT EXISTS and are safe to re-run. */
export const CANONICAL_DDL: string[] = [
  `PRAGMA journal_mode = WAL;`,
  `PRAGMA foreign_keys = ON;`,

  `CREATE TABLE IF NOT EXISTS schema_migrations (
     version INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     applied_at TEXT NOT NULL
   ) STRICT;`,

  `CREATE TABLE IF NOT EXISTS core_workspace (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   ) STRICT;`,

  `CREATE TABLE IF NOT EXISTS core_provider (
     id TEXT NOT NULL,
     workspace_id TEXT NOT NULL,
     vendor_id TEXT NOT NULL,
     label TEXT NOT NULL,
     auth_mode TEXT NOT NULL,
     base_url TEXT,
     api_protocol TEXT,
     model TEXT,
     enabled INTEGER NOT NULL DEFAULT 1,
     is_default INTEGER NOT NULL DEFAULT 0,
     has_secret INTEGER NOT NULL DEFAULT 0,
     config_json TEXT NOT NULL DEFAULT '{}',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (workspace_id, id)
   ) STRICT;`,
  // Only one default provider per workspace.
  `CREATE UNIQUE INDEX IF NOT EXISTS core_provider_default_unique
     ON core_provider(workspace_id) WHERE is_default = 1;`,

  `CREATE TABLE IF NOT EXISTS core_agent (
     id TEXT NOT NULL,
     workspace_id TEXT NOT NULL,
     name TEXT NOT NULL,
     system_prompt TEXT NOT NULL DEFAULT '',
     provider_id TEXT,
     model TEXT,
     tools_policy_json TEXT NOT NULL DEFAULT '{}',
     memory_policy_json TEXT NOT NULL DEFAULT '{}',
     budget_json TEXT NOT NULL DEFAULT '{}',
     bindings_json TEXT NOT NULL DEFAULT '[]',
     enabled INTEGER NOT NULL DEFAULT 1,
     is_default INTEGER NOT NULL DEFAULT 0,
     config_json TEXT NOT NULL DEFAULT '{}',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (workspace_id, id)
   ) STRICT;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS core_agent_default_unique
     ON core_agent(workspace_id) WHERE is_default = 1;`,

  `CREATE TABLE IF NOT EXISTS core_conversation (
     id TEXT NOT NULL,
     workspace_id TEXT NOT NULL,
     title TEXT NOT NULL DEFAULT '',
     channel_account_id TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (workspace_id, id)
   ) STRICT;`,

  `CREATE TABLE IF NOT EXISTS core_message (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL,
     conversation_id TEXT NOT NULL,
     run_id TEXT,
     seq INTEGER NOT NULL,
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     metadata_json TEXT,
     created_at TEXT NOT NULL,
     UNIQUE (workspace_id, conversation_id, seq)
   ) STRICT;`,
  `CREATE INDEX IF NOT EXISTS core_message_history
     ON core_message(workspace_id, conversation_id, seq);`,

  `CREATE TABLE IF NOT EXISTS core_run (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL,
     conversation_id TEXT NOT NULL,
     agent_id TEXT NOT NULL,
     source TEXT NOT NULL,
     status TEXT NOT NULL,
     idempotency_key TEXT NOT NULL,
     agent_snapshot_json TEXT,
     budget_json TEXT NOT NULL,
     turn_count INTEGER NOT NULL DEFAULT 0,
     tool_call_count INTEGER NOT NULL DEFAULT 0,
     error_json TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE (workspace_id, idempotency_key)
   ) STRICT;`,
  `CREATE INDEX IF NOT EXISTS core_run_conversation ON core_run(workspace_id, conversation_id, created_at);`,

  `CREATE TABLE IF NOT EXISTS core_run_event (
     event_id TEXT PRIMARY KEY,
     run_id TEXT NOT NULL,
     sequence INTEGER NOT NULL,
     type TEXT NOT NULL,
     occurred_at TEXT NOT NULL,
     payload_json TEXT NOT NULL,
     UNIQUE (run_id, sequence)
   ) STRICT;`,
  `CREATE INDEX IF NOT EXISTS core_run_event_cursor ON core_run_event(run_id, sequence);`,

  `CREATE TABLE IF NOT EXISTS core_tool_invocation (
     id TEXT PRIMARY KEY,
     tool_call_id TEXT NOT NULL,
     run_id TEXT NOT NULL,
     workspace_id TEXT NOT NULL,
     tool_name TEXT NOT NULL,
     tool_version INTEGER NOT NULL,
     args_digest TEXT NOT NULL,
     args_summary_json TEXT NOT NULL DEFAULT '{}',
     risk TEXT NOT NULL,
     approval_policy TEXT NOT NULL,
     status TEXT NOT NULL,
     approver TEXT,
     approved_at TEXT,
     denial_reason TEXT,
     result_summary_json TEXT,
     error_code TEXT,
     error_message TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE (run_id, tool_call_id)
   ) STRICT;`,
  `CREATE INDEX IF NOT EXISTS core_tool_invocation_run ON core_tool_invocation(run_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS core_tool_invocation_pending
     ON core_tool_invocation(workspace_id, status);`,

  `CREATE TABLE IF NOT EXISTS core_context_plan (
     id TEXT PRIMARY KEY,
     run_id TEXT NOT NULL UNIQUE,
     workspace_id TEXT NOT NULL,
     conversation_id TEXT NOT NULL,
     sections_json TEXT NOT NULL DEFAULT '{}',
     token_estimates_json TEXT NOT NULL DEFAULT '{}',
     trim_reasons_json TEXT NOT NULL DEFAULT '[]',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   ) STRICT;`,

  `CREATE TABLE IF NOT EXISTS core_conversation_summary (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL,
     conversation_id TEXT NOT NULL,
     version INTEGER NOT NULL,
     cursor_start_seq INTEGER NOT NULL,
     cursor_end_seq INTEGER NOT NULL,
     token_estimate INTEGER NOT NULL,
     content TEXT NOT NULL,
     invalidated INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE (workspace_id, conversation_id, version)
   ) STRICT;`,

  `CREATE TABLE IF NOT EXISTS core_memory_item (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL,
     source_conversation_id TEXT,
     content TEXT NOT NULL,
     tags_json TEXT NOT NULL DEFAULT '[]',
     retrieval_version INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   ) STRICT;`,
  `CREATE INDEX IF NOT EXISTS core_memory_workspace ON core_memory_item(workspace_id, updated_at);`,

  // FTS index is maintained explicitly by MemoryStore (FTS5 'delete' is not
  // reliable from triggers in every SQLite build). rowid == item.rowid.
  `CREATE VIRTUAL TABLE IF NOT EXISTS core_memory_fts USING fts5(
     content, tags, item_id UNINDEXED, tokenize = 'unicode61'
   );`,

  `CREATE TABLE IF NOT EXISTS core_artifact (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL,
     display_name TEXT NOT NULL,
     mime_type TEXT NOT NULL,
     byte_size INTEGER NOT NULL,
     sha256 TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'file',
     storage_rel TEXT NOT NULL,
     width INTEGER,
     height INTEGER,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   ) STRICT;`,
  `CREATE INDEX IF NOT EXISTS core_artifact_workspace ON core_artifact(workspace_id, created_at);`,

  `CREATE TABLE IF NOT EXISTS core_artifact_link (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL,
     conversation_id TEXT,
     message_id TEXT,
     artifact_id TEXT NOT NULL,
     created_at TEXT NOT NULL
   ) STRICT;`,

  `CREATE TABLE IF NOT EXISTS core_skill (
     id TEXT NOT NULL,
     workspace_id TEXT NOT NULL,
     slug TEXT NOT NULL,
     enabled INTEGER NOT NULL DEFAULT 1,
     config_json TEXT NOT NULL DEFAULT '{}',
     installed INTEGER NOT NULL DEFAULT 0,
     installed_path TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (workspace_id, slug)
   ) STRICT;`,

  `CREATE TABLE IF NOT EXISTS core_channel_account (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL,
     adapter TEXT NOT NULL,
     display_name TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'unconfigured',
     config_json TEXT NOT NULL DEFAULT '{}',
     capabilities_json TEXT NOT NULL DEFAULT '{}',
     last_error_code TEXT,
     last_error_message TEXT,
     connected_at TEXT,
     last_activity_at TEXT,
     inbound_started INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   ) STRICT;`,
  `CREATE INDEX IF NOT EXISTS core_channel_workspace ON core_channel_account(workspace_id);`,

  `CREATE TABLE IF NOT EXISTS core_channel_inbound (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL,
     account_id TEXT NOT NULL,
     source_id TEXT NOT NULL,
     idempotency_key TEXT NOT NULL,
     sender TEXT,
     payload_kind TEXT NOT NULL,
     size_bytes INTEGER NOT NULL,
     run_id TEXT,
     received_at TEXT NOT NULL,
     UNIQUE (workspace_id, account_id, idempotency_key)
   ) STRICT;`,

  `CREATE TABLE IF NOT EXISTS core_cron_job (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL,
     name TEXT NOT NULL,
     message TEXT NOT NULL,
     schedule_expr TEXT NOT NULL,
     timezone TEXT NOT NULL,
     agent_id TEXT,
     delivery_json TEXT,
     session_target TEXT,
     enabled INTEGER NOT NULL DEFAULT 1,
     last_run_at TEXT,
     last_status TEXT,
     last_error TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   ) STRICT;`,

  `CREATE TABLE IF NOT EXISTS core_cron_fire (
     job_id TEXT NOT NULL,
     scheduled_at TEXT NOT NULL,
     fired_at TEXT,
     run_id TEXT,
     status TEXT NOT NULL DEFAULT 'due',
     error TEXT,
     PRIMARY KEY (job_id, scheduled_at)
   ) STRICT;`,

  // Private staging for legacy plaintext secrets. Not exposed by any IPC.
  `CREATE TABLE IF NOT EXISTS core_secret_migration (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     account TEXT NOT NULL UNIQUE,
     kind TEXT NOT NULL DEFAULT 'provider',
     value TEXT NOT NULL,
     created_at TEXT NOT NULL
   ) STRICT;`,
];

function tableExists(db: DB, name: string): boolean {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(name);
  return Boolean(row);
}

function columnExists(db: DB, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>).some(c => c.name === column);
}

const now = () => new Date().toISOString();
const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));

/**
 * Copy data from the pre-release 0.1.x shape into the canonical tables, then
 * drop the old tables. Plaintext provider keys are moved to the private secret
 * staging table (never to a canonical entity column).
 */
export function reconcileLegacy(db: DB): void {
  const legacyProviders = tableExists(db, 'core_providers') && columnExists(db, 'core_providers', 'data_json');
  const legacyAgents = tableExists(db, 'core_agents') && columnExists(db, 'core_agents', 'data_json');
  const legacyCron = tableExists(db, 'core_cron_jobs') && columnExists(db, 'core_cron_jobs', 'data_json');
  const legacySkills = tableExists(db, 'core_skills') && columnExists(db, 'core_skills', 'data_json');
  const legacyMessages = tableExists(db, 'core_conversation_messages');
  const legacyRuns = tableExists(db, 'core_runs');
  const legacyEvents = tableExists(db, 'core_run_events');
  if (!legacyProviders && !legacyAgents && !legacyCron && !legacySkills && !legacyMessages && !legacyRuns && !legacyEvents) return;

  db.exec('SAVEPOINT legacy_reconcile');
  try {
    db.prepare("INSERT OR IGNORE INTO core_workspace (id,name,created_at,updated_at) VALUES ('default','Default',?,?)").run(now(), now());

    if (legacyProviders) {
      const rows = db.prepare('SELECT id, data_json, api_key, secret_present, created_at, updated_at FROM core_providers').all() as
        Array<{ id: string; data_json: string; api_key: string | null; secret_present: number; created_at: string; updated_at: string }>;
      const insert = db.prepare(`INSERT OR IGNORE INTO core_provider
        (id,workspace_id,vendor_id,label,auth_mode,base_url,api_protocol,model,enabled,is_default,has_secret,config_json,created_at,updated_at)
        VALUES (@id,'default',@vendor_id,@label,@auth_mode,@base_url,@api_protocol,@model,@enabled,@is_default,@has_secret,'{}',@created_at,@updated_at)`);
      const stageSecret = db.prepare("INSERT OR IGNORE INTO core_secret_migration (account,kind,value,created_at) VALUES ('provider:default:'||@id,'provider',@value,@ts)");
      for (const r of rows) {
        const d = JSON.parse(r.data_json || '{}') as unknown as Record<string, unknown>;
        const apiKey = typeof r.api_key === 'string' && r.api_key ? r.api_key : null;
        if (apiKey) void stageSecret.run({ id: r.id, value: apiKey, ts: now() });
        void insert.run({
          id: r.id,
          vendor_id: String(d.vendorId ?? 'openai'),
          label: String(d.label ?? d.vendorId ?? r.id),
          auth_mode: String(d.authMode ?? 'api_key'),
          base_url: d.baseUrl ? String(d.baseUrl) : null,
          api_protocol: d.apiProtocol ? String(d.apiProtocol) : null,
          model: d.model ? String(d.model) : null,
          enabled: d.enabled === false ? 0 : 1,
          is_default: d.isDefault ? 1 : 0,
          has_secret: apiKey ? 0 : (r.secret_present ? 1 : 0),
          created_at: r.created_at || now(),
          updated_at: r.updated_at || now(),
        });
      }
    }

    if (legacyAgents) {
      const rows = db.prepare('SELECT data_json, updated_at FROM core_agents').all() as unknown as Array<{ data_json: string; updated_at: string }>;
      const insert = db.prepare(`INSERT OR IGNORE INTO core_agent
        (id,workspace_id,name,system_prompt,provider_id,model,tools_policy_json,memory_policy_json,budget_json,bindings_json,enabled,is_default,config_json,created_at,updated_at)
        VALUES (@id,'default',@name,'',NULL,@model,'{}','{}','{}',@bindings,1,@is_default,'{}',@ts,@ts)`);
      for (const r of rows) {
        const d = JSON.parse(r.data_json || '{}') as unknown as Record<string, unknown>;
        void insert.run({
          id: String(d.id ?? 'main'), name: String(d.name ?? 'Main'), model: d.model ? String(d.model) : null,
          bindings: json(d.channelBindings ?? []) ?? '[]', is_default: d.isDefault ? 1 : 0, ts: r.updated_at || now(),
        });
      }
    }

    if (legacyCron) {
      const rows = db.prepare('SELECT data_json, updated_at FROM core_cron_jobs').all() as unknown as Array<{ data_json: string; updated_at: string }>;
      const insert = db.prepare(`INSERT OR IGNORE INTO core_cron_job
        (id,workspace_id,name,message,schedule_expr,timezone,agent_id,delivery_json,session_target,enabled,last_run_at,last_status,last_error,created_at,updated_at)
        VALUES (@id,'default',@name,@message,@schedule,'UTC',@agent,@delivery,@target,@enabled,NULL,NULL,NULL,@ts,@ts)`);
      for (const r of rows) {
        const d = JSON.parse(r.data_json || '{}') as unknown as Record<string, unknown>;
        const last = d.lastRun as { time?: string; success?: boolean; error?: string } | undefined;
        void insert.run({
          id: String(d.id), name: String(d.name ?? d.id), message: String(d.message ?? ''), schedule: String(d.schedule ?? '* * * * *'),
          agent: d.agentId ? String(d.agentId) : null, delivery: json(d.delivery ?? null), target: d.sessionTarget ? String(d.sessionTarget) : null,
          enabled: d.enabled === false ? 0 : 1, ts: r.updated_at || now(),
        });
        if (last?.time) {
          void db.prepare('UPDATE core_cron_job SET last_run_at=?, last_status=?, last_error=? WHERE workspace_id=? AND id=?')
            .run(last.time, last.success ? 'success' : 'error', last.error ?? null, 'default', String(d.id));
        }
      }
    }

    if (legacySkills) {
      const rows = db.prepare('SELECT id, data_json FROM core_skills').all() as unknown as Array<{ id: string; data_json: string }>;
      const insert = db.prepare(`INSERT OR IGNORE INTO core_skill
        (id,workspace_id,slug,enabled,config_json,installed,installed_path,created_at,updated_at)
        VALUES (@id,'default',@slug,@enabled,'{}',@installed,NULL,@ts,@ts)`);
      for (const r of rows) {
        const d = JSON.parse(r.data_json || '{}') as unknown as Record<string, unknown>;
        void insert.run({
          id: r.id, slug: String(d.slug ?? r.id), enabled: d.enabled === false ? 0 : 1,
          installed: d.installedOnDisk ? 1 : 0, ts: now(),
        });
      }
    }

    if (legacyRuns) {
      const rows = db.prepare('SELECT * FROM core_runs').all() as unknown as Array<Record<string, unknown>>;
      const insert = db.prepare(`INSERT OR IGNORE INTO core_run
        (id,workspace_id,conversation_id,agent_id,source,status,idempotency_key,agent_snapshot_json,budget_json,turn_count,tool_call_count,error_json,created_at,updated_at)
        VALUES (@id,@workspace_id,@conversation_id,@agent_id,@source,@status,@idempotency_key,NULL,@budget_json,@turn_count,@tool_call_count,@error_json,@created_at,@updated_at)`);
      for (const r of rows) {
        void insert.run({
          id: String(r.id), workspace_id: String(r.workspace_id), conversation_id: String(r.conversation_id), agent_id: String(r.agent_id),
          source: String(r.source), status: String(r.status), idempotency_key: String(r.idempotency_key),
          budget_json: String(r.budget_json ?? '{}'), turn_count: Number(r.turn_count ?? 0), tool_call_count: Number(r.tool_call_count ?? 0),
          error_json: r.error_json ? String(r.error_json) : null,
          created_at: String(r.created_at), updated_at: String(r.updated_at),
        });
      }
    }

    if (legacyMessages) {
      const rows = db.prepare('SELECT * FROM core_conversation_messages ORDER BY workspace_id, conversation_id, created_at, id').all() as
        Array<{ id: string; workspace_id: string; conversation_id: string; run_id: string | null; role: string; content: string; created_at: string; metadata_json: string | null }>;
      const conv = new Map<string, number>();
      const seq = new Map<string, number>();
      const upsertConv = db.prepare("INSERT OR IGNORE INTO core_conversation (id,workspace_id,title,created_at,updated_at) VALUES (?,?, '',?,?)");
      const insertMsg = db.prepare(`INSERT OR IGNORE INTO core_message
        (id,workspace_id,conversation_id,run_id,seq,role,content,metadata_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const r of rows) {
        const key = `${r.workspace_id} ${r.conversation_id}`;
        if (!conv.has(key)) {
          void upsertConv.run(r.conversation_id, r.workspace_id, r.created_at, r.created_at);
          conv.set(key, 1);
          seq.set(key, 0);
        }
        const next = (seq.get(key) ?? 0) + 1;
        seq.set(key, next);
        void insertMsg.run(r.id, r.workspace_id, r.conversation_id, r.run_id, next, r.role, r.content, r.metadata_json, r.created_at);
      }
    }

    if (legacyEvents) {
      const rows = db.prepare('SELECT event_id, run_id, sequence, type, occurred_at, payload_json FROM core_run_events').all() as
        Array<{ event_id: string; run_id: string; sequence: number; type: string; occurred_at: string; payload_json: string }>;
      const insert = db.prepare(`INSERT OR IGNORE INTO core_run_event (event_id,run_id,sequence,type,occurred_at,payload_json)
        VALUES (?,?,?,?,?,?)`);
      for (const r of rows) void insert.run(r.event_id, r.run_id, r.sequence, r.type, r.occurred_at, r.payload_json);
    }

    for (const old of ['core_providers', 'core_agents', 'core_cron_jobs', 'core_skills', 'core_run_events', 'core_runs', 'core_conversation_messages']) {
      if (tableExists(db, old)) db.exec(`DROP TABLE ${old}`);
    }
    db.exec('RELEASE SAVEPOINT legacy_reconcile');
  } catch (error) {
    db.exec('ROLLBACK TO SAVEPOINT legacy_reconcile');
    db.exec('RELEASE SAVEPOINT legacy_reconcile');
    throw error;
  }
}

/** Seed the default workspace and default agent on a fresh database. */
export function seedDefaults(db: DB): void {
  const ts = now();
  db.prepare("INSERT OR IGNORE INTO core_workspace (id,name,created_at,updated_at) VALUES ('default','Default',?,?)").run(ts, ts);
  db.prepare(`INSERT OR IGNORE INTO core_agent
    (id,workspace_id,name,system_prompt,provider_id,model,tools_policy_json,memory_policy_json,budget_json,bindings_json,enabled,is_default,config_json,created_at,updated_at)
    VALUES ('main','default','Main','',NULL,NULL,'{}','{}','{}','[]',1,1,'{}',?,?)`).run(ts, ts);
}
