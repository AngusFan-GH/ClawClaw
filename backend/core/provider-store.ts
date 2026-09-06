/**
 * Provider persistence and credential lifecycle.
 *
 * Non-secret metadata lives in `core_provider` (workspace-scoped). Credentials
 * live ONLY in the OS keychain under `provider:<workspaceId>:<providerId>`.
 * `has_secret` is set to 1 only after a write+readback verification succeeds.
 */
import type { CoreDatabase } from './db/database';
import { fail } from './errors';
import { Keychain, providerAccount } from './secrets/keychain';
import { getVendor, oauthSupported, type ApiProtocol, type AuthMode, type VendorDefinition } from './provider-catalog';
import { isoNow, newId } from './util';

export interface ProviderInput {
  id?: string;
  vendorId: string;
  label?: string;
  authMode?: AuthMode;
  baseUrl?: string | null;
  apiProtocol?: ApiProtocol | null;
  model?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
}

export interface ProviderRow {
  id: string;
  workspace_id: string;
  vendor_id: string;
  label: string;
  auth_mode: AuthMode;
  base_url: string | null;
  api_protocol: ApiProtocol | null;
  model: string | null;
  enabled: number;
  is_default: number;
  has_secret: number;
  config_json: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderView {
  id: string;
  workspaceId: string;
  vendorId: string;
  label: string;
  authMode: AuthMode;
  baseUrl?: string;
  apiProtocol: ApiProtocol;
  model?: string;
  enabled: boolean;
  isDefault: boolean;
  hasSecret: boolean;
  category: VendorDefinition['category'];
  requiresSecret: boolean;
  oauthSupported: boolean;
  editableBaseUrl: boolean;
  editableModel: boolean;
  keyUrl?: string;
  defaultModel?: string;
  createdAt: string;
  updatedAt: string;
}

export class ProviderStore {
  constructor(private readonly ctx: CoreDatabase, private readonly keychain: Keychain) {}

  private get db() {
    return this.ctx.db;
  }

  list(workspaceId = 'default'): ProviderView[] {
    const rows = this.db
      .prepare('SELECT * FROM core_provider WHERE workspace_id = ? ORDER BY is_default DESC, updated_at DESC')
      .all(workspaceId) as unknown as ProviderRow[];
    return rows.map(r => this.toView(r));
  }

  getRow(workspaceId: string, id: string): ProviderRow | undefined {
    return this.db.prepare('SELECT * FROM core_provider WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as
      | ProviderRow
      | undefined;
  }

  get(workspaceId: string, id: string): ProviderView | undefined {
    const row = this.getRow(workspaceId, id);
    return row ? this.toView(row) : undefined;
  }

  requireRow(workspaceId: string, id: string): ProviderRow {
    return this.getRow(workspaceId, id) ?? fail('PROVIDER_NOT_FOUND', 'The model provider does not exist');
  }

  getDefault(workspaceId = 'default'): ProviderRow | undefined {
    return this.db
      .prepare('SELECT * FROM core_provider WHERE workspace_id = ? AND is_default = 1')
      .get(workspaceId) as unknown as ProviderRow | undefined;
  }

  create(workspaceId: string, input: ProviderInput): ProviderView {
    const vendor = getVendor(input.vendorId);
    const id = input.id?.trim() || newId();
    if (this.getRow(workspaceId, id)) fail('CONFLICT', 'A provider with this id already exists');
    const ts = isoNow();
    const authMode = input.authMode ?? vendor.defaultAuthMode;
    if (authMode.startsWith('oauth_') && !oauthSupported(vendor.id, authMode)) {
      fail('OAUTH_UNSUPPORTED', 'OAuth sign-in is not supported yet for this provider; use an API key');
    }
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? vendor.defaultBaseUrl ?? null);
    const becomesDefault = input.isDefault ?? !this.getDefault(workspaceId);
    this.ctx.transaction(() => {
      if (becomesDefault) this.clearDefault(workspaceId);
      this.db
        .prepare(`INSERT INTO core_provider
          (id,workspace_id,vendor_id,label,auth_mode,base_url,api_protocol,model,enabled,is_default,has_secret,config_json,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,0,'{}',?,?)`)
        .run(
          id, workspaceId, vendor.id, input.label?.trim() || vendor.label, authMode,
          baseUrl, input.apiProtocol ?? vendor.protocol, (input.model ?? vendor.defaultModel ?? '').trim() || null,
          input.enabled === false ? 0 : 1, becomesDefault ? 1 : 0, ts, ts,
        );
    });
    return this.toView(this.requireRow(workspaceId, id));
  }

