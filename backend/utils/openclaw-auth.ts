/**
 * OpenClaw Auth Profiles Utility
 * Writes API keys to configured OpenClaw agent auth-profiles.json files
 * so the OpenClaw Gateway can load them for AI provider calls.
 *
 * All file I/O is asynchronous (fs/promises) to avoid blocking the
 * desktop backend thread. On Windows + NTFS + Defender the synchronous
 * equivalents could stall for 500 ms – 2 s+ per call, causing "Not
 * Responding" hangs.
 */
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { resolveOpenClawDir } from './paths';
import { listConfiguredAgentIds } from './agent-config';
import { toFsPath } from './fs-path';
import { getProviderDefaultModel, getProviderConfig } from './provider-registry';
import {
  readOpenClawConfigRecord,
  readOpenClawConfigRecordRaw,
  sanitizeKnownInvalidOpenClawKeys,
  updateOpenClawConfigRecord,
  writeOpenClawConfigRecord,
} from './openclaw-config';
import {
  OPENCLAW_PROVIDER_KEY_MOONSHOT,
  isOAuthProviderType,
  isOpenClawOAuthPluginProviderKey,
} from './provider-keys';

const AUTH_STORE_VERSION = 1;
const AUTH_PROFILE_FILENAME = 'auth-profiles.json';
const FEISHU_PLUGIN_ID_CANDIDATES = ['feishu', 'openclaw-lark', 'feishu-openclaw-plugin'] as const;
const QQBOT_STALE_PLUGIN_ENTRY_IDS = ['qqbot', 'openclaw-qqbot'] as const;
const QQBOT_STALE_PLUGIN_ALLOW_IDS = ['openclaw-qqbot'] as const;
// Upstream PR #1052 removed @openclaw/codex; we never bundle it because it depends
// on plugin-sdk APIs that don't exist in openclaw@2026.5.12. Strip any leftover
// references from configs so OpenClaw doesn't try to load it via npm fallback.
const CODEX_STALE_PLUGIN_IDS = ['codex', 'openclaw-codex', '@openclaw/codex'] as const;

function getOAuthPluginId(provider: string): string {
  if (provider === 'minimax-portal' || provider === 'minimax-portal-cn') {
    return 'minimax';
  }
  if (provider === 'qwen-portal') {
    return 'qwen-portal-auth';
  }
  return `${provider}-auth`;
}

