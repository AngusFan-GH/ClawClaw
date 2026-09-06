/**
 * Channel accounts and inbound/outbound orchestration.
 *
 * Non-secret config lives in `core_channel_account`; secret fields live only in
 * the OS keychain (`channel:<ws>:<id>`, one JSON blob). Inbound messages are
 * size-limited, carry a source id and an idempotency key, and are routed to the
 * agent bound to that account to create a `source: channel` run.
 */
import type { CoreDatabase } from '../db/database';
import { CoreError, fail } from '../errors';
import { Keychain, channelAccount as channelAccountName } from '../secrets/keychain';
import { isoNow, newId } from '../util';
import type { ChannelRegistry } from './adapters';
import type { AdapterConfig, AdapterSecrets, ChannelAdapter, ChannelCapability, ChannelStatus } from './types';

const MAX_INBOUND_BYTES = 256 * 1024;

export interface AccountInput {
  adapter: string;
  displayName: string;
  config?: AdapterConfig;
  secrets?: AdapterSecrets;
}

export interface InboundInput {
  sourceId: string;
  idempotencyKey: string;
  sender?: string;
  text: string;
}

export interface InboundResult {
  routed: boolean;
  runId?: string;
  conversationId?: string;
  reason?: string;
}

interface AccountRow {
  id: string; workspace_id: string; adapter: string; display_name: string; status: ChannelStatus;
  config_json: string; capabilities_json: string; last_error_code: string | null; last_error_message: string | null;
  connected_at: string | null; last_activity_at: string | null; inbound_started: number;
  created_at: string; updated_at: string;
}

export interface AccountView {
  id: string;
  workspaceId: string;
  adapter: string;
  displayName: string;
  status: ChannelStatus;
  config: AdapterConfig;
  capabilities: ChannelCapability;
  supported: boolean;
  unsupportedReason?: string;
  inboundStarted: boolean;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  connectedAt?: string;
  lastActivityAt?: string;
  hasSecrets: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BindingResolver {
  agentIdFor(workspaceId: string, channelType: string, accountId: string): string | undefined;
  unbindAccount(workspaceId: string, accountId: string): void;
}

export interface ChannelRunStarter {
  (workspaceId: string, request: { agentId: string; accountId: string; sourceId: string; sender?: string; text: string }): Promise<{ runId: string; conversationId: string }>;
}

const VALID_TRANSITIONS: Record<ChannelStatus, ChannelStatus[]> = {
  unconfigured: ['configured', 'error'],
  configured: ['connecting', 'connected', 'unconfigured', 'error'],
  connecting: ['connected', 'error', 'configured', 'disconnected'],
  connected: ['disconnected', 'connecting', 'error', 'configured'],
  disconnected: ['connecting', 'connected', 'configured', 'error'],
  error: ['configured', 'connecting', 'connected', 'unconfigured', 'disconnected'],
};

export class ChannelService {
  private runStarter: ChannelRunStarter | null = null;

  constructor(
    private readonly ctx: CoreDatabase,
    private readonly keychain: Keychain,
    private readonly registry: ChannelRegistry,
    private readonly bindings: BindingResolver,
  ) {}

  setRunStarter(starter: ChannelRunStarter): void {
    this.runStarter = starter;
  }

  private get db() {
    return this.ctx.db;
  }

  adapterCatalog() {
    return this.registry.list().map(a => ({
      type: a.type,
      label: a.label,
      supported: a.supported,
      unsupportedReason: a.unsupportedReason,
      capability: a.capability,
      configFields: a.configFields,
      secretFields: a.secretFields.map(f => ({ ...f })),
    }));
  }

  listAccounts(workspaceId = 'default'): AccountView[] {
    return (this.db.prepare('SELECT * FROM core_channel_account WHERE workspace_id=? ORDER BY created_at').all(workspaceId) as unknown as AccountRow[])
      .map(r => this.toView(r));
  }

  getRow(workspaceId: string, id: string): AccountRow | undefined {
    return this.db.prepare('SELECT * FROM core_channel_account WHERE workspace_id=? AND id=?').get(workspaceId, id) as unknown as AccountRow | undefined;
  }

  get(workspaceId: string, id: string): AccountView {
    return this.toView(this.requireRow(workspaceId, id));
  }