  update(workspaceId: string, id: string, input: Omit<ProviderInput, 'id'>): ProviderView {
    const current = this.requireRow(workspaceId, id);
    const vendor = getVendor(input.vendorId ?? current.vendor_id);
    const authMode = input.authMode ?? (current.auth_mode as AuthMode);
    if (authMode.startsWith('oauth_') && !oauthSupported(vendor.id, authMode)) {
      fail('OAUTH_UNSUPPORTED', 'OAuth sign-in is not supported yet for this provider; use an API key');
    }
    const baseUrl = input.baseUrl === undefined ? current.base_url : normalizeBaseUrl(input.baseUrl);
    const model = input.model === undefined ? current.model : input.model?.trim() || null;
    const ts = isoNow();
    this.ctx.transaction(() => {
      if (input.isDefault === true && current.is_default === 0) this.clearDefault(workspaceId);
      if (input.isDefault === false && current.is_default === 1) {
        const replacement = this.enabledReplacement(workspaceId, id);
        if (replacement) this.db.prepare('UPDATE core_provider SET is_default=1 WHERE workspace_id=? AND id=?').run(workspaceId, replacement);
      }
      this.db
        .prepare(`UPDATE core_provider SET
           vendor_id=?, label=?, auth_mode=?, base_url=?, api_protocol=?, model=?,
           enabled=COALESCE(?, enabled), is_default=?, updated_at=?
           WHERE workspace_id=? AND id=?`)
        .run(
          vendor.id, input.label?.trim() || current.label, authMode, baseUrl,
          input.apiProtocol ?? current.api_protocol, model,
          input.enabled === undefined ? null : input.enabled ? 1 : 0,
          input.isDefault === undefined ? current.is_default : input.isDefault ? 1 : 0,
          ts, workspaceId, id,
        );
    });
    return this.toView(this.requireRow(workspaceId, id));
  }

  setDefault(workspaceId: string, id: string): ProviderView {
    this.requireRow(workspaceId, id);
    this.ctx.transaction(() => {
      this.clearDefault(workspaceId);
      this.db.prepare('UPDATE core_provider SET is_default=1, updated_at=? WHERE workspace_id=? AND id=?').run(isoNow(), workspaceId, id);
    });
    return this.toView(this.requireRow(workspaceId, id));
  }

  setEnabled(workspaceId: string, id: string, enabled: boolean): ProviderView {
    const current = this.requireRow(workspaceId, id);
    if (!enabled && current.is_default === 1) {
      const replacement = this.enabledReplacement(workspaceId, id);
      this.ctx.transaction(() => {
        this.db.prepare('UPDATE core_provider SET is_default=0, enabled=0, updated_at=? WHERE workspace_id=? AND id=?').run(isoNow(), workspaceId, id);
        if (replacement) this.db.prepare('UPDATE core_provider SET is_default=1 WHERE workspace_id=? AND id=?').run(workspaceId, replacement);
      });
    } else {
      this.db.prepare('UPDATE core_provider SET enabled=?, updated_at=? WHERE workspace_id=? AND id=?').run(enabled ? 1 : 0, isoNow(), workspaceId, id);
    }
    return this.toView(this.requireRow(workspaceId, id));
  }

  async delete(workspaceId: string, id: string): Promise<void> {
    this.requireRow(workspaceId, id);
    await this.keychain.remove(providerAccount(workspaceId, id)).catch(() => undefined);
    this.ctx.transaction(() => {
      const wasDefault = (this.getRow(workspaceId, id)?.is_default ?? 0) === 1;
      this.db.prepare('DELETE FROM core_provider WHERE workspace_id=? AND id=?').run(workspaceId, id);
      if (wasDefault) {
        const replacement = this.enabledReplacement(workspaceId, null);
        if (replacement) this.db.prepare('UPDATE core_provider SET is_default=1 WHERE workspace_id=? AND id=?').run(workspaceId, replacement);
      }
    });
  }

  async putSecret(workspaceId: string, id: string, secret: string): Promise<ProviderView> {
    this.requireRow(workspaceId, id);
    const account = providerAccount(workspaceId, id);
    await this.keychain.put(account, secret); // throws unless write+readback verified
    this.ctx.transaction(() => {
      this.db.prepare('UPDATE core_provider SET has_secret=1, updated_at=? WHERE workspace_id=? AND id=?').run(isoNow(), workspaceId, id);
    });
    return this.toView(this.requireRow(workspaceId, id));
  }

