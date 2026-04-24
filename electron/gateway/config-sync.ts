import { createHash } from 'crypto';
import { app } from 'electron';
import path from 'path';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'fs';
import { getAllSettings, getProviderSyncHash, setProviderSyncHash } from '../utils/store';
import { getApiKey, getDefaultProvider, getProvider } from '../utils/secure-storage';
import { getKeyableProviderTypes, getProviderEnvVar } from '../utils/provider-registry';
import { getManagedPythonHome, getManagedUvCacheDir, getOpenClawConfigDir, getOpenClawDir, getOpenClawEntryPath, getPortableDataDir, isOpenClawPresent, resolveOpenClawDir } from '../utils/paths';
import { validateBundledOpenClawRuntime } from '../utils/openclaw-runtime-integrity';
import { getUvMirrorEnv } from '../utils/uv-env';
import {
  cleanupDanglingWeChatPluginState,
  cleanupInvalidManagedChannelPlugins,
  cleanupLegacyChannelPlugins,
  listConfiguredChannels,
  repairChannelConfigConsistency,
} from '../utils/channel-config';
import {
  batchSyncConfigFields,
  syncMemorySettingsToOpenClaw,
  sanitizeOpenClawConfig,
} from '../utils/openclaw-auth';
import { buildProxyEnvAsync, mergeProxyBypassRules, resolveProxySettingsAsync } from '../utils/proxy';
import { syncProxyConfigToOpenClaw } from '../utils/openclaw-proxy';
import { recoverMalformedOpenClawConfig, resetMalformedOpenClawConfig } from '../utils/openclaw-config';
import { logger } from '../utils/logger';
import { ensureBundledPluginInstalled } from '../utils/bundled-plugin-installer';
import {
  syncDefaultProviderToRuntime,
  syncAllProviderAuthToRuntime,
  syncAllProvidersToRuntime,
} from '../services/providers/provider-runtime-sync';
import { listProviderAccounts } from '../services/providers/provider-store';
import { cleanupOrphanLocalModelRuntimeAccounts } from '../services/providers/local-model-presets';
import {
  runGatewayStartupPreflight,
  type GatewayStartupPreflightStep,
} from './startup-preflight';
import type { GatewayConfigRecovery } from '../../src/types/gateway';

const CHANNEL_PLUGIN_INSTALL_MAP: Partial<Record<string, { pluginId: string; displayName: string }>> = {
  feishu: { pluginId: 'feishu', displayName: 'Feishu / Lark' },
  dingtalk: { pluginId: 'dingtalk', displayName: 'DingTalk' },
  wecom: { pluginId: 'wecom', displayName: 'WeCom' },
  wechat: { pluginId: 'openclaw-weixin', displayName: 'WeChat' },
};

const MANAGED_CHANNEL_PLUGIN_MIRRORS = [
  { pluginId: 'feishu', displayName: 'Feishu / Lark' },
  { pluginId: 'dingtalk', displayName: 'DingTalk' },
  { pluginId: 'openclaw-weixin', displayName: 'WeChat' },
  { pluginId: 'wecom', displayName: 'WeCom' },
] as const;

const CHANNEL_PROXY_BYPASS_RULES: Partial<Record<string, string[]>> = {
  wecom: [
    'openws.work.weixin.qq.com',
    'qyapi.weixin.qq.com',
    '*.work.weixin.qq.com',
  ],
  qqbot: [
    'bots.qq.com',
    'api.sgroup.qq.com',
  ],
};

const CHANNELS_REQUIRING_DIRECT_WEBSOCKET = new Set([
  'wecom',
  'qqbot',
]);

const OPENCLAW_PLUGIN_MANIFEST = 'openclaw.plugin.json';
const INVALID_PLUGIN_QUARANTINE_DIR = '.quarantine-invalid-manifests';

function resolveGatewayProxyBypassRules(configuredChannels: string[]): string[] {
  const merged = new Set<string>();
  for (const channelType of configuredChannels) {
    const rules = CHANNEL_PROXY_BYPASS_RULES[channelType];
    if (!rules) continue;
    for (const rule of rules) {
      if (rule.trim()) {
        merged.add(rule.trim());
      }
    }
  }
  return Array.from(merged);
}

function resolveManagedPluginIdsForStartup(configuredChannels: string[]): string[] {
  const pluginIds = new Set<string>();

  for (const channelType of configuredChannels) {
    const plugin = CHANNEL_PLUGIN_INSTALL_MAP[channelType];
    if (plugin) {
      pluginIds.add(plugin.pluginId);
    }
  }

  return Array.from(pluginIds);
}