  async createAccount(workspaceId: string, input: AccountInput): Promise<AccountView> {
    const adapter = this.requireSupportedAdapter(input.adapter);
    const config = this.sanitizeConfig(adapter, input.config ?? {});
    const secrets = this.sanitizeSecrets(adapter, input.secrets ?? {});
    const result = await adapter.validate(config, secrets);
    if (!result.ok) fail('CHANNEL_INVALID_CONFIG', result.message ?? 'Invalid channel configuration');
    const id = newId();
    const ts = isoNow();
    this.db.prepare(`INSERT INTO core_channel_account
      (id,workspace_id,adapter,display_name,status,config_json,capabilities_json,last_error_code,last_error_message,connected_at,last_activity_at,inbound_started,created_at,updated_at)
      VALUES (?,?,?,?,'configured',?,?,'','',NULL,NULL,0,?,?)`)
      .run(id, workspaceId, adapter.type, input.displayName?.trim() || adapter.label,
        JSON.stringify(config), JSON.stringify(adapter.capability), ts, ts);
    if (Object.keys(secrets).length) await this.putSecrets(id, workspaceId, secrets);
    return this.get(workspaceId, id);
  }

  async updateConfig(workspaceId: string, id: string, config: AdapterConfig, secrets?: AdapterSecrets): Promise<AccountView> {
    const row = this.requireRow(workspaceId, id);
    const adapter = this.requireSupportedAdapter(row.adapter);
    const cleanConfig = this.sanitizeConfig(adapter, config);
    const mergedSecrets = { ...(await this.getSecrets(workspaceId, id)), ...this.sanitizeSecrets(adapter, secrets ?? {}) };
    const result = await adapter.validate(cleanConfig, mergedSecrets);
    if (!result.ok) fail('CHANNEL_INVALID_CONFIG', result.message ?? 'Invalid channel configuration');
    this.ctx.transaction(() => {
      this.db.prepare('UPDATE core_channel_account SET config_json=?, status=?, last_error_code=NULL, last_error_message=NULL, updated_at=? WHERE workspace_id=? AND id=?')
        .run(JSON.stringify(cleanConfig), 'configured', isoNow(), workspaceId, id);
    });
    if (secrets && Object.keys(secrets).length) await this.putSecrets(id, workspaceId, mergedSecrets);
    return this.get(workspaceId, id);
  }

  async connect(workspaceId: string, id: string): Promise<AccountView> {
    const row = this.requireRow(workspaceId, id);
    const adapter = this.requireSupportedAdapter(row.adapter);
    const config = this.readConfig(row);
    const secrets = await this.getSecrets(workspaceId, id);
    const result = await adapter.validate(config, secrets);
    if (!result.ok) {
      this.recordError(workspaceId, id, result.code ?? 'CHANNEL_INVALID_CONFIG', result.message ?? 'Invalid config');
      fail('CHANNEL_INVALID_CONFIG', result.message ?? 'Invalid channel configuration');
    }
    this.applyStatus(workspaceId, id, 'connecting');
    try {
      await adapter.connect(config, secrets);
    } catch (error) {
      const { code, message } = classify(error);
      this.recordError(workspaceId, id, code, message);
      throw error;
    }
    this.ctx.transaction(() => {
      this.db.prepare('UPDATE core_channel_account SET status=?, connected_at=?, last_error_code=NULL, last_error_message=NULL, updated_at=? WHERE workspace_id=? AND id=?')
        .run('connected', isoNow(), isoNow(), workspaceId, id);
    });
    return this.get(workspaceId, id);
  }

  async disconnect(workspaceId: string, id: string): Promise<AccountView> {
    const row = this.requireRow(workspaceId, id);
    const adapter = this.registry.get(row.adapter);
    await adapter.disconnect().catch(() => undefined);
    this.ctx.transaction(() => {
      this.db.prepare('UPDATE core_channel_account SET status=?, inbound_started=0, updated_at=? WHERE workspace_id=? AND id=?')
        .run('disconnected', isoNow(), workspaceId, id);
    });
    return this.get(workspaceId, id);
  }