function ensurePluginEntryEnabled(
  config: Record<string, unknown>,
  pluginId: string,
  options?: { syncAllowlist?: boolean },
): void {
  const plugins = (config.plugins || {}) as Record<string, unknown>;
  const entries = (plugins.entries || {}) as Record<string, unknown>;
  entries[pluginId] = {
    ...(entries[pluginId] && typeof entries[pluginId] === 'object' ? entries[pluginId] as Record<string, unknown> : {}),
    enabled: true,
  };
  plugins.entries = entries;
  if (options?.syncAllowlist && Array.isArray(plugins.allow)) {
    const allow = [...(plugins.allow as string[])];
    if (!allow.includes(pluginId)) {
      plugins.allow = [...allow, pluginId];
    }
  }
  config.plugins = plugins;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ── Helpers ──────────────────────────────────────────────────────

/** Non-throwing async existence check (replaces existsSync). */
async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Ensure a directory exists (replaces mkdirSync). */
async function ensureDir(dir: string): Promise<void> {
  if (!(await fileExists(dir))) {
    await mkdir(dir, { recursive: true });
  }
}

async function resolveInstalledFeishuPluginId(): Promise<string | null> {
  const extensionRoot = join(resolveOpenClawDir(), 'extensions');
  for (const dirName of FEISHU_PLUGIN_ID_CANDIDATES) {
    const manifestPath = join(extensionRoot, dirName, 'openclaw.plugin.json');
    try {
      const raw = await readFile(manifestPath, 'utf-8');
      const parsed = JSON.parse(raw) as { id?: unknown };
      if (typeof parsed.id === 'string' && parsed.id.trim()) {
        return parsed.id.trim();
      }
    } catch {
      // ignore and try next candidate
    }
  }
  return null;
}

/** Read a JSON file, returning `null` on any error. */
async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    if (!(await fileExists(filePath))) return null;
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Write a JSON file, creating parent directories if needed. */
async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await ensureDir(join(filePath, '..'));
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Types ────────────────────────────────────────────────────────

interface AuthProfileEntry {
  type: 'api_key';
  provider: string;
  key: string;
}

interface OAuthProfileEntry {
  type: 'oauth';
  provider: string;
  access: string;
  refresh: string;
  expires: number;
  email?: string;
  projectId?: string;
}

interface AuthProfilesStore {
  version: number;
  profiles: Record<string, AuthProfileEntry | OAuthProfileEntry>;
  order?: Record<string, string[]>;
  lastGood?: Record<string, string>;
}

// ── Auth Profiles I/O ────────────────────────────────────────────

function getAuthProfilesPath(agentId = 'main'): string {
  return join(resolveOpenClawDir(), 'agents', agentId, 'agent', AUTH_PROFILE_FILENAME);
}

async function readAuthProfiles(agentId = 'main'): Promise<AuthProfilesStore> {
  const filePath = getAuthProfilesPath(agentId);
  try {
    const data = await readJsonFile<AuthProfilesStore>(filePath);
    if (data?.version && data.profiles && typeof data.profiles === 'object') {
      return data;
    }
  } catch (error) {
    console.warn('Failed to read auth-profiles.json, creating fresh store:', error);
  }
  return { version: AUTH_STORE_VERSION, profiles: {} };
}

async function writeAuthProfiles(store: AuthProfilesStore, agentId = 'main'): Promise<void> {
  await writeJsonFile(getAuthProfilesPath(agentId), store);
}

// ── Agent Discovery ──────────────────────────────────────────────

async function discoverAgentIds(): Promise<string[]> {
  const agentsDir = join(resolveOpenClawDir(), 'agents');
  try {
    if (!(await fileExists(agentsDir))) return ['main'];
    return await listConfiguredAgentIds();
  } catch {
    return ['main'];
  }
}

// ── OpenClaw Config Helpers ──────────────────────────────────────

const VALID_COMPACTION_MODES = new Set(['default', 'safeguard']);
const VALID_MEMORY_SEARCH_PROVIDERS = new Set(['openai', 'local', 'gemini', 'voyage', 'mistral']);
const VALID_MEMORY_SEARCH_FALLBACKS = new Set(['openai', 'gemini', 'local', 'voyage', 'mistral', 'none']);

export async function readOpenClawJson(): Promise<Record<string, unknown>> {
  return await readOpenClawConfigRecord();
}

function normalizeAgentsDefaultsCompactionMode(config: Record<string, unknown>): void {
  const agents =
    config.agents && typeof config.agents === 'object'
      ? (config.agents as Record<string, unknown>)
      : null;
  if (!agents) return;

  const defaults =
    agents.defaults && typeof agents.defaults === 'object'
      ? (agents.defaults as Record<string, unknown>)
      : null;
  if (!defaults) return;

  const compaction =
    defaults.compaction && typeof defaults.compaction === 'object'
      ? (defaults.compaction as Record<string, unknown>)
      : null;
  if (!compaction) return;

  const mode = compaction.mode;
  if (typeof mode === 'string' && mode.length > 0 && !VALID_COMPACTION_MODES.has(mode)) {
    compaction.mode = 'default';
  }
}

function sanitizeAgentsDefaultsMemorySearch(config: Record<string, unknown>): boolean {
  const agents =
    config.agents && typeof config.agents === 'object'
      ? (config.agents as Record<string, unknown>)
      : null;
  if (!agents) return false;

  const defaults =
    agents.defaults && typeof agents.defaults === 'object'
      ? (agents.defaults as Record<string, unknown>)
      : null;
  if (!defaults) return false;

  const memorySearch =
    defaults.memorySearch && typeof defaults.memorySearch === 'object'
      ? (defaults.memorySearch as Record<string, unknown>)
      : null;
  if (!memorySearch) return false;

  let modified = false;

  const provider = memorySearch.provider;
  if (
    typeof provider === 'string'
    && provider.length > 0
    && !VALID_MEMORY_SEARCH_PROVIDERS.has(provider)
  ) {
    console.log(
      `[sanitize] Removing invalid agents.defaults.memorySearch.provider="${provider}" from openclaw.json`
    );
    delete memorySearch.provider;
    modified = true;
  }

  const fallback = memorySearch.fallback;
  if (
    typeof fallback === 'string'
    && fallback.length > 0
    && !VALID_MEMORY_SEARCH_FALLBACKS.has(fallback)
  ) {
    console.log(
      `[sanitize] Removing invalid agents.defaults.memorySearch.fallback="${fallback}" from openclaw.json`
    );
    delete memorySearch.fallback;
    modified = true;
  }

  return modified;
}

export async function writeOpenClawJson(config: Record<string, unknown>): Promise<void> {
  // Read current content BEFORE sanitization so we can compare the true before/after.
  const currentConfig = await readOpenClawConfigRecordRaw().catch(() => null);

  sanitizeKnownInvalidOpenClawKeys(config);
  normalizeAgentsDefaultsCompactionMode(config);

  // Only set commands.restart = true if the config content actually changed.
  // Without this check, every call to writeOpenClawJson (e.g. from
  // setOpenClawDefaultModel, syncProviderConfigToOpenClaw, etc.) would
  // unconditionally trigger a gateway restart, even when the provider
  // config is already correct and nothing was modified.
  const nextContent = JSON.stringify(config, null, 2);
  const currentContent = currentConfig ? JSON.stringify(currentConfig, null, 2) : null;

  // Ensure SIGUSR1 graceful reload is authorized by OpenClaw config.
  const commands = (
    config.commands && typeof config.commands === 'object'
      ? { ...(config.commands as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;

  if (currentContent !== nextContent) {
    commands.restart = true;
  }
  config.commands = commands;

  await writeOpenClawConfigRecord(config);
}

// ── Exported Functions (all async) ───────────────────────────────

/**
 * Save an OAuth token to OpenClaw's auth-profiles.json.
 */
export async function saveOAuthTokenToOpenClaw(
  provider: string,
  token: { access: string; refresh: string; expires: number; email?: string; projectId?: string },
  agentId?: string
): Promise<void> {
  const agentIds = agentId ? [agentId] : await discoverAgentIds();
  if (agentIds.length === 0) agentIds.push('main');

  for (const id of agentIds) {
    const store = await readAuthProfiles(id);
    const profileId = `${provider}:default`;

    store.profiles[profileId] = {
      type: 'oauth',
      provider,
      access: token.access,
      refresh: token.refresh,
      expires: token.expires,
      email: token.email,
      projectId: token.projectId,
    };

    if (!store.order) store.order = {};
    if (!store.order[provider]) store.order[provider] = [];
    if (!store.order[provider].includes(profileId)) {
      store.order[provider].push(profileId);
    }

    if (!store.lastGood) store.lastGood = {};
    store.lastGood[provider] = profileId;

    await writeAuthProfiles(store, id);
  }
  console.log(
    `Saved OAuth token for provider "${provider}" to OpenClaw auth-profiles (agents: ${agentIds.join(', ')})`
  );
}

/**
 * Save a provider API key to OpenClaw's auth-profiles.json
 */
export async function saveProviderKeyToOpenClaw(
  provider: string,
  apiKey: string,
  agentId?: string
): Promise<void> {
  if (isOAuthProviderType(provider) && !apiKey) {
    console.log(
      `Skipping auth-profiles write for OAuth provider "${provider}" (no API key provided, using OAuth)`
    );
    return;
  }
  const agentIds = agentId ? [agentId] : await discoverAgentIds();
  if (agentIds.length === 0) agentIds.push('main');

  for (const id of agentIds) {
    const store = await readAuthProfiles(id);
    const profileId = `${provider}:default`;

    store.profiles[profileId] = { type: 'api_key', provider, key: apiKey };

    if (!store.order) store.order = {};
    if (!store.order[provider]) store.order[provider] = [];
    if (!store.order[provider].includes(profileId)) {
      store.order[provider].push(profileId);
    }

    if (!store.lastGood) store.lastGood = {};
    store.lastGood[provider] = profileId;

    await writeAuthProfiles(store, id);
  }
  console.log(
    `Saved API key for provider "${provider}" to OpenClaw auth-profiles (agents: ${agentIds.join(', ')})`
  );
}

/**
 * Remove a provider API key from OpenClaw auth-profiles.json
 */
export async function removeProviderKeyFromOpenClaw(
  provider: string,
  agentId?: string
): Promise<void> {
  if (isOAuthProviderType(provider)) {
    console.log(
      `Skipping auth-profiles removal for OAuth provider "${provider}" (managed by OpenClaw plugin)`
    );
    return;
  }
  const agentIds = agentId ? [agentId] : await discoverAgentIds();
  if (agentIds.length === 0) agentIds.push('main');

  for (const id of agentIds) {
    const store = await readAuthProfiles(id);
    const profileId = `${provider}:default`;

    delete store.profiles[profileId];

    if (store.order?.[provider]) {
      store.order[provider] = store.order[provider].filter((aid) => aid !== profileId);
      if (store.order[provider].length === 0) delete store.order[provider];
    }
    if (store.lastGood?.[provider] === profileId) delete store.lastGood[provider];

    await writeAuthProfiles(store, id);
  }
  console.log(
    `Removed API key for provider "${provider}" from OpenClaw auth-profiles (agents: ${agentIds.join(', ')})`
  );
}

/**
 * Remove a provider completely from OpenClaw (delete config, disable plugins, delete keys)
 */
export async function removeProviderFromOpenClaw(provider: string): Promise<void> {
  // 1. Remove from auth-profiles.json
  const agentIds = await discoverAgentIds();
  if (agentIds.length === 0) agentIds.push('main');
  for (const id of agentIds) {
    const store = await readAuthProfiles(id);
    const profileId = `${provider}:default`;
    if (store.profiles[profileId]) {
      delete store.profiles[profileId];
      if (store.order?.[provider]) {
        store.order[provider] = store.order[provider].filter((aid) => aid !== profileId);
        if (store.order[provider].length === 0) delete store.order[provider];
      }
      if (store.lastGood?.[provider] === profileId) delete store.lastGood[provider];
      await writeAuthProfiles(store, id);
    }
  }

  // 2. Remove from models.json (per-agent model registry used by pi-ai directly)
  for (const id of agentIds) {
    const modelsPath = join(resolveOpenClawDir(), 'agents', id, 'agent', 'models.json');
    try {
      if (await fileExists(modelsPath)) {
        const raw = await readFile(modelsPath, 'utf-8');
        const data = JSON.parse(raw) as Record<string, unknown>;
        const providers = data.providers as Record<string, unknown> | undefined;
        if (providers && providers[provider]) {
          delete providers[provider];
          await writeFile(modelsPath, JSON.stringify(data, null, 2), 'utf-8');
          console.log(`Removed models.json entry for provider "${provider}" (agent "${id}")`);
        }
      }
    } catch (err) {
      console.warn(`Failed to remove provider ${provider} from models.json (agent "${id}"):`, err);
    }
  }

  // 3. Remove from openclaw.json
  try {
    const config = await readOpenClawJson();
    let modified = false;

    // Disable the owning OAuth plugin if one is active for this provider.
    const plugins = config.plugins as Record<string, unknown> | undefined;
    const entries = (plugins?.entries ?? {}) as Record<string, Record<string, unknown>>;
    const pluginName = getOAuthPluginId(provider);
    if (entries[pluginName]) {
      entries[pluginName].enabled = false;
      modified = true;
      console.log(`Disabled OpenClaw plugin: ${pluginName}`);
    }

    // Remove from models.providers
    const models = config.models as Record<string, unknown> | undefined;
    const providers = (models?.providers ?? {}) as Record<string, unknown>;
    if (providers[provider]) {
      delete providers[provider];
      modified = true;
      console.log(`Removed OpenClaw provider config: ${provider}`);
    }

    if (modified) {
      await writeOpenClawJson(config);
    }
  } catch (err) {
    console.warn(`Failed to remove provider ${provider} from openclaw.json:`, err);
  }
}

/**
 * Update the OpenClaw config to use the given provider and model
 * Writes to ~/.openclaw/openclaw.json
 */
export async function setOpenClawDefaultModel(
  provider: string,
  modelOverride?: string,
  fallbackModels: string[] = []
): Promise<void> {
  const config = await readOpenClawJson();
  ensureMoonshotKimiWebSearchCnBaseUrl(config, provider);

  const model = normalizeModelRef(provider, modelOverride);
  if (!model) {
    console.warn(`No default model mapping for provider "${provider}"`);
    return;
  }

  const modelId = extractModelId(provider, model);
  const fallbackModelIds = extractFallbackModelIds(provider, fallbackModels);

  // Set the default model for the agents
  const agents = (config.agents || {}) as Record<string, unknown>;
  const defaults = (agents.defaults || {}) as Record<string, unknown>;
  defaults.model = {
    primary: model,
    fallbacks: fallbackModels,
  };
  agents.defaults = defaults;
  config.agents = agents;
  ensureAgentsDefaultModelsAllowlist(config, model, fallbackModels);

  // Configure models.providers for providers that need explicit registration.
  const providerCfg = getProviderConfig(provider);
  if (providerCfg) {
    upsertOpenClawProviderEntry(config, provider, {
      baseUrl: providerCfg.baseUrl,
      api: providerCfg.api,
      apiKeyEnv: providerCfg.apiKeyEnv,
      headers: providerCfg.headers,
      providerId: provider,
      modelIds: [modelId, ...fallbackModelIds],
      includeRegistryModels: true,
      mergeExistingModels: true,
    });
    console.log(
      `Configured models.providers.${provider} with baseUrl=${providerCfg.baseUrl}, model=${modelId}`
    );
  } else {
    // Built-in provider: remove any stale models.providers entry
    const models = (config.models || {}) as Record<string, unknown>;
    const providers = (models.providers || {}) as Record<string, unknown>;
    if (providers[provider]) {
      delete providers[provider];
      console.log(`Removed stale models.providers.${provider} (built-in provider)`);
      models.providers = providers;
      config.models = models;
    }
  }

  // Ensure gateway mode is set
  const gateway = (config.gateway || {}) as Record<string, unknown>;
  if (!gateway.mode) gateway.mode = 'local';
  config.gateway = gateway;

  await writeOpenClawJson(config);
  console.log(`Set OpenClaw default model to "${model}" for provider "${provider}"`);
}

interface RuntimeProviderConfigOverride {
  baseUrl?: string;
  api?: string;
  apiKeyEnv?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  disableTools?: boolean;
  allowPrivateNetwork?: boolean;
}

type ProviderEntryBuildOptions = {
  baseUrl: string;
  api: string;
  apiKeyEnv?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  disableTools?: boolean;
  allowPrivateNetwork?: boolean;
  providerId?: string;
  modelIds?: string[];
  includeRegistryModels?: boolean;
  mergeExistingModels?: boolean;
};

function normalizeModelRef(provider: string, modelOverride?: string): string | undefined {
  const rawModel = modelOverride || getProviderDefaultModel(provider);
  if (!rawModel) return undefined;
  return rawModel.startsWith(`${provider}/`) ? rawModel : `${provider}/${rawModel}`;
}

function extractModelId(provider: string, modelRef: string): string {
  return modelRef.startsWith(`${provider}/`) ? modelRef.slice(provider.length + 1) : modelRef;
}

function extractFallbackModelIds(provider: string, fallbackModels: string[]): string[] {
  return fallbackModels
    .filter((fallback) => fallback.startsWith(`${provider}/`))
    .map((fallback) => fallback.slice(provider.length + 1));
}

function buildRuntimeProviderModels(
  providerId: string,
  modelIds: string[],
  disableTools = false,
): Array<Record<string, unknown>> {
  return modelIds.map((id) => ({
    id,
    name: id,
    ...(providerId === 'vllm' && disableTools
      ? {
        compat: {
          supportsTools: false,
        },
      }
      : {}),
  }));
}

function mergeProviderModels(
  ...groups: Array<Array<Record<string, unknown>>>
): Array<Record<string, unknown>> {
  const merged: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const item of group) {
      const id = typeof item?.id === 'string' ? item.id : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(item);
    }
  }
  return merged;
}

/**
 * OpenClaw 2026.5+ requires a positive `maxTokens` on each model (and can
 * fall back to provider-level `maxTokens`) when `api` is `anthropic-messages`.
 * ClawClaw-written entries historically only included `{ id, name }`.
 *
 * Generic Anthropic-compatible providers should not be capped at 8k by
 * default: OpenClaw's native Anthropic transport caps default requests at 32k
 * (`min(model.maxTokens, 32000)`), while high-output providers such as MiniMax
 * M2.7 advertise a larger catalog limit.
 */
export const ANTHROPIC_MESSAGES_DEFAULT_MAX_TOKENS = 32768;
export const MINIMAX_M27_MAX_TOKENS = 131072;

function resolvePositiveMaxTokens(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const floored = Math.floor(value);
  return floored > 0 ? floored : undefined;
}

function isMiniMaxM27AnthropicEntry(
  providerKey: string | undefined,
  entry: Record<string, unknown> | undefined,
  model: Record<string, unknown> | undefined,
): boolean {
  const normalizedProvider = (providerKey || '').toLowerCase();
  if (normalizedProvider === 'minimax' || normalizedProvider.startsWith('minimax-portal')) {
    return true;
  }

  const baseUrl = typeof entry?.baseUrl === 'string' ? entry.baseUrl.toLowerCase() : '';
  if (baseUrl.includes('api.minimax.io') || baseUrl.includes('api.minimaxi.com')) {
    return true;
  }

  const modelId = typeof model?.id === 'string' ? model.id.toLowerCase() : '';
  return modelId === 'minimax-m2.7' || modelId === 'minimax-m2.7-highspeed';
}

function resolveAnthropicMessagesDefaultMaxTokens(
  providerKey?: string,
  entry?: Record<string, unknown>,
  model?: Record<string, unknown>,
): number {
  if (isMiniMaxM27AnthropicEntry(providerKey, entry, model)) {
    return MINIMAX_M27_MAX_TOKENS;
  }
  return ANTHROPIC_MESSAGES_DEFAULT_MAX_TOKENS;
}

function ensureAnthropicMessagesModelEntry(
  model: Record<string, unknown>,
  providerKey?: string,
  entry?: Record<string, unknown>,
): Record<string, unknown> {
  const resolved = resolvePositiveMaxTokens(model.maxTokens);
  if (resolved !== undefined) {
    if (model.maxTokens === resolved) {
      return model;
    }
    return { ...model, maxTokens: resolved };
  }
  return { ...model, maxTokens: resolveAnthropicMessagesDefaultMaxTokens(providerKey, entry, model) };
}

function resolveAnthropicMessagesProviderDefaultMaxTokens(
  providerKey: string | undefined,
  entry: Record<string, unknown>,
): number {
  if (Array.isArray(entry.models)) {
    const modelDefaults = entry.models
      .filter(isPlainRecord)
      .map((model) => resolveAnthropicMessagesDefaultMaxTokens(providerKey, entry, model));
    if (modelDefaults.length > 0) {
      return Math.max(...modelDefaults);
    }
  }
  return resolveAnthropicMessagesDefaultMaxTokens(providerKey, entry);
}

/**
 * Ensure `models.providers.*` entries using `anthropic-messages` include the
 * token limits OpenClaw's transport layer requires. Returns whether `entry`
 * was modified.
 */
function ensureAnthropicMessagesProviderDefaults(
  entry: Record<string, unknown>,
  providerKey?: string,
): boolean {
  if (entry.api !== 'anthropic-messages') {
    return false;
  }

  let modified = false;

  if (resolvePositiveMaxTokens(entry.maxTokens) === undefined) {
    entry.maxTokens = resolveAnthropicMessagesProviderDefaultMaxTokens(providerKey, entry);
    modified = true;
  }

  if (Array.isArray(entry.models)) {
    const nextModels = (entry.models as Array<Record<string, unknown>>).map((model) => {
      if (!isPlainRecord(model)) {
        return model;
      }
      const next = ensureAnthropicMessagesModelEntry(model, providerKey, entry);
      if (next !== model) {
        modified = true;
      }
      return next;
    });
    entry.models = nextModels;
  }

  return modified;
}

function healAnthropicMessagesMaxTokensInConfig(config: Record<string, unknown>): boolean {
  const models = (config.models || {}) as Record<string, unknown>;
  const providers = (models.providers || {}) as Record<string, unknown>;
  let modified = false;

  for (const [providerKey, entry] of Object.entries(providers)) {
    if (!isPlainRecord(entry)) {
      continue;
    }
    if (ensureAnthropicMessagesProviderDefaults(entry, providerKey)) {
      providers[providerKey] = entry;
      modified = true;
      console.log(
        `[openclaw-auth] Ensured anthropic-messages maxTokens defaults for models.providers.${providerKey}`,
      );
    }
  }

  if (modified) {
    models.providers = providers;
    config.models = models;
  }

  return modified;
}

/**
 * Self-heal helper: walk `models.providers.*` and ensure every
 * `anthropic-messages` entry (and its model rows) has a positive `maxTokens`.
 * Returns the list of providerKeys that were updated.
 */
export async function ensureAnthropicMessagesModelMaxTokens(): Promise<string[]> {
  const config = await readOpenClawJson();
  const models = (config.models || {}) as Record<string, unknown>;
  const providers = (models.providers || {}) as Record<string, unknown>;
  const healed: string[] = [];
  let modified = false;

  for (const [providerKey, entry] of Object.entries(providers)) {
    if (!isPlainRecord(entry)) {
      continue;
    }
    if (ensureAnthropicMessagesProviderDefaults(entry, providerKey)) {
      providers[providerKey] = entry;
      healed.push(providerKey);
      modified = true;
    }
  }

  if (modified) {
    models.providers = providers;
    config.models = models;
    await writeOpenClawJson(config);
  }
  return healed;
}

function upsertOpenClawProviderEntry(
  config: Record<string, unknown>,
  provider: string,
  options: ProviderEntryBuildOptions
): void {
  const models = (config.models || {}) as Record<string, unknown>;
  const providers = (models.providers || {}) as Record<string, unknown>;
  const existingProvider =
    providers[provider] && typeof providers[provider] === 'object'
      ? (providers[provider] as Record<string, unknown>)
      : {};

  const existingModels =
    options.mergeExistingModels && Array.isArray(existingProvider.models)
      ? (existingProvider.models as Array<Record<string, unknown>>)
      : [];
  const registryModels = options.includeRegistryModels
    ? ((getProviderConfig(provider)?.models ?? []).map((m) => ({ ...m })) as Array<
        Record<string, unknown>
      >)
    : [];
  const runtimeModels = buildRuntimeProviderModels(
    options.providerId || provider,
    options.modelIds ?? [],
    options.disableTools,
  );
  let mergedModels = mergeProviderModels(registryModels, existingModels, runtimeModels);
  if (options.api === 'anthropic-messages') {
    mergedModels = mergedModels.map((model) =>
      ensureAnthropicMessagesModelEntry(model, provider, existingProvider),
    );
  }

  const nextProvider: Record<string, unknown> = {
    ...existingProvider,
    baseUrl: options.baseUrl,
    api: options.api,
    models: mergedModels,
  };
  if (options.api === 'anthropic-messages') {
    ensureAnthropicMessagesProviderDefaults(nextProvider, provider);
  }
  if (options.apiKeyEnv) nextProvider.apiKey = options.apiKeyEnv;
  if (options.headers && Object.keys(options.headers).length > 0) {
    nextProvider.headers = options.headers;
  } else {
    delete nextProvider.headers;
  }
  if (options.authHeader !== undefined) {
    nextProvider.authHeader = options.authHeader;
  } else {
    delete nextProvider.authHeader;
  }
  if (options.allowPrivateNetwork !== undefined) {
    const request = (
      existingProvider.request && typeof existingProvider.request === 'object'
        ? { ...(existingProvider.request as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    request.allowPrivateNetwork = options.allowPrivateNetwork;
    nextProvider.request = request;
  } else if (existingProvider.request && typeof existingProvider.request === 'object') {
    const request = { ...(existingProvider.request as Record<string, unknown>) };
    delete request.allowPrivateNetwork;
    if (Object.keys(request).length > 0) {
      nextProvider.request = request;
    } else {
      delete nextProvider.request;
    }
  } else {
    delete nextProvider.request;
  }

  providers[provider] = nextProvider;
  models.providers = providers;
  config.models = models;
}

function ensureMoonshotKimiWebSearchCnBaseUrl(
  config: Record<string, unknown>,
  provider: string
): void {
  if (provider !== OPENCLAW_PROVIDER_KEY_MOONSHOT) return;

  const tools = isPlainRecord(config.tools) ? config.tools : null;
  const web = tools && isPlainRecord(tools.web) ? tools.web : null;
  const search = web && isPlainRecord(web.search) ? web.search : null;
  const legacyKimi = search && isPlainRecord(search.kimi) ? { ...search.kimi } : undefined;

  const plugins = isPlainRecord(config.plugins)
    ? config.plugins
    : (Array.isArray(config.plugins) ? { load: [...config.plugins] } : {});
  const entries = isPlainRecord(plugins.entries) ? plugins.entries : {};
  const moonshot = isPlainRecord(entries[OPENCLAW_PROVIDER_KEY_MOONSHOT])
    ? { ...(entries[OPENCLAW_PROVIDER_KEY_MOONSHOT] as Record<string, unknown>) }
    : {};
  const moonshotConfig = isPlainRecord(moonshot.config)
    ? { ...(moonshot.config as Record<string, unknown>) }
    : {};
  const currentWebSearch = isPlainRecord(moonshotConfig.webSearch)
    ? { ...(moonshotConfig.webSearch as Record<string, unknown>) }
    : {};
  const nextWebSearch = { ...(legacyKimi || {}), ...currentWebSearch };

  // Prefer env/auth-profiles for key resolution; stale inline kimi.apiKey can cause persistent 401.
  delete nextWebSearch.apiKey;
  nextWebSearch.baseUrl = 'https://api.moonshot.cn/v1';

  moonshotConfig.webSearch = nextWebSearch;
  moonshot.config = moonshotConfig;
  entries[OPENCLAW_PROVIDER_KEY_MOONSHOT] = moonshot;
  plugins.entries = entries;
  config.plugins = plugins;

  if (search && 'kimi' in search) {
    delete search.kimi;
    if (Object.keys(search).length === 0 && web) {
      delete web.search;
    }
    if (web && Object.keys(web).length === 0 && tools) {
      delete tools.web;
    }
    if (tools && Object.keys(tools).length === 0) {
      delete config.tools;
    }
  }
}

function ensureAgentsDefaultModelsAllowlist(
  config: Record<string, unknown>,
  primaryModelRef: string,
  fallbackModelRefs: string[],
): void {
  const agents = (config.agents || {}) as Record<string, unknown>;
  const defaults = (agents.defaults || {}) as Record<string, unknown>;
  const existingAllowlist =
    defaults.models && typeof defaults.models === 'object' && !Array.isArray(defaults.models)
      ? { ...(defaults.models as Record<string, unknown>) }
      : {};

  existingAllowlist[primaryModelRef] = existingAllowlist[primaryModelRef] ?? {};
  for (const fallback of fallbackModelRefs) {
    const ref = fallback?.trim();
    if (!ref) continue;
    existingAllowlist[ref] = existingAllowlist[ref] ?? {};
  }

  defaults.models = existingAllowlist;
  agents.defaults = defaults;
  config.agents = agents;
}

/**
 * Register or update a provider's configuration in openclaw.json
 * without changing the current default model.
 */
export async function syncProviderConfigToOpenClaw(
  provider: string,
  modelId: string | undefined,
  override: RuntimeProviderConfigOverride
): Promise<void> {
  const config = await readOpenClawJson();
  ensureMoonshotKimiWebSearchCnBaseUrl(config, provider);

  if (override.baseUrl && override.api) {
    upsertOpenClawProviderEntry(config, provider, {
      baseUrl: override.baseUrl,
      api: override.api,
      apiKeyEnv: override.apiKeyEnv,
      headers: override.headers,
      allowPrivateNetwork: override.allowPrivateNetwork,
      disableTools: override.disableTools,
      providerId: provider,
      modelIds: modelId ? [modelId] : [],
    });
  }

  // Ensure extension is enabled for oauth providers to prevent gateway wiping config
  if (isOpenClawOAuthPluginProviderKey(provider)) {
    const pluginId = getOAuthPluginId(provider);
    ensurePluginEntryEnabled(config, pluginId, { syncAllowlist: true });
  }

  await writeOpenClawJson(config);
}

/**
 * Update OpenClaw model + provider config using runtime config values.
 */
export async function setOpenClawDefaultModelWithOverride(
  provider: string,
  modelOverride: string | undefined,
  override: RuntimeProviderConfigOverride,
  fallbackModels: string[] = []
): Promise<void> {
  const config = await readOpenClawJson();
  ensureMoonshotKimiWebSearchCnBaseUrl(config, provider);

  const model = normalizeModelRef(provider, modelOverride);
  if (!model) {
    console.warn(`No default model mapping for provider "${provider}"`);
    return;
  }

  const modelId = extractModelId(provider, model);
  const fallbackModelIds = extractFallbackModelIds(provider, fallbackModels);

  const agents = (config.agents || {}) as Record<string, unknown>;
  const defaults = (agents.defaults || {}) as Record<string, unknown>;
  defaults.model = {
    primary: model,
    fallbacks: fallbackModels,
  };
  agents.defaults = defaults;
  config.agents = agents;
  ensureAgentsDefaultModelsAllowlist(config, model, fallbackModels);

  if (override.baseUrl && override.api) {
    upsertOpenClawProviderEntry(config, provider, {
      baseUrl: override.baseUrl,
      api: override.api,
      apiKeyEnv: override.apiKeyEnv,
      headers: override.headers,
      authHeader: override.authHeader,
      allowPrivateNetwork: override.allowPrivateNetwork,
      disableTools: override.disableTools,
      providerId: provider,
      modelIds: [modelId, ...fallbackModelIds],
    });
  }

  const gateway = (config.gateway || {}) as Record<string, unknown>;
  if (!gateway.mode) gateway.mode = 'local';
  config.gateway = gateway;

  // Ensure the extension plugin is marked as enabled in openclaw.json
  if (isOpenClawOAuthPluginProviderKey(provider)) {
    const pluginId = getOAuthPluginId(provider);
    ensurePluginEntryEnabled(config, pluginId, { syncAllowlist: true });
  }

  await writeOpenClawJson(config);
  console.log(
    `Set OpenClaw default model to "${model}" for provider "${provider}" (runtime override)`
  );
}

/**
 * Get a set of all active provider IDs configured in openclaw.json.
 * Reads the file ONCE and extracts both models.providers and plugins.entries.
 */
export async function getActiveOpenClawProviders(): Promise<Set<string>> {
  const activeProviders = new Set<string>();

  try {
    const config = await readOpenClawJson();

    // 1. models.providers
    const providers = (config.models as Record<string, unknown> | undefined)?.providers;
    if (providers && typeof providers === 'object') {
      for (const key of Object.keys(providers as Record<string, unknown>)) {
        activeProviders.add(key);
      }
    }

    // 2. plugins.entries for OAuth providers
    const plugins = (config.plugins as Record<string, unknown> | undefined)?.entries;
    if (plugins && typeof plugins === 'object') {
      for (const [pluginId, meta] of Object.entries(plugins as Record<string, unknown>)) {
        if (pluginId.endsWith('-auth') && (meta as Record<string, unknown>).enabled) {
          activeProviders.add(pluginId.replace(/-auth$/, ''));
        }
      }
    }
  } catch (err) {
    console.warn('Failed to read openclaw.json for active providers:', err);
  }

  return activeProviders;
}

/**
 * Batch-sync gateway token, browser config, and session idle to openclaw.json
 * in a single serialized config write (reduces file I/O on Windows + Defender).
 *
 * Also sets browser.ssrfPolicy.dangerouslyAllowPrivateNetwork for enterprise
 * internal network access.
 */
export async function batchSyncConfigFields(token: string): Promise<void> {
  const DEFAULT_IDLE_MINUTES = 10_080; // 7 days

  let modified = false;
  await updateOpenClawConfigRecord((config) => {

    // ── Gateway token + controlUi ──
    const gateway = (
      config.gateway && typeof config.gateway === 'object'
        ? { ...(config.gateway as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;

    const auth = (
      gateway.auth && typeof gateway.auth === 'object'
        ? { ...(gateway.auth as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;

    // Only write if the token actually changed — avoids overwriting gateway.tailscale
    // (and other externally-added gateway fields) and suppresses spurious restarts.
    if (auth.token === token && auth.mode === 'token') {
      // still need to ensure browser + session are correct, so don't early-return
    } else {
      auth.mode = 'token';
      auth.token = token;
      gateway.auth = auth;
      modified = true;
    }

    // Packaged ClawClaw loads the renderer from file://, so the gateway must allow
    // that origin for the chat WebSocket handshake.
    const controlUi = (
      gateway.controlUi && typeof gateway.controlUi === 'object'
        ? { ...(gateway.controlUi as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    const allowedOrigins = Array.isArray(controlUi.allowedOrigins)
      ? (controlUi.allowedOrigins as unknown[]).filter(
          (value): value is string => typeof value === 'string'
        )
      : [];
    if (!allowedOrigins.includes('file://')) {
      controlUi.allowedOrigins = [...allowedOrigins, 'file://'];
      gateway.controlUi = controlUi;
      modified = true;
    }

    if (!gateway.mode) {
      gateway.mode = 'local';
      modified = true;
    }
    if (gateway.bind !== 'loopback') {
      gateway.bind = 'loopback';
      modified = true;
    }
    config.gateway = gateway;

    // ClawClaw owns a local desktop Gateway and connects through 127.0.0.1.
    // Disable mDNS advertising to avoid LAN exposure warnings and noisy Bonjour
    // re-advertise watchdog logs during desktop startup.
    const discovery = (
      config.discovery && typeof config.discovery === 'object'
        ? { ...(config.discovery as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    const mdns = (
      discovery.mdns && typeof discovery.mdns === 'object'
        ? { ...(discovery.mdns as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    if (mdns.mode !== 'off') {
      mdns.mode = 'off';
      discovery.mdns = mdns;
      config.discovery = discovery;
      modified = true;
    }

    // ── Browser config ──
    const browser = (
      config.browser && typeof config.browser === 'object'
        ? { ...(config.browser as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    let browserModified = false;

    if (browser.enabled === undefined) {
      browser.enabled = true;
      browserModified = true;
    }
    if (browser.defaultProfile === undefined) {
      browser.defaultProfile = 'openclaw';
      browserModified = true;
    }
    // Default ssrfPolicy to allow private network access for enterprise/internal use.
    if (browser.ssrfPolicy == null) {
      browser.ssrfPolicy = { dangerouslyAllowPrivateNetwork: true };
      browserModified = true;
    } else if (
      typeof browser.ssrfPolicy === 'object' &&
      (browser.ssrfPolicy as Record<string, unknown>).dangerouslyAllowPrivateNetwork === undefined
    ) {
      (browser.ssrfPolicy as Record<string, unknown>).dangerouslyAllowPrivateNetwork = true;
      browserModified = true;
    }
    if (browserModified) {
      config.browser = browser;
      modified = true;
    }

    // ── Session idle minutes ──
    const session = (
      config.session && typeof config.session === 'object'
        ? { ...(config.session as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    const hasExplicitSessionConfig =
      session.idleMinutes !== undefined
      || session.reset !== undefined
      || session.resetByType !== undefined
      || session.resetByChannel !== undefined;
    if (!hasExplicitSessionConfig) {
      session.idleMinutes = DEFAULT_IDLE_MINUTES;
      config.session = session;
      modified = true;
    }

    if (modified) {
      console.log('Synced gateway token, browser config, and session idle to openclaw.json');
    }
  });
}

export async function syncMemorySettingsToOpenClaw(params: {
  sessionMemoryEnabled: boolean;
  memorySearchEnabled: boolean;
  dreamingEnabled: boolean;
}): Promise<void> {
  let modified = false;
  await updateOpenClawConfigRecord((config) => {
    const hooks = (
      config.hooks && typeof config.hooks === 'object'
        ? { ...(config.hooks as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;

    const internal = (
      hooks.internal && typeof hooks.internal === 'object'
        ? { ...(hooks.internal as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;

    const entries = (
      internal.entries && typeof internal.entries === 'object'
        ? { ...(internal.entries as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;

    const sessionMemoryEntry = (
      entries['session-memory'] && typeof entries['session-memory'] === 'object'
        ? { ...(entries['session-memory'] as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    if (sessionMemoryEntry.enabled !== params.sessionMemoryEnabled) {
      modified = true;
    }
    sessionMemoryEntry.enabled = params.sessionMemoryEnabled;
    entries['session-memory'] = sessionMemoryEntry;
    internal.entries = entries;
    if (params.sessionMemoryEnabled) {
      if (internal.enabled !== true) {
        modified = true;
      }
      internal.enabled = true;
    }
    hooks.internal = internal;
    config.hooks = hooks;

    const agents = (
      config.agents && typeof config.agents === 'object'
        ? { ...(config.agents as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;

    const defaults = (
      agents.defaults && typeof agents.defaults === 'object'
        ? { ...(agents.defaults as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;

    const memorySearch = (
      defaults.memorySearch && typeof defaults.memorySearch === 'object'
        ? { ...(defaults.memorySearch as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    if (memorySearch.enabled !== params.memorySearchEnabled) {
      modified = true;
    }
    memorySearch.enabled = params.memorySearchEnabled;
    defaults.memorySearch = memorySearch;
    agents.defaults = defaults;
    config.agents = agents;

    const plugins = (
      config.plugins && typeof config.plugins === 'object'
        ? { ...(config.plugins as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    const pluginEntries = (
      plugins.entries && typeof plugins.entries === 'object'
        ? { ...(plugins.entries as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    const memoryCoreEntry = (
      pluginEntries['memory-core'] && typeof pluginEntries['memory-core'] === 'object'
        ? { ...(pluginEntries['memory-core'] as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    const memoryCoreConfig = (
      memoryCoreEntry.config && typeof memoryCoreEntry.config === 'object'
        ? { ...(memoryCoreEntry.config as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    const dreaming = (
      memoryCoreConfig.dreaming && typeof memoryCoreConfig.dreaming === 'object'
        ? { ...(memoryCoreConfig.dreaming as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    if (dreaming.enabled !== params.dreamingEnabled) {
      modified = true;
    }
    dreaming.enabled = params.dreamingEnabled;
    memoryCoreConfig.dreaming = dreaming;
    memoryCoreEntry.config = memoryCoreConfig;
    pluginEntries['memory-core'] = memoryCoreEntry;
    plugins.entries = pluginEntries;
    config.plugins = plugins;
  });

  if (modified) {
    console.log('Synced memory settings to openclaw.json');
  }
}

export async function syncModelRuntimeSettingsToOpenClaw(params: {
  localModelLean: boolean;
}): Promise<void> {
  let modified = false;
  await updateOpenClawConfigRecord((config) => {
    const agents = (
      config.agents && typeof config.agents === 'object'
        ? { ...(config.agents as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;

    const defaults = (
      agents.defaults && typeof agents.defaults === 'object'
        ? { ...(agents.defaults as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;

    const experimental = (
      defaults.experimental && typeof defaults.experimental === 'object'
        ? { ...(defaults.experimental as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;

    if (experimental.localModelLean !== params.localModelLean) {
      modified = true;
    }
    experimental.localModelLean = params.localModelLean;
    defaults.experimental = experimental;
    agents.defaults = defaults;
    config.agents = agents;
  });

  if (modified) {
    console.log('Synced model runtime settings to openclaw.json');
  }
}

/**
 * Update a provider entry in every discovered agent's models.json.
 */
export async function updateAgentModelProvider(
  providerType: string,
  entry: {
    baseUrl?: string;
    api?: string;
    models?: Array<Record<string, unknown> & { id: string; name: string }>;
    apiKey?: string;
    /** When true, pi-ai sends Authorization: Bearer instead of x-api-key */
    authHeader?: boolean;
  }
): Promise<void> {
  const agentIds = await discoverAgentIds();
  for (const agentId of agentIds) {
    const modelsPath = join(resolveOpenClawDir(), 'agents', agentId, 'agent', 'models.json');
    let data: Record<string, unknown> = {};
    try {
      data = (await readJsonFile<Record<string, unknown>>(modelsPath)) ?? {};
    } catch {
      // corrupt / missing – start with an empty object
    }

    const providers = (
      data.providers && typeof data.providers === 'object' ? data.providers : {}
    ) as Record<string, Record<string, unknown>>;

    const existing: Record<string, unknown> =
      providers[providerType] && typeof providers[providerType] === 'object'
        ? { ...providers[providerType] }
        : {};

    const existingModels = Array.isArray(existing.models)
      ? (existing.models as Array<Record<string, unknown>>)
      : [];

    const mergedModels = (entry.models ?? []).map((m) => {
      const prev = existingModels.find((e) => e.id === m.id);
      return prev ? { ...prev, id: m.id, name: m.name } : { ...m };
    });

    if (entry.baseUrl !== undefined) existing.baseUrl = entry.baseUrl;
    if (entry.api !== undefined) existing.api = entry.api;
    if (mergedModels.length > 0) existing.models = mergedModels;
    if (entry.apiKey !== undefined) existing.apiKey = entry.apiKey;
    if (entry.authHeader !== undefined) existing.authHeader = entry.authHeader;

    providers[providerType] = existing;
    data.providers = providers;

    try {
      await writeJsonFile(modelsPath, data);
      console.log(`Updated models.json for agent "${agentId}" provider "${providerType}"`);
    } catch (err) {
      console.warn(`Failed to update models.json for agent "${agentId}":`, err);
    }
  }
}

/**
 * Sanitize ~/.openclaw/openclaw.json before Gateway start.
 *
 * Removes known-invalid keys that cause OpenClaw's strict Zod validation
 * to reject the entire config on startup.  Uses a conservative **blocklist**
 * approach: only strips keys that are KNOWN to be misplaced by older
 * OpenClaw/ClawClaw versions or external tools.
 *
 * Why blocklist instead of allowlist?
 *   • Allowlist (e.g. `VALID_SKILLS_KEYS`) would strip any NEW valid keys
 *     added by future OpenClaw releases — a forward-compatibility hazard.
 *   • Blocklist only removes keys we positively know are wrong, so new
 *     valid keys are never touched.
 *
 * This is a fast, file-based pre-check.  For comprehensive repair of
 * unknown or future config issues, the reactive auto-repair mechanism
 * (`runOpenClawDoctorRepair`) runs `openclaw doctor --fix` as a fallback.
 */
export async function sanitizeOpenClawConfig(): Promise<void> {
  const config = await readOpenClawJson();
  let modified = sanitizeKnownInvalidOpenClawKeys(config);

  if (modified) {
    console.log('[sanitize] Removed known-invalid strict-schema keys from openclaw.json');
  }

  // ── plugins section ──────────────────────────────────────────────
  // Remove absolute paths in plugins that no longer exist or are bundled (preventing hardlink validation errors)
  const plugins = config.plugins;
  if (plugins) {
    if (Array.isArray(plugins)) {
      const validPlugins: unknown[] = [];
      for (const p of plugins) {
        if (typeof p === 'string' && isAbsolutePluginPath(p)) {
          if (isBundledPluginPath(p) || !(await fileExists(toFsPath(p)))) {
            console.log(`[sanitize] Removing stale/bundled plugin path "${p}" from openclaw.json`);
            modified = true;
          } else {
            validPlugins.push(p);
          }
        } else {
          validPlugins.push(p);
        }
      }
      if (modified) config.plugins = validPlugins;
    } else if (typeof plugins === 'object') {
      const pluginsObj = plugins as Record<string, unknown>;
      if (Array.isArray(pluginsObj.load)) {
        const validLoad: unknown[] = [];
        for (const p of pluginsObj.load) {
          if (typeof p === 'string' && isAbsolutePluginPath(p)) {
            if (isBundledPluginPath(p) || !(await fileExists(toFsPath(p)))) {
              console.log(
                `[sanitize] Removing stale/bundled plugin path "${p}" from openclaw.json`
              );
              modified = true;
            } else {
              validLoad.push(p);
            }
          } else {
            validLoad.push(p);
          }
        }
        if (modified) pluginsObj.load = validLoad;
      } else if (
        pluginsObj.load
        && typeof pluginsObj.load === 'object'
        && !Array.isArray(pluginsObj.load)
      ) {
        const loadObj = pluginsObj.load as Record<string, unknown>;
        if (Array.isArray(loadObj.paths)) {
          const validPaths: unknown[] = [];
          let loadModified = false;
          for (const p of loadObj.paths) {
            if (typeof p === 'string' && isAbsolutePluginPath(p)) {
              if (isBundledPluginPath(p) || !(await fileExists(toFsPath(p)))) {
                console.log(
                  `[sanitize] Removing stale/bundled plugin path "${p}" from openclaw.json`
                );
                modified = true;
                loadModified = true;
              } else {
                validPaths.push(p);
              }
            } else {
              validPaths.push(p);
            }
          }
          if (loadModified) {
            loadObj.paths = validPaths;
            pluginsObj.load = loadObj;
          }
        }
      }
    }
  }

  if (plugins && typeof plugins === 'object' && !Array.isArray(plugins)) {
    const pluginsObj = plugins as Record<string, unknown>;
    const pEntries = (
      pluginsObj.entries && typeof pluginsObj.entries === 'object' && !Array.isArray(pluginsObj.entries)
        ? pluginsObj.entries
        : {}
    ) as Record<string, Record<string, unknown>>;
    if (!pluginsObj.entries || typeof pluginsObj.entries !== 'object' || Array.isArray(pluginsObj.entries)) {
      pluginsObj.entries = pEntries;
    }

    const allowArr = Array.isArray(pluginsObj.allow) ? (pluginsObj.allow as string[]) : [];
    if (!Array.isArray(pluginsObj.allow)) {
      pluginsObj.allow = allowArr;
    }

    const normalizedAllowWithoutLegacyQqbot = allowArr.filter(
      (id) => !QQBOT_STALE_PLUGIN_ALLOW_IDS.includes(id as typeof QQBOT_STALE_PLUGIN_ALLOW_IDS[number]),
    );
    if (normalizedAllowWithoutLegacyQqbot.length !== allowArr.length) {
      pluginsObj.allow = normalizedAllowWithoutLegacyQqbot;
      modified = true;
      console.log('[sanitize] Removed legacy qqbot plugin allowlist entries (qqbot is now built-in)');
    }

    for (const pluginId of QQBOT_STALE_PLUGIN_ENTRY_IDS) {
      if (pEntries[pluginId]) {
        delete pEntries[pluginId];
        modified = true;
        console.log(`[sanitize] Removed legacy plugins.entries.${pluginId} (qqbot is now built-in)`);
      }
    }

    const currentAllow = Array.isArray(pluginsObj.allow) ? (pluginsObj.allow as string[]) : allowArr;
    const normalizedAllowWithoutCodex = currentAllow.filter(
      (id) => !CODEX_STALE_PLUGIN_IDS.includes(id as typeof CODEX_STALE_PLUGIN_IDS[number]),
    );
    if (normalizedAllowWithoutCodex.length !== currentAllow.length) {
      pluginsObj.allow = normalizedAllowWithoutCodex;
      modified = true;
      console.log('[sanitize] Removed codex plugin allowlist entries (incompatible with openclaw@2026.5.12)');
    }

    for (const pluginId of CODEX_STALE_PLUGIN_IDS) {
      if (pEntries[pluginId]) {
        delete pEntries[pluginId];
        modified = true;
        console.log(`[sanitize] Removed plugins.entries.${pluginId} (incompatible with openclaw@2026.5.12)`);
      }
    }

    const installedFeishuId = await resolveInstalledFeishuPluginId();
    const configuredFeishuId =
      FEISHU_PLUGIN_ID_CANDIDATES.find((id) => allowArr.includes(id))
      || FEISHU_PLUGIN_ID_CANDIDATES.find((id) => Boolean(pEntries[id]));
    const canonicalFeishuId = installedFeishuId || configuredFeishuId || FEISHU_PLUGIN_ID_CANDIDATES[0];
    const existingFeishuEntry = FEISHU_PLUGIN_ID_CANDIDATES.map((id) => pEntries[id]).find(Boolean);
    const hasFeishuChannelConfig = Boolean(
      config.channels
      && typeof config.channels === 'object'
      && (config.channels as Record<string, unknown>).feishu,
    );

    if (hasFeishuChannelConfig) {
      if (Array.isArray(pluginsObj.allow)) {
        const normalizedAllow = allowArr.filter(
          (id) => !FEISHU_PLUGIN_ID_CANDIDATES.includes(id as typeof FEISHU_PLUGIN_ID_CANDIDATES[number]),
        );
        normalizedAllow.push(canonicalFeishuId);
        if (JSON.stringify(normalizedAllow) !== JSON.stringify(allowArr)) {
          pluginsObj.allow = normalizedAllow;
          modified = true;
          console.log(`[sanitize] Normalized plugins.allow for feishu -> ${canonicalFeishuId}`);
        }
      }

      if (existingFeishuEntry || !pEntries[canonicalFeishuId]) {
        pEntries[canonicalFeishuId] = {
          ...(existingFeishuEntry || {}),
          ...(pEntries[canonicalFeishuId] || {}),
          enabled: true,
        };
        modified = true;
      }
      for (const id of FEISHU_PLUGIN_ID_CANDIDATES) {
        if (id !== canonicalFeishuId && pEntries[id]) {
          delete pEntries[id];
          modified = true;
        }
      }
      if (canonicalFeishuId !== 'feishu' && pEntries.feishu?.enabled !== false) {
        if (pEntries.feishu) {
          pEntries.feishu.enabled = false;
          modified = true;
          console.log('[sanitize] Disabled bare plugins.entries.feishu (canonical plugin is configured)');
        }
      }
    } else {
      if (Array.isArray(pluginsObj.allow)) {
        const normalizedAllow = allowArr.filter(
          (id) => !FEISHU_PLUGIN_ID_CANDIDATES.includes(id as typeof FEISHU_PLUGIN_ID_CANDIDATES[number]),
        );
        if (normalizedAllow.length !== allowArr.length) {
          pluginsObj.allow = normalizedAllow;
          modified = true;
          console.log('[sanitize] Removed feishu plugin allowlist entries because feishu channel is not configured');
        }
      }

      for (const id of FEISHU_PLUGIN_ID_CANDIDATES) {
        if (pEntries[id]) {
          delete pEntries[id];
          modified = true;
          console.log(`[sanitize] Removed plugins.entries.${id} because feishu channel is not configured`);
        }
      }
    }

  }

  // ── commands section ───────────────────────────────────────────
  // Required for SIGUSR1 in-process reload authorization.
  // NOTE: Do NOT set commands.restart = true here. writeOpenClawJson already
  // compares content before vs after sanitization and sets restart=true only
  // when the actual config content changed. Setting it here unconditionally
  // would always trigger a write (and restart) even when nothing changed.

  // ── tools section (OpenClaw 3.8+) ──────────────────────────────
  // ClawClaw is a local desktop app where the user is the trusted operator.
  // Set tools.profile = 'full' for full tool integration.
  // Set tools.sessions.visibility = 'all' so session history is accessible.
  // Set tools.exec.security = 'full' and ask = 'off' to disable exec approval
  // prompts — they add unnecessary friction in a desktop context where the
  // user already trusts all commands they run.  If a user has manually
  // configured a stricter exec-approvals.json, OpenClaw's minSecurity/maxAsk
  // merge will still respect their intent.
  const toolsConfig = (config.tools as Record<string, unknown> | undefined) || {};
  let toolsModified = false;

  if (toolsConfig.profile !== 'full') {
    toolsConfig.profile = 'full';
    toolsModified = true;
  }

  const sessions = (toolsConfig.sessions as Record<string, unknown> | undefined) || {};
  if (sessions.visibility !== 'all') {
    sessions.visibility = 'all';
    toolsConfig.sessions = sessions;
    toolsModified = true;
  }

  const execConfig = (toolsConfig.exec as Record<string, unknown> | undefined) || {};
  if (execConfig.security !== 'full' || execConfig.ask !== 'off') {
    execConfig.security = 'full';
    execConfig.ask = 'off';
    toolsConfig.exec = execConfig;
    toolsModified = true;
    console.log('[sanitize] Set tools.exec.security="full" and tools.exec.ask="off"');
  }

  if (toolsModified) {
    config.tools = toolsConfig;
    modified = true;
  }

  // ── tools.web.search.kimi ─────────────────────────────────────
  // OpenClaw web_search(kimi) prioritizes tools.web.search.kimi.apiKey over
  // environment/auth-profiles. A stale inline key can cause persistent 401s.
  // When ClawClaw-managed moonshot provider exists, prefer centralized key
  // resolution and strip the inline key.
  const providers =
    ((config.models as Record<string, unknown> | undefined)?.providers as
      | Record<string, unknown>
      | undefined) || {};
  if (providers[OPENCLAW_PROVIDER_KEY_MOONSHOT]) {
    const tools = (config.tools as Record<string, unknown> | undefined) || {};
    const web = (tools.web as Record<string, unknown> | undefined) || {};
    const search = (web.search as Record<string, unknown> | undefined) || {};
    const kimi = (search.kimi as Record<string, unknown> | undefined) || {};
    if ('apiKey' in kimi) {
      console.log(
        '[sanitize] Removing stale key "tools.web.search.kimi.apiKey" from openclaw.json'
      );
      delete kimi.apiKey;
      search.kimi = kimi;
      web.search = search;
      tools.web = web;
      config.tools = tools;
      modified = true;
    }
  }

  // ── agents.defaults.memorySearch ─────────────────────────────
  // Some user configs carry provider values that older or newer OpenClaw
  // builds no longer accept (for example "ollama"). Remove only the known
  // invalid enum values so Gateway startup is not blocked by schema failure.
  if (sanitizeAgentsDefaultsMemorySearch(config)) {
    modified = true;
  }

  // ── models.providers.*.maxTokens (anthropic-messages) ──────────
  // OpenClaw 2026.5+ requires positive maxTokens on every anthropic-messages
  // provider/model entry. Heal legacy configs written by ClawClaw before this
  // contract existed so Gateway startup is not blocked by schema failure.
  if (healAnthropicMessagesMaxTokensInConfig(config)) {
    modified = true;
  }

  if (modified) {
    await writeOpenClawJson(config);
    console.log('[sanitize] openclaw.json sanitized successfully');
  }
}

function isAbsolutePluginPath(filePath: string): boolean {
  return filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\');
}

function isBundledPluginPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.includes('node_modules/openclaw/extensions')
    || normalized.includes('node_modules/openclaw/dist/extensions');
}

export { getProviderEnvVar } from './provider-registry';
