/**
 * Channel adapter contract.
 *
 * A channel is the ONLY subsystem besides the model transport allowed to make
 * outbound network calls, and even then only to the endpoint configured on the
 * account. Secrets are passed at call time and never persisted by the adapter.
 */

export type ChannelStatus =
  | 'unconfigured'
  | 'configured'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export type ConfigFieldType = 'string' | 'secret' | 'url' | 'boolean';

export interface ConfigField {
  key: string;
  label: string;
  type: ConfigFieldType;
  required?: boolean;
  placeholder?: string;
}

export interface ChannelCapability {
  outbound: boolean;
  inbound: boolean;
  auth: 'none' | 'token' | 'webhook' | 'oauth' | 'qr';
}

export type AdapterConfig = Record<string, unknown>;
export type AdapterSecrets = Record<string, string>;

export interface ValidationOutcome {
  ok: boolean;
  code?: string;
  message?: string;
}

export interface SendContext {
  sourceId?: string;
  inReplyTo?: string;
}

export interface SendResult {
  delivered: boolean;
  providerMessageId?: string;
  code?: string;
  message?: string;
}

export interface ChannelAdapter {
  type: string;
  label: string;
  supported: boolean;
  unsupportedReason?: string;
  capability: ChannelCapability;
  configFields: ConfigField[];
  secretFields: ConfigField[];
  validate(config: AdapterConfig, secrets: AdapterSecrets): Promise<ValidationOutcome>;
  connect(config: AdapterConfig, secrets: AdapterSecrets): Promise<void>;
  disconnect(): Promise<void>;
  send(config: AdapterConfig, secrets: AdapterSecrets, text: string, context?: SendContext): Promise<SendResult>;
}