/**
 * Make built-in extension runtime deps resolvable from shared dist chunks.
 *
 * OpenClaw bundles some extension dependencies under dist/extensions/<ext>/node_modules,
 * but shared chunks under dist/ may import those packages directly. Standard ESM
 * resolution does not search dist/extensions/<ext>/node_modules, so we symlink any
 * missing extension-owned deps into the top-level openclaw/node_modules.
 */
function ensureExtensionDepsResolvable(openclawDir: string): void {
  const extDir = path.join(openclawDir, 'dist', 'extensions');
  const topNodeModules = path.join(openclawDir, 'node_modules');
  let linkedCount = 0;

  try {
    if (!existsSync(extDir)) return;

    for (const ext of readdirSync(extDir, { withFileTypes: true })) {
      if (!ext.isDirectory()) continue;
      const extNodeModules = path.join(extDir, ext.name, 'node_modules');
      if (!existsSync(extNodeModules)) continue;

      for (const pkg of readdirSync(extNodeModules, { withFileTypes: true })) {
        if (pkg.name === '.bin') continue;

        if (pkg.name.startsWith('@')) {
          const scopeDir = path.join(extNodeModules, pkg.name);
          let scopeEntries: ReturnType<typeof readdirSync>;
          try {
            scopeEntries = readdirSync(scopeDir, { withFileTypes: true });
          } catch {
            continue;
          }

          for (const sub of scopeEntries) {
            if (!sub.isDirectory()) continue;
            const dest = path.join(topNodeModules, pkg.name, sub.name);
            if (existsSync(dest)) continue;
            try {
              mkdirSync(path.join(topNodeModules, pkg.name), { recursive: true });
              symlinkSync(path.join(scopeDir, sub.name), dest);
              linkedCount++;
            } catch {
              // Non-fatal: skip on symlink errors and rely on existing deps.
            }
          }
        } else {
          const dest = path.join(topNodeModules, pkg.name);
          if (existsSync(dest)) continue;
          try {
            mkdirSync(topNodeModules, { recursive: true });
            symlinkSync(path.join(extNodeModules, pkg.name), dest);
            linkedCount++;
          } catch {
            // Non-fatal: skip on symlink errors and rely on existing deps.
          }
        }
      }
    }
  } finally {
    if (linkedCount > 0) {
      logger.info(`[plugin] Linked ${linkedCount} built-in extension runtime dependencies into openclaw/node_modules`);
    }
  }
}

function hasObjectConfigSchema(manifest: unknown): boolean {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return false;
  }
  const configSchema = (manifest as Record<string, unknown>).configSchema;
  return !!configSchema && typeof configSchema === 'object' && !Array.isArray(configSchema);
}

function readPluginManifest(manifestPath: string): { id: string | null; hasConfigSchema: boolean } | null {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as unknown;
    const id =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).id
        : null;
    return {
      id: typeof id === 'string' && id.trim() ? id.trim() : null,
      hasConfigSchema: hasObjectConfigSchema(parsed),
    };
  } catch {
    return { id: null, hasConfigSchema: false };
  }
}

function cleanupQuarantinedPluginConfig(pluginIds: string[]): boolean {
  if (pluginIds.length === 0) return false;

  const configPath = path.join(resolveOpenClawDir(), 'openclaw.json');
  if (!existsSync(configPath)) return false;

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const plugins = config.plugins;
    if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) {
      return false;
    }

    const pluginSet = new Set(pluginIds);
    const pluginRecord = plugins as Record<string, unknown>;
    let modified = false;

    if (Array.isArray(pluginRecord.allow)) {
      const nextAllow = pluginRecord.allow.filter((id) => {
        const keep = typeof id !== 'string' || !pluginSet.has(id);
        if (!keep) modified = true;
        return keep;
      });
      pluginRecord.allow = nextAllow;
    }

    const entries = pluginRecord.entries;
    if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
      for (const id of pluginSet) {
        if (Object.prototype.hasOwnProperty.call(entries, id)) {
          delete (entries as Record<string, unknown>)[id];
          modified = true;
        }
      }
    }

    if (modified) {
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    }
    return modified;
  } catch (err) {
    logger.warn('[plugin-preflight] Failed to clean quarantined plugin config entries:', err);
    return false;
  }
}