  async send(workspaceId: string, id: string, text: string): Promise<{ delivered: boolean; providerMessageId?: string }> {
    const row = this.requireRow(workspaceId, id);
    const adapter = this.requireSupportedAdapter(row.adapter);
    const secrets = await this.getSecrets(workspaceId, id);
    const result = await adapter.send(this.readConfig(row), secrets, text);
    this.db.prepare('UPDATE core_channel_account SET last_activity_at=? WHERE workspace_id=? AND id=?').run(isoNow(), workspaceId, id);
    if (!result.delivered) this.recordError(workspaceId, id, result.code ?? 'CHANNEL_SEND_FAILED', result.message ?? 'Send failed');
    return { delivered: result.delivered, providerMessageId: result.providerMessageId };
  }

  startInbound(workspaceId: string, id: string): void {
    const row = this.requireRow(workspaceId, id);
    this.requireSupportedAdapter(row.adapter); // rejects QR/OAuth
    this.db.prepare('UPDATE core_channel_account SET inbound_started=1, updated_at=? WHERE workspace_id=? AND id=?').run(isoNow(), workspaceId, id);
  }

  stopInbound(workspaceId: string, id: string): void {
    this.requireRow(workspaceId, id);
    this.db.prepare('UPDATE core_channel_account SET inbound_started=0, updated_at=? WHERE workspace_id=? AND id=?').run(isoNow(), workspaceId, id);
  }

  /** Push an inbound message (webhook receiver / test harness). Routed to a bound agent. */
  async ingest(workspaceId: string, id: string, input: InboundInput): Promise<InboundResult> {
    const row = this.requireRow(workspaceId, id);
    if (!input.sourceId || !input.idempotencyKey) fail('INVALID_ARGUMENT', 'sourceId and idempotencyKey are required');
    const byteSize = Buffer.byteLength(input.text ?? '', 'utf8');
    if (byteSize > MAX_INBOUND_BYTES) fail('CHANNEL_PAYLOAD_TOO_LARGE', 'Inbound message exceeds the size limit');

    // Idempotent insert (dedupe by account + key).
    const inserted = this.ctx.transaction(() => {
      const result = this.db.prepare(`INSERT OR IGNORE INTO core_channel_inbound
        (id,workspace_id,account_id,source_id,idempotency_key,sender,payload_kind,size_bytes,run_id,received_at)
        VALUES (?,?,?,?,?,?, 'text',?,NULL,?)`)
        .run(newId(), workspaceId, id, input.sourceId, input.idempotencyKey, input.sender ?? null, byteSize, isoNow());
      return result.changes > 0;
    });
    if (!inserted) return { routed: false, reason: 'duplicate' };
    this.db.prepare('UPDATE core_channel_account SET last_activity_at=? WHERE workspace_id=? AND id=?').run(isoNow(), workspaceId, id);

    const agentId = this.bindings.agentIdFor(workspaceId, row.adapter, id);
    if (!agentId) {
      this.recordError(workspaceId, id, 'CHANNEL_NOT_CONFIGURED', 'No agent is bound to this channel account');
      return { routed: false, reason: 'no_agent_binding' };
    }
    if (!this.runStarter) return { routed: false, reason: 'run_starter_unavailable' };
    const started = await this.runStarter(workspaceId, { agentId, accountId: id, sourceId: input.sourceId, sender: input.sender, text: input.text });
    this.db.prepare('UPDATE core_channel_inbound SET run_id=? WHERE workspace_id=? AND account_id=? AND idempotency_key=?')
      .run(started.runId, workspaceId, id, input.idempotencyKey);
    return { routed: true, runId: started.runId, conversationId: started.conversationId };
  }

  async deleteAccount(workspaceId: string, id: string): Promise<void> {
    this.requireRow(workspaceId, id);
    await this.keychain.remove(channelAccountName(workspaceId, id)).catch(() => undefined);
    this.ctx.transaction(() => {
      this.db.prepare('DELETE FROM core_channel_inbound WHERE workspace_id=? AND account_id=?').run(workspaceId, id);
      this.db.prepare('DELETE FROM core_channel_account WHERE workspace_id=? AND id=?').run(workspaceId, id);
    });
    this.bindings.unbindAccount(workspaceId, id);
  }

  // ---- internals ----------------------------------------------------------