  async deleteSecret(workspaceId: string, id: string): Promise<ProviderView> {
    this.requireRow(workspaceId, id);
    await this.keychain.remove(providerAccount(workspaceId, id));
    this.ctx.transaction(() => {
      this.db.prepare('UPDATE core_provider SET has_secret=0, updated_at=? WHERE workspace_id=? AND id=?').run(isoNow(), workspaceId, id);
    });
    return this.toView(this.requireRow(workspaceId, id));
  }

  /**
   * Resolve the live credential. Reconciles `has_secret` with the keychain:
   * a missing entry clears a stale flag and yields an actionable error.
   */
  async getSecret(workspaceId: string, id: string): Promise<string | null> {
    const row = this.requireRow(workspaceId, id);
    const value = await this.keychain.get(providerAccount(workspaceId, id));
    if (value === null) {
      if (row.has_secret === 1) {
        this.db.prepare('UPDATE core_provider SET has_secret=0, updated_at=? WHERE workspace_id=? AND id=?').run(isoNow(), workspaceId, id);
      }
      return null;
    }
    if (row.has_secret === 0) {
      this.db.prepare('UPDATE core_provider SET has_secret=1, updated_at=? WHERE workspace_id=? AND id=?').run(isoNow(), workspaceId, id);
    }
    return value;
  }

  /**
   * Move legacy plaintext credentials into the keychain. Each staged value is
   * written and read back before its staging row is deleted; a failure leaves
   * the legacy value in place (never exposed to the renderer) for a later run.
   */
  async migrateLegacySecrets(): Promise<{ migrated: number; pending: number }> {
    const pending = this.db.prepare('SELECT id, account, value FROM core_secret_migration').all() as
      Array<{ id: number; account: string; value: string }>;
    let migrated = 0;
    for (const entry of pending) {
      const match = /^provider:([^:]+):(.+)$/.exec(entry.account);
      if (!match) continue;
      const [, workspaceId, providerId] = match;
      const provider = this.getRow(workspaceId, providerId);
      try {
        await this.keychain.put(entry.account, entry.value);
      } catch {
        continue; // actionable keychain problem; staging preserved for retry next launch
      }
      this.ctx.transaction(() => {
        if (provider) this.db.prepare('UPDATE core_provider SET has_secret=1, updated_at=? WHERE workspace_id=? AND id=?').run(isoNow(), workspaceId, providerId);
        this.db.prepare('DELETE FROM core_secret_migration WHERE id=?').run(entry.id);
      });
      migrated += 1;
    }
    const remaining = (this.db.prepare('SELECT COUNT(*) c FROM core_secret_migration').get() as unknown as { c: number }).c;
    if (migrated > 0 && remaining === 0) {
      // Physically purge the deleted plaintext from free pages and the WAL.
      try {
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
      } catch { /* best effort; staging value is never exposed while it remains */ }
    }
    return { migrated, pending: remaining };
  }

  private enabledReplacement(workspaceId: string, excludeId: string | null): string | null {
    const row = this.db
      .prepare('SELECT id FROM core_provider WHERE workspace_id=? AND enabled=1 AND (? IS NULL OR id<>?) ORDER BY is_default DESC, updated_at DESC LIMIT 1')
      .get(workspaceId, excludeId, excludeId) as unknown as { id: string } | undefined;
    return row?.id ?? null;
  }

  private clearDefault(workspaceId: string): void {
    this.db.prepare('UPDATE core_provider SET is_default=0 WHERE workspace_id=?').run(workspaceId);
  }

  private toView(r: ProviderRow): ProviderView {
    const vendor = getVendor(r.vendor_id);
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      vendorId: r.vendor_id,
      label: r.label,
      authMode: r.auth_mode as AuthMode,
      baseUrl: r.base_url ?? undefined,
      apiProtocol: (r.api_protocol as ApiProtocol) ?? vendor.protocol,
      model: r.model ?? undefined,
      enabled: r.enabled === 1,
      isDefault: r.is_default === 1,
      hasSecret: r.has_secret === 1,
      category: vendor.category,
      requiresSecret: r.auth_mode === 'api_key',
      oauthSupported: oauthSupported(r.vendor_id, r.auth_mode as AuthMode),
      editableBaseUrl: vendor.editableBaseUrl,
      editableModel: vendor.editableModel,
      keyUrl: vendor.keyUrl,
      defaultModel: vendor.defaultModel,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  if (!/^https?:\/\/[^\s]+$/i.test(trimmed)) {
    fail('INVALID_ARGUMENT', 'baseUrl must be an http(s) URL');
  }
  return trimmed;
}