function quarantineInvalidUserExtensionManifests(): { quarantinedPluginIds: string[]; quarantinedDirs: string[] } {
  const extensionsDir = path.join(resolveOpenClawDir(), 'extensions');
  const quarantinedPluginIds: string[] = [];
  const quarantinedDirs: string[] = [];

  if (!existsSync(extensionsDir)) {
    return { quarantinedPluginIds, quarantinedDirs };
  }

  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(extensionsDir, { withFileTypes: true });
  } catch (err) {
    logger.warn('[plugin-preflight] Failed to scan OpenClaw extensions directory:', err);
    return { quarantinedPluginIds, quarantinedDirs };
  }

  const quarantineRoot = path.join(extensionsDir, INVALID_PLUGIN_QUARANTINE_DIR);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const pluginDir = path.join(extensionsDir, entry.name);
    const manifestPath = path.join(pluginDir, OPENCLAW_PLUGIN_MANIFEST);
    if (!existsSync(manifestPath)) continue;

    const manifest = readPluginManifest(manifestPath);
    if (manifest?.hasConfigSchema) continue;

    const pluginId = manifest?.id ?? entry.name;
    const destination = path.join(quarantineRoot, `${entry.name}-${timestamp}`);
    try {
      mkdirSync(quarantineRoot, { recursive: true });
      renameSync(pluginDir, destination);
      quarantinedPluginIds.push(pluginId, entry.name);
      quarantinedDirs.push(destination);
      logger.warn(
        `[plugin-preflight] Quarantined invalid OpenClaw plugin manifest: ${entry.name} (${pluginId}) → ${destination}`,
      );
    } catch (err) {
      logger.warn(`[plugin-preflight] Failed to quarantine invalid plugin manifest at ${pluginDir}:`, err);
    }
  }

  const uniqueIds = Array.from(new Set(quarantinedPluginIds));
  cleanupQuarantinedPluginConfig(uniqueIds);
  return { quarantinedPluginIds: uniqueIds, quarantinedDirs };
}

async function repairStartupPluginManifests(): Promise<{ repaired: boolean }> {
  let repaired = false;

  const configuredChannels = await withTimeout(
    listConfiguredChannels({ includeCli: false }),
    1500,
    'listConfiguredChannelsForPluginPreflight',
    [],
  );
  const pluginIds = resolveManagedPluginIdsForStartup(configuredChannels);
  for (const pluginId of pluginIds) {
    const plugin = MANAGED_CHANNEL_PLUGIN_MIRRORS.find((p) => p.pluginId === pluginId);
    if (!plugin) continue;
    const result = ensureBundledPluginInstalled(plugin.pluginId, plugin.displayName, { forceReinstall: true });
    if (result.warning) {
      logger.warn(`[plugin-preflight] ${result.warning}`);
    } else if (result.changed) {
      repaired = true;
      logger.info(`[plugin-preflight] Repaired ${plugin.displayName} plugin mirror`);
    }
  }

  const invalidManaged = await withTimeout(
    cleanupInvalidManagedChannelPlugins(),
    3000,
    'cleanupInvalidManagedChannelPlugins',
    { cleaned: false, removedPluginIds: [] },
  );
  if (invalidManaged.cleaned) {
    repaired = true;
    logger.warn(
      `[plugin-preflight] Removed invalid managed plugin mirrors: ${invalidManaged.removedPluginIds.join(', ')}`,
    );
  }

  for (const pluginId of pluginIds) {
    const plugin = MANAGED_CHANNEL_PLUGIN_MIRRORS.find((p) => p.pluginId === pluginId);
    if (!plugin) continue;
    const result = ensureBundledPluginInstalled(plugin.pluginId, plugin.displayName);
    if (result.warning) {
      logger.warn(`[plugin-preflight] ${result.warning}`);
    } else if (result.changed) {
      repaired = true;
      logger.info(`[plugin-preflight] Repaired ${plugin.displayName} plugin mirror`);
    }
  }

  const quarantined = quarantineInvalidUserExtensionManifests();
  if (quarantined.quarantinedDirs.length > 0) {
    repaired = true;
  }

  return { repaired };
}

/**
 * Wraps a promise with a timeout. If the promise times out, returns `fallback`.
 * Suitable for READ-ONLY operations where a stale/default result is acceptable.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  fallback: T,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((resolve) => {
        timeoutHandle = setTimeout(() => {
          logger.warn(`${label} timed out after ${timeoutMs}ms; returning fallback`);
          resolve(fallback);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Extract stable (non-secret, non-timestamp) fields from a provider account
 * for deterministic hash computation.  `createdAt`/`updatedAt` are excluded
 * because they change on every settings save even when nothing substantive changed.
 */
