import { createHash } from 'crypto';
import { app } from 'electron';
import path from 'path';
import { existsSync, mkdirSync, readdirSync, symlinkSync } from 'fs';
import { getAllSettings, getProviderSyncHash, setProviderSyncHash } from '../utils/store';
import { getApiKey, getDefaultProvider, getProvider } from '../utils/secure-storage';
import { getKeyableProviderTypes, getProviderEnvVar } from '../utils/provider-registry';
import { getOpenClawConfigDir, getOpenClawDir, getOpenClawEntryPath, getPortableDataDir, isOpenClawPresent } from '../utils/paths';
import { validateBundledOpenClawRuntime } from '../utils/openclaw-runtime-integrity';
import { getUvMirrorEnv } from '../utils/uv-env';
import {
  cleanupDanglingWeChatPluginState,
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
  dingtalk: { pluginId: 'channels', displayName: 'China Channels' },
  wecom: { pluginId: 'wecom', displayName: 'WeCom' },
  wechat: { pluginId: 'openclaw-weixin', displayName: 'WeChat' },
};

const MANAGED_CHANNEL_PLUGIN_MIRRORS = [
  { pluginId: 'feishu', displayName: 'Feishu / Lark' },
  { pluginId: 'channels', displayName: 'China Channels' },
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

  // ── Phase 2: Config + channel repair (parallel, non-fatal) ─────────
  // These two are independent and can run concurrently.
  const PHASE_2_REPAIR: GatewayStartupPreflightStep[] = [
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

  // ── Phase 3: Cleanup + sync (parallel, non-fatal) ───────────────────
  // NOTE: `sync-managed-channel-plugin-mirrors` is DEFERRED to post-startup
  // (see `runDeferredManagedPluginSync`) — it is omitted here.
  const PHASE_3_CLEANUP_SYNC: GatewayStartupPreflightStep[] = [
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
      { id: 'phase-2-repair', label: 'Config & channel repair', steps: PHASE_2_REPAIR },
      { id: 'phase-3-cleanup-sync', label: 'Cleanup & sync', steps: PHASE_3_CLEANUP_SYNC },
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

  const gatewayArgs = ['gateway', '--port', String(port), '--token', appSettings.gatewayToken, '--allow-unconfigured'];
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
