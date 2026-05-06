/**
 * Gateway Type Definitions
 * Types for Gateway communication and data structures
 */

/**
 * Gateway connection status
 */
export interface GatewayStatus {
  state: 'stopped' | 'starting' | 'running' | 'error' | 'reconnecting';
  port: number;
  pid?: number;
  uptime?: number;
  error?: string;
  connectedAt?: number;
  version?: string;
  reconnectAttempts?: number;
  restartExpectedMs?: number;
}

export interface GatewayConfigRecovery {
  kind: 'config-repaired' | 'config-reset' | 'preflight';
  strategy?: 'normalize' | 'trim-root-object' | 'reset';
  backupPath?: string;
  topics?: Array<'config' | 'channels' | 'plugins' | 'auth'>;
}

export interface GatewayLifecycle {
  state: 'idle' | 'scheduled' | 'applying' | 'completed' | 'failed';
  action?: 'start' | 'restart' | 'reload';
  source?: string;
  reason?: string;
  delayMs?: number;
  at?: number;
  error?: string;
  recovery?: GatewayConfigRecovery;
}

/**
 * Gateway RPC response
 */
export interface GatewayRpcResponse<T = unknown> {
  success: boolean;
  result?: T;
  error?: string;
}

/**
 * Gateway health check response
 */
export interface GatewayHealth {
  ok: boolean;
  error?: string;
  uptime?: number;
  version?: string;
}

/**
 * Gateway notification (server-initiated event)
 */
export interface GatewayNotification {
  method: string;
  params?: unknown;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  id: string;
  name: string;
  type:
    | 'anthropic'
    | 'openai'
    | 'google'
    | 'openrouter'
    | 'opencode-go'
    | 'ark'
    | 'moonshot'
    | 'siliconflow'
    | 'minimax-portal'
    | 'minimax-portal-cn'
    | 'qwen-portal'
    | 'ollama'
    | 'vllm'
    | 'sglang'
    | 'custom';
  baseUrl?: string;
  apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  model?: string;
  fallbackModels?: string[];
  fallbackProviderIds?: string[];
  enabled: boolean;
}