function stableAccountFingerprint(account: ReturnType<typeof listProviderAccounts>[number]): string {
  return JSON.stringify({
    id: account.id,
    vendorId: account.vendorId,
    label: account.label,
    authMode: account.authMode,
    baseUrl: account.baseUrl,
    apiProtocol: account.apiProtocol,
    model: account.model,
    fallbackModels: account.fallbackModels,
    fallbackAccountIds: account.fallbackAccountIds,
    enabled: account.enabled,
    isDefault: account.isDefault,
    metadata: account.metadata
      ? {
          region: account.metadata.region,
          resourceUrl: account.metadata.resourceUrl,
          customModels: account.metadata.customModels,
          localModel: account.metadata.localModel,
          localModelProvider: account.metadata.localModelProvider,
          allowPrivateNetwork: account.metadata.allowPrivateNetwork,
          presetId: account.metadata.presetId,
          primaryPresetId: account.metadata.primaryPresetId,
          presetIds: account.metadata.presetIds,
        }
      : undefined,
  });
}

/**
 * Compute a fast SHA-256 hash of the current provider account configuration.
 * If no accounts exist, returns a fixed sentinel hash so the first launch
 * still performs a sync.
 */
async function computeCurrentProviderHash(): Promise<string> {
  const accounts = await listProviderAccounts();
  const stable = accounts.map(stableAccountFingerprint).sort((a, b) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

/**
 * Returns true if the provider runtime sync steps should be SKIPPED.
 * Skips when the hash of stable account fields matches the hash stored after
 * the last successful sync — meaning no provider configuration changed.
 *
 * This eliminates redundant `openclaw.json` writes on every app launch when
 * the provider list is unchanged.
 */
async function shouldSkipProviderSync(): Promise<boolean> {
  try {
    const [currentHash, lastHash] = await Promise.all([
      computeCurrentProviderHash(),
      getProviderSyncHash(),
    ]);
    if (currentHash === lastHash && lastHash !== '') {
      logger.debug(`[provider-hash] Config unchanged (${currentHash.slice(0, 8)}…), skipping provider sync`);
      return true;
    }
    return false;
  } catch (err) {
    logger.debug('[provider-hash] Could not compare provider hashes, proceeding with sync:', err);
    return false;
  }
}

/**
 * Called after a successful provider runtime sync to persist the hash
 * so subsequent launches can skip the sync when nothing changed.
 */
async function recordProviderSyncHash(): Promise<void> {
  try {
    const hash = await computeCurrentProviderHash();
    await setProviderSyncHash(hash);
    logger.debug(`[provider-hash] Recorded hash after sync: ${hash.slice(0, 8)}…`);
  } catch (err) {
    logger.debug('[provider-hash] Failed to record sync hash (non-fatal):', err);
  }
}

export interface GatewayLaunchContext {
  appSettings: Awaited<ReturnType<typeof getAllSettings>>;
  openclawDir: string;
  entryScript: string;
  gatewayArgs: string[];
  forkEnv: Record<string, string | undefined>;
  mode: 'dev' | 'packaged';
  binPathExists: boolean;
  loadedProviderKeyCount: number;
  proxySummary: string;
  channelStartupSummary: string;
}

async function repairOpenClawConfigFile(): Promise<GatewayConfigRecovery | null> {
  let outcome: GatewayConfigRecovery | null = null;
  let recoveredMalformedConfig = false;

  try {
    const result = await withTimeout(
      recoverMalformedOpenClawConfig(),
      2000,
      'recoverMalformedOpenClawConfig',
      { outcome: 'none', backupPath: null } as const,
    );
    if (result.outcome === 'repaired' || result.outcome === 'reset') {
      recoveredMalformedConfig = true;
      outcome = {
        kind: result.outcome === 'repaired' ? 'config-repaired' : 'config-reset',
        strategy: result.strategy,
        backupPath: result.backupPath ?? undefined,
        topics: ['config'],
      };
      logger.warn(
        `OpenClaw config preflight ${result.outcome}${result.backupPath ? ` (backup: ${result.backupPath})` : ''}${result.strategy ? ` using ${result.strategy}` : ''}`,
      );
    }
  } catch (err) {
    logger.warn('Failed to recover malformed openclaw.json during preflight:', err);
  }

  try {
    await withTimeout(sanitizeOpenClawConfig(), 2000, 'sanitizeOpenClawConfig', undefined);
  } catch (err) {
    logger.warn('Failed to sanitize openclaw.json:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (!recoveredMalformedConfig && message.includes('Failed to parse OpenClaw config')) {
      try {
        const backupPath = await resetMalformedOpenClawConfig();
        outcome = {
          kind: 'config-reset',
          strategy: 'reset',
          backupPath: backupPath ?? undefined,
          topics: ['config'],
        };
        logger.warn(
          `Recovered malformed openclaw.json by recreating it${backupPath ? ` (backup: ${backupPath})` : ''}`,
        );
      } catch (recoveryErr) {
        logger.error('Failed to recover malformed openclaw.json:', recoveryErr);
      }
    }
  }

  return outcome;
}

let lastStartupPreflightRecovery: GatewayConfigRecovery | null = null;
let lastStartupPreflightFailedStepIds: string[] = [];

function buildPreflightRecovery(topics: GatewayConfigRecovery['topics']): GatewayConfigRecovery | null {
  const uniqueTopics = Array.from(new Set((topics ?? []).filter(Boolean)));
  if (uniqueTopics.length === 0) {
    return null;
  }
  return {
    kind: 'preflight',
    topics: uniqueTopics,
  };
}

export function getLastStartupPreflightRecovery(): GatewayConfigRecovery | null {
  return lastStartupPreflightRecovery;
}

export function getLastStartupPreflightFailedStepIds(): string[] {
  return [...lastStartupPreflightFailedStepIds];
}

/**
 * Background deferred sync of managed channel plugin mirrors.
 * Runs after Gateway is connected — failures are non-fatal since the
 * Gateway can operate without the optional China-channel plugins.
 *
 * DEFERRED from preflight (optimization: plugin file copy is I/O-bound
 * and not required for Gateway startup; deferring unblocks startup).
 */
export function runDeferredManagedPluginSync(configuredChannels: string[] = []): void {
  void (async () => {
    try {
      const pluginIds = resolveManagedPluginIdsForStartup(configuredChannels);
      for (const pluginId of pluginIds) {
        const plugin = MANAGED_CHANNEL_PLUGIN_MIRRORS.find((p) => p.pluginId === pluginId);
        if (!plugin) continue;
        const result = ensureBundledPluginInstalled(plugin.pluginId, plugin.displayName);
        if (result.warning) {
          logger.warn(`[deferred-plugin-sync] ${result.warning}`);
        } else if (result.installed && result.changed) {
          logger.info(`[deferred-plugin-sync] Installed ${plugin.displayName} plugin`);
        }
      }
    } catch (err) {
      logger.warn('[deferred-plugin-sync] Plugin sync failed (non-fatal):', err);
    }
  })();
}

export async function runOpenClawStartupPreflightRepair(): Promise<void> {
  const recoveryTopics: NonNullable<GatewayConfigRecovery['topics']> = [];
  let configRecovery: GatewayConfigRecovery | null = null;

  // ── Phase 1: Runtime validation (fatal, sequential) ──────────────
  // `validate-bundled-runtime` must run alone because it is fatal — if
  // OpenClaw is missing/corrupt we cannot proceed at all.
  const PHASE_1_FATAL: GatewayStartupPreflightStep = {
    id: 'validate-bundled-runtime',
    label: 'validateBundledOpenClawRuntime',
    fatal: true,
    run: async () => {
      await withTimeout(
        validateBundledOpenClawRuntime(),
        6000,
        'validateBundledOpenClawRuntime',
        undefined,
      );
      ensureExtensionDepsResolvable(getOpenClawDir());
    },
  };

  // ── Phase 2: Plugin manifest repair (non-fatal, sequential) ─────────
  // OpenClaw 2026.4.15 validates extension manifests and channel ids before
  // the Gateway becomes ready. Keep this before config repair so sanitizer or
  // doctor does not strip plugin entries for configured external channels.
  const PHASE_2_PLUGIN_REPAIR: GatewayStartupPreflightStep = {
    id: 'repair-plugin-manifests',
    label: 'repairStartupPluginManifests',
    run: async () => {
      const result = await repairStartupPluginManifests();
      if (result.repaired) {
        recoveryTopics.push('plugins');
      }
    },
  };

  // ── Phase 3: Config + channel repair (parallel, non-fatal) ─────────
  // These two are independent and can run concurrently.
  const PHASE_3_REPAIR: GatewayStartupPreflightStep[] = [
    {
      id: 'repair-openclaw-config',
      label: 'repairOpenClawConfigFile',
      run: async () => {
        configRecovery = await repairOpenClawConfigFile();
        if (configRecovery?.topics) {
          recoveryTopics.push(...configRecovery.topics);
        }
      },
    },
    {
      id: 'repair-channel-config-consistency',
      label: 'repairChannelConfigConsistency',
      run: async () => {
        const result = await withTimeout(
          repairChannelConfigConsistency(),
          2000,
          'repairChannelConfigConsistency',
          { repaired: false },
        );
        if (result.repaired) {
          recoveryTopics.push('channels');
        }
      },
    },
  ];

  // ── Phase 4: Cleanup + sync (parallel, non-fatal) ───────────────────
  const PHASE_4_CLEANUP_SYNC: GatewayStartupPreflightStep[] = [
    {
      id: 'cleanup-dangling-wechat-plugin-state',
      label: 'cleanupDanglingWeChatPluginState',
      run: async () => {
        const result = await withTimeout(
          cleanupDanglingWeChatPluginState(),
          2000,
          'cleanupDanglingWeChatPluginState',
          { cleanedDanglingState: false },
        );
        if (result.cleanedDanglingState) {
          recoveryTopics.push('channels', 'plugins');
        }
      },
    },
    {
      id: 'cleanup-legacy-channel-plugins',
      label: 'cleanupLegacyChannelPlugins',
      run: async () => {
        const result = await withTimeout(
          cleanupLegacyChannelPlugins(),
          3000,
          'cleanupLegacyChannelPlugins',
          { cleaned: false },
        );
        if (result.cleaned) {
          recoveryTopics.push('plugins');
        }
      },
    },
    {
      id: 'cleanup-orphan-local-model-runtime-accounts',
      label: 'cleanupOrphanLocalModelRuntimeAccounts',
      run: async () => {
        const result = await withTimeout(
          cleanupOrphanLocalModelRuntimeAccounts(),
          3000,
          'cleanupOrphanLocalModelRuntimeAccounts',
          { removedAccountIds: [] },
        );
        if (result.removedAccountIds.length > 0) {
          logger.warn(
            `Removed orphan local model runtime accounts during startup preflight: ${result.removedAccountIds.join(', ')}`,
          );
        }
      },
    },
    {
      id: 'sync-default-provider',
      label: 'syncDefaultProviderToRuntime',
      run: async () => {
        const defaultProviderId = await withTimeout(
          getDefaultProvider(),
          1500,
          'getDefaultProviderForRuntimeSync',
          null,
        );
        if (!defaultProviderId) {
          return;
        }
        await withTimeout(
          syncDefaultProviderToRuntime(defaultProviderId, { suppressRefresh: true }),
          3000,
          'syncDefaultProviderToRuntime',
          undefined,
        );
      },
    },
    {
      id: 'sync-provider-configs',
      label: 'syncAllProvidersToRuntimeBeforeLaunch',
      run: async () => {
        if (await shouldSkipProviderSync()) {
          await recordProviderSyncHash();
          return;
        }
        await withTimeout(
          syncAllProvidersToRuntime(),
          4000,
          'syncAllProvidersToRuntimeBeforeLaunch',
          undefined,
        );
        await recordProviderSyncHash();
      },
    },
    {
      id: 'sync-provider-auth',
      label: 'syncAllProviderAuthToRuntimeBeforeLaunch',
      run: async () => {
        // Auth sync also guarded by the same hash — if the provider account list
        // hasn't changed, credentials are unchanged too.
        if (await shouldSkipProviderSync()) {
          return;
        }
        await withTimeout(
          syncAllProviderAuthToRuntime(),
          4000,
          'syncAllProviderAuthToRuntimeBeforeLaunch',
          undefined,
        );
      },
    },
  ];

  // Phases run sequentially; steps within phases 2 and 3 run in parallel.
  const result = await runGatewayStartupPreflight({
    phases: [
      { id: 'phase-1-runtime', label: 'Runtime validation (fatal)', steps: [PHASE_1_FATAL] },
      { id: 'phase-2-plugin-repair', label: 'Plugin manifest repair', steps: [PHASE_2_PLUGIN_REPAIR] },
      { id: 'phase-3-repair', label: 'Config & channel repair', steps: PHASE_3_REPAIR },
      { id: 'phase-4-cleanup-sync', label: 'Cleanup & sync', steps: PHASE_4_CLEANUP_SYNC },
    ],
    onStepError: (step, error) => {
      logger.warn(`Startup preflight step failed: ${step.label}`, error);
    },
  });

  if (result.failedStepIds.length > 0) {
    logger.warn(
      `Startup preflight completed with partial failures: ${result.failedStepIds.join(', ')}`,
    );
  }

  lastStartupPreflightFailedStepIds = [...result.failedStepIds];
  lastStartupPreflightRecovery = configRecovery ?? buildPreflightRecovery(recoveryTopics);
}

export async function syncGatewayConfigBeforeLaunch(
  appSettings: Awaited<ReturnType<typeof getAllSettings>>,
): Promise<void> {
  await runOpenClawStartupPreflightRepair();

  // These sync tasks improve eventual config consistency, but they are not
  // required to block process launch because the gateway receives token/proxy
  // data via argv/env for immediate startup. Run them in the background so
  // one slow filesystem or keychain operation doesn't add 15-25s to startup.
  void withTimeout(
    syncProxyConfigToOpenClaw(appSettings),
    2000,
    'syncProxyConfigToOpenClaw',
    undefined,
  ).catch((err) => {
    logger.warn('Failed to sync proxy config to openclaw.json:', err);
  });

  void withTimeout(
    batchSyncConfigFields(appSettings.gatewayToken),
    5000,
    'batchSyncConfigFields',
    undefined,
  ).catch((err) => {
    logger.warn('Failed to batch-sync config fields to openclaw.json:', err);
  });

  void withTimeout(
    syncMemorySettingsToOpenClaw({
      sessionMemoryEnabled: appSettings.sessionMemoryEnabled,
      memorySearchEnabled: appSettings.memorySearchEnabled,
    }),
    2000,
    'syncMemorySettingsToOpenClaw',
    undefined,
  ).catch((err) => {
    logger.warn('Failed to sync memory settings to openclaw.json:', err);
  });
}

async function loadProviderEnv(): Promise<{ providerEnv: Record<string, string>; loadedProviderKeyCount: number }> {
  const providerEnv: Record<string, string> = {};
  const providerTypes = getKeyableProviderTypes();
  let loadedProviderKeyCount = 0;

  try {
    const defaultProviderId = await getDefaultProvider();
    if (defaultProviderId) {
      const defaultProvider = await getProvider(defaultProviderId);
      const defaultProviderType = defaultProvider?.type;
      const defaultProviderKey = await getApiKey(defaultProviderId);
      if (defaultProviderType && defaultProviderKey) {
        const envVar = getProviderEnvVar(defaultProviderType);
        if (envVar) {
          providerEnv[envVar] = defaultProviderKey;
          loadedProviderKeyCount++;
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to load default provider key for environment injection:', err);
  }

  for (const providerType of providerTypes) {
    try {
      const key = await getApiKey(providerType);
      if (key) {
        const envVar = getProviderEnvVar(providerType);
        if (envVar) {
          providerEnv[envVar] = key;
          loadedProviderKeyCount++;
        }
      }
    } catch (err) {
      logger.warn(`Failed to load API key for ${providerType}:`, err);
    }
  }

  return { providerEnv, loadedProviderKeyCount };
}

async function resolveChannelStartupPolicy(): Promise<{
  skipChannels: boolean;
  channelStartupSummary: string;
  configuredChannels: string[];
}> {
  try {
    const configuredChannels = await listConfiguredChannels({ includeCli: false });
    if (configuredChannels.length === 0) {
      return {
        skipChannels: true,
        channelStartupSummary: 'skipped(no configured channels)',
        configuredChannels: [],
      };
    }

    return {
      skipChannels: false,
      channelStartupSummary: `enabled(${configuredChannels.join(',')})`,
      configuredChannels,
    };
  } catch (error) {
    logger.warn('Failed to determine configured channels for gateway launch:', error);
    return {
      skipChannels: false,
      channelStartupSummary: 'enabled(unknown)',
      configuredChannels: [],
    };
  }
}

export async function prepareGatewayLaunchContext(port: number): Promise<GatewayLaunchContext> {
  const openclawDir = getOpenClawDir();
  const entryScript = getOpenClawEntryPath();

  if (!isOpenClawPresent()) {
    throw new Error(`OpenClaw package not found at: ${openclawDir}`);
  }

  const appSettings = await getAllSettings();
  await syncGatewayConfigBeforeLaunch(appSettings);

  if (!existsSync(entryScript)) {
    throw new Error(`OpenClaw entry script not found at: ${entryScript}`);
  }

  const gatewayArgs = [
    'gateway',
    '--port',
    String(port),
    '--bind',
    'loopback',
    '--token',
    appSettings.gatewayToken,
    '--allow-unconfigured',
  ];
  const mode = app.isPackaged ? 'packaged' : 'dev';

  const platform = process.platform;
  const arch = process.arch;
  const target = `${platform}-${arch}`;
  const binPath = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(process.cwd(), 'resources', 'bin', target);
  const binPathExists = existsSync(binPath);
  const finalPath = binPathExists
    ? `${binPath}${path.delimiter}${process.env.PATH || ''}`
    : process.env.PATH || '';

  const { providerEnv, loadedProviderKeyCount } = await withTimeout(
    loadProviderEnv(),
    8000,
    'loadProviderEnv',
    { providerEnv: {}, loadedProviderKeyCount: 0 },
  );
  const { skipChannels, channelStartupSummary, configuredChannels } = await withTimeout(
    resolveChannelStartupPolicy(),
    1500,
    'resolveChannelStartupPolicy',
    {
      skipChannels: false,
      channelStartupSummary: 'enabled(timeout-fallback)',
      configuredChannels: [],
    },
  );
  const uvEnv = await withTimeout(getUvMirrorEnv(), 5000, 'getUvMirrorEnv', {});
  const proxyEnv = await withTimeout(buildProxyEnvAsync(appSettings), 5000, 'buildProxyEnvAsync', {});
  const resolvedProxy = await withTimeout(
    resolveProxySettingsAsync(appSettings),
    5000,
    'resolveProxySettingsAsync',
    {},
  );
  const hasResolvedProxy = Boolean(
    resolvedProxy.httpProxy || resolvedProxy.httpsProxy || resolvedProxy.allProxy
  );
  const proxyMode = appSettings.proxyMode || (appSettings.proxyEnabled ? 'custom' : 'system');
  const gatewayProxyBypassRules = resolveGatewayProxyBypassRules(skipChannels ? [] : configuredChannels);
  if (gatewayProxyBypassRules.length > 0) {
    const mergedNoProxy = mergeProxyBypassRules(
      typeof proxyEnv.NO_PROXY === 'string' ? proxyEnv.NO_PROXY : proxyEnv.no_proxy,
      gatewayProxyBypassRules,
    );
    proxyEnv.NO_PROXY = mergedNoProxy;
    proxyEnv.no_proxy = mergedNoProxy;
    if (typeof resolvedProxy.bypassRules === 'string') {
      resolvedProxy.bypassRules = mergeProxyBypassRules(resolvedProxy.bypassRules, gatewayProxyBypassRules);
    }
  }
  const requiresDirectWebSocket = !skipChannels
    && configuredChannels.some((channelType) => CHANNELS_REQUIRING_DIRECT_WEBSOCKET.has(channelType));
  if (requiresDirectWebSocket) {
    proxyEnv.ALL_PROXY = '';
    proxyEnv.all_proxy = '';
    resolvedProxy.allProxy = '';
  }
  const proxySummary =
    proxyMode === 'direct'
      ? 'direct'
      : hasResolvedProxy
        ? `${proxyMode}: http=${resolvedProxy.httpProxy || '-'}, https=${resolvedProxy.httpsProxy || '-'}, all=${resolvedProxy.allProxy || '-'}${requiresDirectWebSocket ? ' (ws-direct)' : ''}`
        : `${proxyMode}: none`;

  const { NODE_OPTIONS: _nodeOptions, ...baseEnv } = process.env;
  // Follows the same pattern as u-claw:
  //   OPENCLAW_HOME        = parent data dir (portable/ or unset for default)
  //   OPENCLAW_STATE_DIR   = actual state dir (portable/.openclaw/ or ~/.openclaw/)
  //   OPENCLAW_CONFIG_PATH = state dir + openclaw.json
  // In dev/installed mode these are all omitted so OpenClaw uses its defaults.
  // In portable mode they redirect everything to the USB drive.
  // NOTE: OPENCLAW_HOME must NOT be set to a .openclaw path directly —
  // OpenClaw appends ".openclaw" to it, causing ~/.openclaw/.openclaw duplication.
  const portableDataDir = getPortableDataDir();    // null in dev/installed
  const openclawStateDir = getOpenClawConfigDir(); // null in dev; portable/.openclaw in portable
  const forkEnv: Record<string, string | undefined> = {
    ...baseEnv,
    PATH: finalPath,
    ...providerEnv,
    ...uvEnv,
    ...proxyEnv,
    ...(getManagedPythonHome() ? { UV_PYTHON_INSTALL_DIR: getManagedPythonHome()! } : {}),
    ...(getManagedUvCacheDir() ? { UV_CACHE_DIR: getManagedUvCacheDir()! } : {}),
    ...(portableDataDir
      ? {
          // Portable: parent data dir (portable/), state dir (portable/.openclaw/), config
          OPENCLAW_HOME: portableDataDir,
          OPENCLAW_STATE_DIR: openclawStateDir,
          OPENCLAW_CONFIG_PATH: path.join(openclawStateDir!, 'openclaw.json'),
        }
      : {}),
    OPENCLAW_GATEWAY_TOKEN: appSettings.gatewayToken,
    OPENCLAW_HANDSHAKE_TIMEOUT_MS: process.env.OPENCLAW_HANDSHAKE_TIMEOUT_MS || '20000',
    OPENCLAW_DISABLE_BONJOUR: '1',
    NODE_NO_WARNINGS: '1',
    OPENCLAW_SKIP_CHANNELS: skipChannels ? '1' : '',
    CLAWDBOT_SKIP_CHANNELS: skipChannels ? '1' : '',
    OPENCLAW_NO_RESPAWN: '1',
  };

  return {
    appSettings,
    openclawDir,
    entryScript,
    gatewayArgs,
    forkEnv,
    mode,
    binPathExists,
    loadedProviderKeyCount,
    proxySummary,
    channelStartupSummary,
  };
}
