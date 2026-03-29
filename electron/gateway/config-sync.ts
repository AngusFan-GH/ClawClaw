import { app } from 'electron';
import path from 'path';
import { existsSync } from 'fs';
import { getAllSettings } from '../utils/store';
import { getApiKey, getDefaultProvider, getProvider } from '../utils/secure-storage';
import { getProviderEnvVar, getKeyableProviderTypes } from '../utils/provider-registry';
import { getOpenClawDir, getOpenClawEntryPath, isOpenClawPresent } from '../utils/paths';
import { validateBundledOpenClawRuntime } from '../utils/openclaw-runtime-integrity';
import { getUvMirrorEnv } from '../utils/uv-env';
import {
  cleanupInvalidManagedChannelPlugins,
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
import { runGatewayStartupPreflight, type GatewayStartupPreflightStep } from './startup-preflight';
import type { GatewayConfigRecovery } from '../../src/types/gateway';

const CHANNEL_PLUGIN_INSTALL_MAP: Partial<Record<string, { pluginId: string; displayName: string }>> = {
  feishu: { pluginId: 'feishu', displayName: 'Feishu / Lark' },
  dingtalk: { pluginId: 'channels', displayName: 'China Channels' },
  qqbot: { pluginId: 'channels', displayName: 'China Channels' },
  wecom: { pluginId: 'channels', displayName: 'China Channels' },
  wechat: { pluginId: 'openclaw-weixin', displayName: 'WeChat' },
};

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

function ensureConfiguredPluginsInstalled(configuredChannels: string[]): string[] {
  const installedPluginIds = new Set<string>();
  for (const channelType of configuredChannels) {
    const plugin = CHANNEL_PLUGIN_INSTALL_MAP[channelType];
    if (!plugin) continue;
    const result = ensureBundledPluginInstalled(plugin.pluginId, plugin.displayName);
    if (result.installed) {
      installedPluginIds.add(plugin.pluginId);
    }
    if (!result.installed && result.warning) {
      logger.warn(result.warning);
    }
  }
  return Array.from(installedPluginIds);
}

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
          logger.warn(`${label} timed out after ${timeoutMs}ms; continuing with fallback`);
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
      id: 'cleanup-invalid-managed-channel-plugins',
      label: 'cleanupInvalidManagedChannelPlugins',
      run: async () => {
        const result = await withTimeout(
          cleanupInvalidManagedChannelPlugins(),
          3000,
          'cleanupInvalidManagedChannelPlugins',
          { cleaned: false, removedPluginIds: [] },
        );
        if (result.cleaned) {
          recoveryTopics.push('plugins');
        }
      },
    },
    {
      id: 'ensure-configured-channel-plugins',
      label: 'ensureConfiguredPluginsInstalled',
      run: async () => {
        const configuredChannels = await withTimeout(
          listConfiguredChannels({ includeCli: false }),
          1500,
          'listConfiguredChannelsForPluginInstall',
          [],
        );
        const installedPluginIds = ensureConfiguredPluginsInstalled(configuredChannels);
        if (installedPluginIds.length > 0) {
          recoveryTopics.push('plugins');
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
          syncDefaultProviderToRuntime(defaultProviderId),
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
  const forkEnv: Record<string, string | undefined> = {
    ...baseEnv,
    PATH: finalPath,
    ...providerEnv,
    ...uvEnv,
    ...proxyEnv,
    OPENCLAW_GATEWAY_TOKEN: appSettings.gatewayToken,
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
