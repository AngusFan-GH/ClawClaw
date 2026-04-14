import { app } from 'electron';
import path from 'path';
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'fs';
import { homedir } from 'os';
import { getAllSettings } from '../utils/store';
import { getApiKey, getDefaultProvider, getProvider } from '../utils/secure-storage';
import { getProviderEnvVar, getKeyableProviderTypes } from '../utils/provider-registry';
import { getOpenClawDir, getOpenClawEntryPath, getOpenClawConfigDir, isOpenClawPresent } from '../utils/paths';
import { validateBundledOpenClawRuntime } from '../utils/openclaw-runtime-integrity';
import { getUvMirrorEnv } from '../utils/uv-env';
import {
  cleanupDanglingWeChatPluginState,
  cleanupLegacyChannelPlugins,
  listConfiguredChannels,
  repairChannelConfigConsistency,
} from '../utils/channel-config';
import {
  syncBrowserConfigToOpenClaw,
  syncGatewayTokenToConfig,
  syncMemorySettingsToOpenClaw,
  sanitizeOpenClawConfig,
} from '../utils/openclaw-auth';
import { buildProxyEnvAsync, mergeProxyBypassRules, resolveProxySettingsAsync } from '../utils/proxy';
import { syncProxyConfigToOpenClaw } from '../utils/openclaw-proxy';
import { recoverMalformedOpenClawConfig, resetMalformedOpenClawConfig } from '../utils/openclaw-config';
import { logger } from '../utils/logger';
import { ensureBundledPluginInstalled } from '../utils/bundled-plugin-installer';
import { syncDefaultProviderToRuntime } from '../services/providers/provider-runtime-sync';
import {
  syncAllProviderAuthToRuntime,
  syncAllProvidersToRuntime,
} from '../services/providers/provider-runtime-sync';
import { cleanupOrphanLocalModelRuntimeAccounts } from '../services/providers/local-model-presets';
import { runGatewayStartupPreflight, type GatewayStartupPreflightStep } from './startup-preflight';
import type { GatewayConfigRecovery } from '../../src/types/gateway';

const CHANNEL_PLUGIN_INSTALL_MAP: Partial<Record<string, { pluginId: string; displayName: string }>> = {
  feishu: { pluginId: 'feishu', displayName: 'Feishu / Lark' },
  dingtalk: { pluginId: 'channels', displayName: 'China Channels' },
  wecom: { pluginId: 'channels', displayName: 'China Channels' },
  wechat: { pluginId: 'openclaw-weixin', displayName: 'WeChat' },
};

const MANAGED_CHANNEL_PLUGIN_MIRRORS = [
  { pluginId: 'feishu', displayName: 'Feishu / Lark' },
  { pluginId: 'channels', displayName: 'China Channels' },
  { pluginId: 'openclaw-weixin', displayName: 'WeChat' },
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

function syncManagedChannelPluginMirrors(configuredChannels: string[]): string[] {
  const touchedPluginIds: string[] = [];
  const pluginIds = resolveManagedPluginIdsForStartup(configuredChannels);

  for (const pluginId of pluginIds) {
    const plugin = MANAGED_CHANNEL_PLUGIN_MIRRORS.find((entry) => entry.pluginId === pluginId);
    if (!plugin) continue;
    // Startup preflight should only repair stale/broken mirrors. Forcing a
    // reinstall on every launch makes packaged builds report a fake "repaired"
    // recovery even when nothing is wrong.
    const result = ensureBundledPluginInstalled(plugin.pluginId, plugin.displayName);
    if (result.warning) {
      logger.warn(result.warning);
    }
    if (result.installed && result.changed) {
      touchedPluginIds.push(pluginId);
    }
  }

  return touchedPluginIds;
}

/**
 * Wraps a promise with a timeout. If the promise times out, returns `fallback`.
 * Suitable for READ-ONLY operations where a stale/default result is acceptable.
 * WARNING: The underlying promise continues to run even after timeout resolves —
 * for write operations, use withTimeoutOrThrow instead to avoid partial writes.
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
 * Wraps a promise with a timeout. If the promise times out, throws an error.
 * Suitable for WRITE operations where partial completion is worse than failure.
 */
async function withTimeoutOrThrow<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race<T>([promise, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
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

export async function runOpenClawStartupPreflightRepair(): Promise<void> {
  const recoveryTopics: NonNullable<GatewayConfigRecovery['topics']> = [];
  let configRecovery: GatewayConfigRecovery | null = null;

  const steps: GatewayStartupPreflightStep[] = [
    {
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
    },
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
      id: 'sync-managed-channel-plugin-mirrors',
      label: 'syncManagedChannelPluginMirrors',
      run: async () => {
        const configuredChannels = await withTimeout(
          listConfiguredChannels({ includeCli: false }),
          1500,
          'listConfiguredChannelsForManagedPluginSync',
          [],
        );
        const synchronizedPluginIds = syncManagedChannelPluginMirrors(configuredChannels);
        if (synchronizedPluginIds.length > 0) {
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
        await withTimeout(
          syncAllProvidersToRuntime(),
          4000,
          'syncAllProvidersToRuntimeBeforeLaunch',
          undefined,
        );
      },
    },
    {
      id: 'sync-provider-auth',
      label: 'syncAllProviderAuthToRuntimeBeforeLaunch',
      run: async () => {
        await withTimeout(
          syncAllProviderAuthToRuntime(),
          4000,
          'syncAllProviderAuthToRuntimeBeforeLaunch',
          undefined,
        );
      },
    },
  ];

  const result = await runGatewayStartupPreflight({
    steps,
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
    syncGatewayTokenToConfig(appSettings.gatewayToken),
    2000,
    'syncGatewayTokenToConfig',
    undefined,
  ).catch((err) => {
    logger.warn('Failed to sync gateway token to openclaw.json:', err);
  });

  void withTimeout(syncBrowserConfigToOpenClaw(), 2000, 'syncBrowserConfigToOpenClaw', undefined).catch((err) => {
    logger.warn('Failed to sync browser config to openclaw.json:', err);
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
  // In portable mode, set OPENCLAW_HOME so the gateway stores all config/data
  // inside the USB's portable directory instead of ~/.openclaw on the host.
  const openclawHome = getOpenClawConfigDir();
  const forkEnv: Record<string, string | undefined> = {
    ...baseEnv,
    PATH: finalPath,
    ...providerEnv,
    ...uvEnv,
    ...proxyEnv,
    OPENCLAW_HOME: openclawHome,
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