  private requireRow(workspaceId: string, id: string): AccountRow {
    return this.getRow(workspaceId, id) ?? fail('CHANNEL_NOT_CONFIGURED', 'The channel account does not exist');
  }

  private requireSupportedAdapter(type: string): ChannelAdapter {
    const adapter = this.registry.get(type);
    if (!adapter.supported) fail('CHANNEL_UNSUPPORTED_CAPABILITY', adapter.unsupportedReason ?? 'This channel is not supported');
    return adapter;
  }

  private applyStatus(workspaceId: string, id: string, next: ChannelStatus): void {
    const current = this.requireRow(workspaceId, id).status;
    if (current === next) return;
    if (!VALID_TRANSITIONS[current]?.includes(next)) {
      fail('CONFLICT', `Illegal channel status transition ${current} -> ${next}`);
    }
    this.db.prepare('UPDATE core_channel_account SET status=?, updated_at=? WHERE workspace_id=? AND id=?').run(next, isoNow(), workspaceId, id);
  }

  private recordError(workspaceId: string, id: string, code: string, message: string): void {
    const current = this.getRow(workspaceId, id);
    const next: ChannelStatus = current && VALID_TRANSITIONS[current.status].includes('error') ? 'error' : current?.status ?? 'error';
    this.db.prepare('UPDATE core_channel_account SET status=?, last_error_code=?, last_error_message=?, updated_at=? WHERE workspace_id=? AND id=?')
      .run(next, code, message.slice(0, 200), isoNow(), workspaceId, id);
  }

  private readConfig(row: AccountRow): AdapterConfig {
    try { return JSON.parse(row.config_json) as unknown as AdapterConfig; } catch { return {}; }
  }

  private sanitizeConfig(adapter: ChannelAdapter, config: AdapterConfig): AdapterConfig {
    const secretKeys = new Set(adapter.secretFields.map(f => f.key));
    const out: AdapterConfig = {};
    for (const field of adapter.configFields) {
      if (secretKeys.has(field.key)) continue;
      const value = config[field.key];
      if (value !== undefined) out[field.key] = typeof value === 'string' ? value.slice(0, 2000) : value;
    }
    return out;
  }

  private sanitizeSecrets(adapter: ChannelAdapter, secrets: AdapterSecrets): AdapterSecrets {
    const out: AdapterSecrets = {};
    for (const field of adapter.secretFields) {
      const value = secrets[field.key];
      if (typeof value === 'string' && value.length > 0 && value.length <= 4096) out[field.key] = value;
    }
    return out;
  }

  private async putSecrets(id: string, workspaceId: string, secrets: AdapterSecrets): Promise<void> {
    await this.keychain.put(channelAccountName(workspaceId, id), JSON.stringify(secrets));
  }

  private async getSecrets(workspaceId: string, id: string): Promise<AdapterSecrets> {
    const raw = await this.keychain.get(channelAccountName(workspaceId, id));
    if (!raw) return {};
    try { return JSON.parse(raw) as unknown as AdapterSecrets; } catch { return {}; }
  }

  private toView(r: AccountRow): AccountView {
    const adapter = this.registry.has(r.adapter) ? this.registry.get(r.adapter) : undefined;
    let config: AdapterConfig;
    try { config = JSON.parse(r.config_json) as unknown as AdapterConfig; } catch { config = {}; }
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      adapter: r.adapter,
      displayName: r.display_name,
      status: r.status,
      config,
      capabilities: (safeJson(r.capabilities_json) ?? { outbound: false, inbound: false, auth: 'token' }) as unknown as AccountView['capabilities'],
      supported: adapter?.supported ?? false,
      unsupportedReason: adapter?.unsupportedReason,
      inboundStarted: r.inbound_started === 1,
      lastErrorCode: r.last_error_code ?? undefined,
      lastErrorMessage: r.last_error_message ?? undefined,
      connectedAt: r.connected_at ?? undefined,
      lastActivityAt: r.last_activity_at ?? undefined,
      hasSecrets: false, // secrets are never returned; resolved by callers that need a boolean
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}

function safeJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return undefined; }
}

function classify(error: unknown): { code: string; message: string } {
  if (error instanceof CoreError) return { code: error.code, message: error.message };
  return { code: 'CHANNEL_SEND_FAILED', message: error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'channel error' };
}
