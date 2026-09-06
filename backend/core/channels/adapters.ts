/**
 * Built-in channel adapters.
 *
 * `webhook` is the real, testable token/webhook transport: validate/connect/
 * send all go only to the account-configured endpoint, with an injectable fetch
 * for isolated tests. The WeChat/WhatsApp QR adapters are deliberately not
 * implemented — they register as unsupported so the UI shows the truth instead
 * of a fake QR/OAuth flow.
 */
import { CoreError } from '../errors';
import type {
  AdapterConfig,
  AdapterSecrets,
  ChannelAdapter,
  SendContext,
  SendResult,
  ValidationOutcome,
} from './types';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class WebhookChannelAdapter implements ChannelAdapter {
  readonly type = 'webhook';
  readonly label = 'Webhook (token)';
  readonly supported = true;
  readonly capability = { outbound: true, inbound: true, auth: 'webhook' as const };
  readonly configFields = [
    { key: 'endpointUrl', label: 'Webhook URL', type: 'url' as const, required: true, placeholder: 'https://example.com/hook' },
  ];
  readonly secretFields = [
    { key: 'authToken', label: 'Bearer token', type: 'secret' as const, required: true },
  ];

  constructor(private readonly fetchImpl: FetchLike = globalThis.fetch) {}

  async validate(config: AdapterConfig, secrets: AdapterSecrets): Promise<ValidationOutcome> {
    const url = String(config.endpointUrl ?? '');
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, code: 'CHANNEL_INVALID_CONFIG', message: 'Webhook URL is invalid' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, code: 'CHANNEL_INVALID_CONFIG', message: 'Webhook URL must be http(s)' };
    }
    if (!secrets.authToken) return { ok: false, code: 'CHANNEL_SECRET_MISSING', message: 'Bearer token is required' };
    return { ok: true };
  }

  async connect(config: AdapterConfig, secrets: AdapterSecrets): Promise<void> {
    const result = await this.validate(config, secrets);
    if (!result.ok) {
      const code = result.code === 'CHANNEL_SECRET_MISSING' ? 'CHANNEL_SECRET_MISSING' : 'CHANNEL_INVALID_CONFIG';
      throw new CoreError(code, result.message ?? 'Invalid channel configuration');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      // A GET to the configured endpoint confirms reachability/auth.
      const response = await this.fetchImpl(String(config.endpointUrl), {
        method: 'GET',
        signal: controller.signal,
        headers: { authorization: `Bearer ${secrets.authToken}` },
      });
      if (response.status === 401 || response.status === 403) {
        throw new CoreError('CHANNEL_SECRET_MISSING', 'Webhook authentication failed');
      }
      // 404/405 is acceptable: many webhooks only accept POST. Anything else 5xx => unavailable.
      if (response.status >= 500) throw new CoreError('CHANNEL_SEND_FAILED', `Endpoint returned ${response.status}`);
    } catch (error) {
      if (error instanceof CoreError) throw error;
      throw new CoreError('CHANNEL_SEND_FAILED', 'Cannot reach the webhook endpoint');
    } finally {
      clearTimeout(timer);
    }
  }

  async disconnect(): Promise<void> {
    /* stateless transport */
  }

  async send(config: AdapterConfig, secrets: AdapterSecrets, text: string, context: SendContext = {}): Promise<SendResult> {
    const result = await this.validate(config, secrets);
    if (!result.ok) return { delivered: false, code: result.code, message: result.message };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetchImpl(String(config.endpointUrl), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secrets.authToken}` },
        body: JSON.stringify({ text, sourceId: context.sourceId, inReplyTo: context.inReplyTo, sentAt: new Date().toISOString() }),
      });
      if (response.status === 401 || response.status === 403) return { delivered: false, code: 'CHANNEL_SECRET_MISSING', message: 'Authentication failed' };
      if (response.status === 429) return { delivered: false, code: 'CHANNEL_SEND_FAILED', message: 'Rate limited' };
      if (!response.ok) return { delivered: false, code: 'CHANNEL_SEND_FAILED', message: `Endpoint returned ${response.status}` };
      let providerMessageId: string | undefined;
      try {
        const body = (await response.json()) as unknown as { id?: string; messageId?: string };
        providerMessageId = body.id ?? body.messageId;
      } catch {
        /* endpoint may return empty body */
      }
      return { delivered: true, providerMessageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'network error';
      return { delivered: false, code: /aborted|timeout/i.test(message) ? 'CHANNEL_SEND_FAILED' : 'CHANNEL_SEND_FAILED', message: 'Webhook delivery failed' };
    } finally {
      clearTimeout(timer);
    }
  }
}

function unsupported(type: string, label: string, reason: string): ChannelAdapter {
  const boom = (): never => {
    throw new CoreError('CHANNEL_UNSUPPORTED_CAPABILITY', reason);
  };
  return {
    type,
    label,
    supported: false,
    unsupportedReason: reason,
    capability: { outbound: false, inbound: false, auth: 'qr' },
    configFields: [],
    secretFields: [],
    validate: async () => ({ ok: false, code: 'CHANNEL_UNSUPPORTED_CAPABILITY', message: reason }),
    connect: boom,
    disconnect: boom,
    send: boom,
  };
}

export class ChannelRegistry {
  private readonly adapters = new Map<string, ChannelAdapter>();

  constructor(adapters: ChannelAdapter[] = []) {
    for (const adapter of adapters) this.adapters.set(adapter.type, adapter);
  }

  get(type: string): ChannelAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) throw new CoreError('CHANNEL_UNKNOWN_ADAPTER', `Unknown channel: ${type}`);
    return adapter;
  }

  has(type: string): boolean {
    return this.adapters.has(type);
  }

  list(): ChannelAdapter[] {
    return [...this.adapters.values()];
  }
}

export function defaultChannelRegistry(fetchImpl?: FetchLike): ChannelRegistry {
  return new ChannelRegistry([
    new WebhookChannelAdapter(fetchImpl),
    unsupported('wechat', 'WeChat (QR)', 'WeChat QR login is not supported in this build.'),
    unsupported('whatsapp', 'WhatsApp (QR)', 'WhatsApp QR login is not supported in this build.'),
  ]);
}
