// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { CoreDatabase } from '@backend/core/db/database';
import { Keychain } from '@backend/core/secrets/keychain';
import { ProviderStore } from '@backend/core/provider-store';
import { ProviderValidator } from '@backend/core/provider-validation';
import { FakeSecretBridge } from '@backend/core/native/secret-bridge';
import { CoreError } from '@backend/core/errors';
import { join } from 'node:path';
import { tempDir } from './helpers/runtime-harness';

function store(secrets = new FakeSecretBridge()) {
  const dataDir = tempDir();
  const db = new CoreDatabase(join(dataDir, 'c.sqlite'));
  const keychain = new Keychain(secrets);
  return { db, providers: new ProviderStore(db, keychain), keychain, dataDir };
}

describe('ProviderStore', () => {
  it('creates the first provider as default with truthful hasSecret', async () => {
    const t = store();
    const p = t.providers.create('default', { vendorId: 'openai', model: 'gpt' });
    expect(p.isDefault).toBe(true);
    expect(p.hasSecret).toBe(false);
    expect(p.requiresSecret).toBe(true);

    const saved = await t.providers.putSecret('default', p.id, 'sk-abc');
    expect(saved.hasSecret).toBe(true);
    expect(await t.providers.getSecret('default', p.id)).toBe('sk-abc');
    t.db.close();
  });

  it('keeps exactly one default per workspace', () => {
    const t = store();
    const a = t.providers.create('default', { vendorId: 'openai', model: 'a' });
    const b = t.providers.create('default', { vendorId: 'anthropic', model: 'b' });
    expect(a.isDefault).toBe(true);
    expect(b.isDefault).toBe(false);
    t.providers.setDefault('default', b.id);
    expect(t.providers.list('default').filter(p => p.isDefault)).toHaveLength(1);

    // workspaces are isolated
    expect(t.providers.list('other')).toHaveLength(0);
    const other = t.providers.create('other', { vendorId: 'openai', model: 'x' });
    expect(other.isDefault).toBe(true);
    expect(t.providers.list('default').filter(p => p.isDefault)).toHaveLength(1);
    t.db.close();
  });

  it('reassigns an enabled default when one is disabled or deleted', async () => {
    const t = store();
    const a = t.providers.create('default', { vendorId: 'openai', model: 'a' });
    const b = t.providers.create('default', { vendorId: 'anthropic', model: 'b' });
    t.providers.setEnabled('default', a.id, false);
    expect(t.providers.getDefault('default')?.id).toBe(b.id);
    await t.providers.delete('default', b.id);
    // only a disabled provider remains -> explicitly unconfigured (no false default)
    expect(t.providers.getDefault('default')).toBeUndefined();

    // deleting an enabled default promotes another enabled provider
    const c = t.providers.create('default', { vendorId: 'openai', model: 'c' }); // becomes default (none set)
    t.providers.setEnabled('default', a.id, true);
    t.providers.setDefault('default', c.id);
    const d = t.providers.create('default', { vendorId: 'anthropic', model: 'd' });
    await t.providers.delete('default', c.id);
    expect([a.id, d.id]).toContain(t.providers.getDefault('default')?.id);
    t.db.close();
  });

  it('clears a stale hasSecret flag when the keychain entry is gone', async () => {
    const t = store();
    const p = t.providers.create('default', { vendorId: 'openai', model: 'a' });
    await t.providers.putSecret('default', p.id, 'sk-1');
    // simulate keychain loss directly
    await t.keychain.remove(`provider:default:${p.id}`);
    expect(await t.providers.getSecret('default', p.id)).toBeNull();
    expect(t.providers.get('default', p.id)?.hasSecret).toBe(false);
    t.db.close();
  });
});

describe('Keychain write verification', () => {
  it('does not mark hasSecret when the keychain rejects writes', async () => {
    const bridge = new FakeSecretBridge().denyAccess();
    const t = store(bridge);
    const p = t.providers.create('default', { vendorId: 'openai', model: 'a' });
    await expect(t.providers.putSecret('default', p.id, 'sk-x')).rejects.toBeInstanceOf(CoreError);
    expect(t.providers.get('default', p.id)?.hasSecret).toBe(false);
    t.db.close();
  });

  it('flags readback mismatch as a failure and clears the entry', async () => {
    const bridge = new FakeSecretBridge();
    const keychain = new Keychain(bridge);
    // tamper: store returns a different value on get
    const originalGet = bridge.get.bind(bridge);
    bridge.get = async (account: string) => (account === 'provider:default:p' ? 'different' : originalGet(account));
    await expect(keychain.put('provider:default:p', 'sk-real')).rejects.toMatchObject({ code: 'PROVIDER_SECRET_WRITE_FAILED' });
    expect(bridge.store.get('provider:default:p')).toBeUndefined();
  });
});

describe('ProviderValidator stable codes', () => {
  const row = (overrides: Record<string, unknown> = {}) =>
    ({
      base_url: 'https://api.example.test/v1',
      auth_mode: 'api_key',
      api_protocol: 'openai-completions',
      model: 'm',
      ...overrides,
    }) as never;

  beforeEach(() => undefined);

  it('maps 401/403 to auth failure', async () => {
    const fetchImpl = async () => ({ status: 401, ok: false }) as Response;
    const v = new ProviderValidator(fetchImpl as never);
    const result = await v.validate(row(), 'sk');
    expect(result).toMatchObject({ ok: false, code: 'PROVIDER_AUTH_FAILED' });
  });

  it('maps 429 and timeout', async () => {
    const v429 = new ProviderValidator(async () => ({ status: 429, ok: false }) as Response);
    expect((await v429.validate(row(), 'sk')).code).toBe('PROVIDER_RATE_LIMITED');

    const vTimeout = new ProviderValidator(async () => {
      throw new Error('The operation was aborted due to timeout');
    });
    expect((await vTimeout.validate(row(), 'sk')).code).toBe('PROVIDER_TIMEOUT');
  });

  it('requires a secret for api_key providers', async () => {
    const v = new ProviderValidator(async () => ({ status: 200, ok: true }) as Response);
    const result = await v.validate(row(), null);
    expect(result.code).toBe('PROVIDER_SECRET_MISSING');
  });

  it('allows local providers without a key', async () => {
    const v = new ProviderValidator(async (url: string) => {
      expect(String(url).startsWith('http://127.0.0.1')).toBe(true);
      return { status: 200, ok: true } as Response;
    });
    const result = await v.validate(row({ base_url: 'http://127.0.0.1:11434/v1', auth_mode: 'local' }), null);
    expect(result.ok).toBe(true);
  });
});
