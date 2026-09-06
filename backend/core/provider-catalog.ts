/**
 * Built-in, non-secret provider catalog.
 *
 * This is static product metadata (vendor display name, default endpoint,
 * wire protocol, default model, how to obtain a key). It never contains
 * credentials and performs no network access or runtime sync.
 */

export type ApiProtocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages';
export type AuthMode = 'api_key' | 'oauth_device' | 'oauth_browser' | 'local';

export interface VendorDefinition {
  id: string;
  label: string;
  category: 'official' | 'compatible' | 'local' | 'custom';
  defaultBaseUrl?: string;
  protocol: ApiProtocol;
  defaultModel?: string;
  authModes: AuthMode[];
  defaultAuthMode: AuthMode;
  requiresSecret: boolean;
  keyUrl?: string;
  /** OAuth-capable vendors are not yet implemented in ClawCore and are shown as unsupported. */
  oauthImplemented?: boolean;
  editableBaseUrl: boolean;
  editableModel: boolean;
}

export const VENDORS: VendorDefinition[] = [
  {
    id: 'anthropic', label: 'Anthropic', category: 'official',
    defaultBaseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic-messages',
    defaultModel: 'claude-opus-4-6', authModes: ['api_key'], defaultAuthMode: 'api_key',
    requiresSecret: true, keyUrl: 'https://console.anthropic.com/settings/keys',
    editableBaseUrl: true, editableModel: true,
  },
  {
    id: 'openai', label: 'OpenAI', category: 'official',
    defaultBaseUrl: 'https://api.openai.com/v1', protocol: 'openai-responses',
    defaultModel: 'gpt-5.5', authModes: ['api_key'], defaultAuthMode: 'api_key',
    requiresSecret: true, keyUrl: 'https://platform.openai.com/api-keys',
    oauthImplemented: false, editableBaseUrl: true, editableModel: true,
  },
  {
    id: 'google', label: 'Google Gemini', category: 'official',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', protocol: 'openai-completions',
    defaultModel: 'gemini-2.5-pro', authModes: ['api_key'], defaultAuthMode: 'api_key',
    requiresSecret: true, keyUrl: 'https://aistudio.google.com/app/apikey',
    oauthImplemented: false, editableBaseUrl: true, editableModel: true,
  },
  {
    id: 'openrouter', label: 'OpenRouter', category: 'compatible',
    defaultBaseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai-completions',
    defaultModel: 'anthropic/claude-opus-4.6', authModes: ['api_key'], defaultAuthMode: 'api_key',
    requiresSecret: true, keyUrl: 'https://openrouter.ai/keys',
    editableBaseUrl: false, editableModel: true,
  },
  {
    id: 'ark', label: 'ByteDance Ark (CN)', category: 'official',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', protocol: 'openai-completions',
    defaultModel: '', authModes: ['api_key'], defaultAuthMode: 'api_key',
    requiresSecret: true, keyUrl: 'https://console.volcengine.com/ark',
    editableBaseUrl: true, editableModel: true,
  },
  {
    id: 'moonshot', label: 'Moonshot Kimi (CN)', category: 'official',
    defaultBaseUrl: 'https://api.moonshot.cn/v1', protocol: 'openai-completions',
    defaultModel: 'kimi-k2.6', authModes: ['api_key'], defaultAuthMode: 'api_key',
    requiresSecret: true, keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    editableBaseUrl: true, editableModel: true,
  },
  {
    id: 'siliconflow', label: 'SiliconFlow (CN)', category: 'compatible',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1', protocol: 'openai-completions',
    defaultModel: 'deepseek-ai/DeepSeek-V3', authModes: ['api_key'], defaultAuthMode: 'api_key',
    requiresSecret: true, keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    editableBaseUrl: true, editableModel: true,
  },
  {
    id: 'qwen-portal', label: 'Alibaba Bailian (CN)', category: 'official',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'openai-completions',
    defaultModel: 'qwen-max', authModes: ['api_key'], defaultAuthMode: 'api_key',
    requiresSecret: true, keyUrl: 'https://bailian.console.aliyun.com/',
    editableBaseUrl: true, editableModel: true,
  },
  {
    id: 'minimax-portal', label: 'MiniMax', category: 'official',
    defaultBaseUrl: 'https://api.minimax.io/anthropic', protocol: 'anthropic-messages',
    defaultModel: 'MiniMax-M2.7', authModes: ['api_key'], defaultAuthMode: 'api_key',
    requiresSecret: true, keyUrl: 'https://intl.minimaxi.com/',
    oauthImplemented: false, editableBaseUrl: true, editableModel: true,
  },
  {
    id: 'opencode-go', label: 'OpenCode Go', category: 'compatible',
    defaultBaseUrl: 'https://opencode.ai/zen/go/v1', protocol: 'openai-completions',
    defaultModel: 'opencode-go/kimi-k2.5', authModes: ['api_key'], defaultAuthMode: 'api_key',
    requiresSecret: true, editableBaseUrl: true, editableModel: true,
  },
  {
    id: 'ollama', label: 'Ollama (local)', category: 'local',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1', protocol: 'openai-completions',
    defaultModel: 'llama3.1', authModes: ['local'], defaultAuthMode: 'local',
    requiresSecret: false, editableBaseUrl: true, editableModel: true,
  },
  {
    id: 'vllm', label: 'vLLM (local/self-host)', category: 'local',
    defaultBaseUrl: 'http://127.0.0.1:8000/v1', protocol: 'openai-completions',
    defaultModel: '', authModes: ['local', 'api_key'], defaultAuthMode: 'local',
    requiresSecret: false, editableBaseUrl: true, editableModel: true,
  },
  {
    id: 'sglang', label: 'SGLang (local/self-host)', category: 'local',
    defaultBaseUrl: 'http://127.0.0.1:30000/v1', protocol: 'openai-completions',
    defaultModel: '', authModes: ['local', 'api_key'], defaultAuthMode: 'local',
    requiresSecret: false, editableBaseUrl: true, editableModel: true,
  },
  {
    id: 'local-model', label: 'Custom local endpoint', category: 'local',
    defaultBaseUrl: 'http://127.0.0.1:8000/v1', protocol: 'openai-completions',
    defaultModel: '', authModes: ['local', 'api_key'], defaultAuthMode: 'local',
    requiresSecret: false, editableBaseUrl: true, editableModel: true,
  },
  {
    id: 'custom', label: 'OpenAI-compatible endpoint', category: 'custom',
    defaultBaseUrl: '', protocol: 'openai-completions',
    defaultModel: '', authModes: ['api_key', 'local'], defaultAuthMode: 'api_key',
    requiresSecret: true, editableBaseUrl: true, editableModel: true,
  },
];

export const VENDOR_BY_ID = new Map(VENDORS.map(v => [v.id, v]));

export function getVendor(id: string): VendorDefinition {
  const vendor = VENDOR_BY_ID.get(id);
  if (!vendor) return VENDOR_BY_ID.get('custom')!;
  return vendor;
}

export function isLocalVendor(id: string): boolean {
  return getVendor(id).category === 'local' || ['ollama', 'vllm', 'sglang', 'local-model'].includes(id);
}

/** OAuth modes are accepted in the data model but never executed until implemented. */
export function oauthSupported(vendorId: string, authMode: AuthMode): boolean {
  if (authMode === 'api_key' || authMode === 'local') return true;
  return getVendor(vendorId).oauthImplemented === true;
}
