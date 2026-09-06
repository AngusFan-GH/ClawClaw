// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { CoreDatabase } from '@backend/core/db/database';
import { Keychain } from '@backend/core/secrets/keychain';
import { FakeSecretBridge } from '@backend/core/native/secret-bridge';
import { ChannelService } from '@backend/core/channels/channel-service';
import { defaultChannelRegistry, WebhookChannelAdapter } from '@backend/core/channels/adapters';
import { CoreError } from '@backend/core/errors';
import { tempDir } from './helpers/runtime-harness';

function service(fetchImpl?: typeof globalThis.fetch) {
  const db = new CoreDatabase(join(tempDir(), 'c.sqlite'));
  const keychain = new Keychain(new FakeSecretBridge());
  const bindings = {
    map: new Map<string, string>(),
    agentIdFor(ws: string, type: string, accountId: string) {
      return this.map.get(`${ws}:${type}:${accountId}`) ?? this.map.get(`${ws}:${type}:default`);
    },
    unbindAccount() {
      /* no-op */
    },
  };
  const channels = new ChannelService(db, keychain, defaultChannelRegistry(fetchImpl), bindings);
  return { db, keychain, channels, bindings };
}

function jsonResponse(status: number, body: unknown = {}) {
  return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => '' } as Response;
}

describe('channel catalog', () => {
  it('marks webhook supported and QR adapters unsupported', () => {
    const catalog = defaultChannelRegistry().list();
    const webhook = catalog.find(a => a.type === 'webhook')!;
    expect(webhook.supported).toBe(true);
    expect(webhook.capability.inbound).toBe(true);
    for (const qr of ['wechat', 'whatsapp']) {
      const adapter = catalog.find(a => a.type === qr)!;
      expect(adapter.supported).toBe(false);
      expect(() => adapter.connect({}, {})).toThrow(/not supported/i);
    }
  });
});

describe('webhook adapter', () => {
  it('validates url + token and posts only to the configured endpoint', async () => {
    const seen: Array<{ url: string; method: string }> = [];
    const adapter = new WebhookChannelAdapter((async (url, init) => {
      seen.push({ url: String(url), method: init.method ?? 'GET' });
      return jsonResponse(200, { id: 'm9' });
    }) as never);
    expect((await adapter.validate({ endpointUrl: 'https://h.test/x' }, { authToken: 't' })).ok).toBe(true);
    expect(await adapter.validate({ endpointUrl: 'notaurl' }, { authToken: 't' })).toMatchObject({ code: 'CHANNEL_INVALID_CONFIG' });
    expect(await adapter.validate({ endpointUrl: 'https://h.test' }, {})).toMatchObject({ code: 'CHANNEL_SECRET_MISSING' });
    const send = await adapter.send({ endpointUrl: 'https://h.test/x' }, { authToken: 't' }, 'hi');
    expect(send.delivered).toBe(true);
    expect(send.providerMessageId).toBe('m9');
    expect(seen.every(s => s.url.startsWith('https://h.test'))).toBe(true);
  });

  it('maps auth/rate-limit/network failures', async () => {
    const adapter401 = new WebhookChannelAdapter((async () => jsonResponse(401)) as never);
    expect((await adapter401.send({ endpointUrl: 'https://h' }, { authToken: 't' }, 'x')).code).toBe('CHANNEL_SECRET_MISSING');
    const adapterNet = new WebhookChannelAdapter((async () => {
      throw new Error('fetch failed');
    }) as never);
    expect((await adapterNet.send({ endpointUrl: 'https://h' }, { authToken: 't' }, 'x')).delivered).toBe(false);
  });
});

describe('ChannelService accounts', () => {
  it('creates configured accounts, stores secrets only in keychain, and connects', async () => {
    let getCount = 0;
    const t = service((async (url, init) => jsonResponse(init.method === 'GET' ? 200 : 200)) as never);
    const acc = await t.channels.createAccount('default', {
      adapter: 'webhook', displayName: 'Hook',
      config: { endpointUrl: 'https://h.test/x' }, secrets: { authToken: 'tok' },
    });
    expect(acc.status).toBe('configured');
    // non-secret config persisted; secret not in config
    expect(acc.config).not.toHaveProperty('authToken');
    expect(await t.keychain.get(`channel:default:${acc.id}`)).toContain('authToken');

    const connected = await t.channels.connect('default', acc.id);
    expect(connected.status).toBe('connected');
    void getCount;
    t.db.close();
  });

  it('rejects QR adapters and unknown types', async () => {
    const t = service();
    await expect(t.channels.createAccount('default', { adapter: 'wechat', displayName: 'W' })).rejects.toThrow(CoreError);
    await expect(t.channels.createAccount('default', { adapter: 'nope', displayName: 'N' })).rejects.toThrow(/unknown channel/i);
    t.db.close();
  });

  it('enforces inbound size limits', async () => {
    const t = service();
    const acc = await t.channels.createAccount('default', {
      adapter: 'webhook', displayName: 'H', config: { endpointUrl: 'https://h.test' }, secrets: { authToken: 't' },
    });
    await expect(t.channels.ingest('default', acc.id, {
      sourceId: 's', idempotencyKey: 'k', text: 'x'.repeat(300_000),
    })).rejects.toThrow(/size limit/i);
    t.db.close();
  });
});

describe('inbound routing + lifecycle', () => {
  it('dedupes by idempotency key and routes to a bound agent', async () => {
    const t = service();
    let started: { agentId: string; text: string } | undefined;
    t.channels.setRunStarter(async (_ws, req) => {
      started = { agentId: req.agentId, text: req.text };
      return { runId: 'run-1', conversationId: `channel:${req.sourceId}` };
    });
    const acc = await t.channels.createAccount('default', {
      adapter: 'webhook', displayName: 'H', config: { endpointUrl: 'https://h.test' }, secrets: { authToken: 't' },
    });
    t.bindings.map.set('default:webhook:' + acc.id, 'main');

    const first = await t.channels.ingest('default', acc.id, { sourceId: 'u1', idempotencyKey: 'i1', text: 'hello' });
    expect(first.routed).toBe(true);
    expect(started?.agentId).toBe('main');
    expect(started?.text).toBe('hello');

    const dup = await t.channels.ingest('default', acc.id, { sourceId: 'u1', idempotencyKey: 'i1', text: 'hello' });
    expect(dup.routed).toBe(false);
    expect(dup.reason).toBe('duplicate');

    // no binding => recorded but not routed
    const other = await t.channels.createAccount('default', {
      adapter: 'webhook', displayName: 'H2', config: { endpointUrl: 'https://h2.test' }, secrets: { authToken: 't' },
    });
    const unbound = await t.channels.ingest('default', other.id, { sourceId: 'u2', idempotencyKey: 'i2', text: 'hi' });
    expect(unbound.routed).toBe(false);
    expect(unbound.reason).toBe('no_agent_binding');
    t.db.close();
  });

  it('deletes keychain secret and unbinds agents on account deletion', async () => {
    const t = service();
    const acc = await t.channels.createAccount('default', {
      adapter: 'webhook', displayName: 'H', config: { endpointUrl: 'https://h.test' }, secrets: { authToken: 't' },
    });
    let unbound = '';
    t.bindings.unbindAccount = (_ws: string, id: string) => { unbound = id; };
    await t.channels.deleteAccount('default', acc.id);
    expect(await t.keychain.get(`channel:default:${acc.id}`)).toBeNull();
    expect(unbound).toBe(acc.id);
    expect(t.channels.listAccounts('default')).toHaveLength(0);
    t.db.close();
  });
});
