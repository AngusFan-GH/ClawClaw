import { app } from 'electron';
import path from 'path';
import { existsSync } from 'fs';
import { getAllSettings } from '../utils/store';
import { getApiKey, getDefaultProvider, getProvider } from '../utils/secure-storage';
import { getProviderEnvVar, getKeyableProviderTypes } from '../utils/provider-registry';
import { getOpenClawDir, getOpenClawEntryPath, isOpenClawPresent } from '../utils/paths';
import { getUvMirrorEnv } from '../utils/uv-env';
import { listConfiguredChannels } from '../utils/channel-config';
import { syncGatewayTokenToConfig, syncBrowserConfigToOpenClaw, sanitizeOpenClawConfig } from '../utils/openclaw-auth';
import { buildProxyEnvAsync, resolveProxySettingsAsync } from '../utils/proxy';
import { syncProxyConfigToOpenClaw } from '../utils/openclaw-proxy';
import { logger } from '../utils/logger';

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

export async function syncGatewayConfigBeforeLaunch(
  appSettings: Awaited<ReturnType<typeof getAllSettings>>,
): Promise<void> {
  try {
    await withTimeout(sanitizeOpenClawConfig(), 2000, 'sanitizeOpenClawConfig', undefined);
  } catch (err) {
    logger.warn('Failed to sanitize openclaw.json:', err);
  }

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
}> {
  try {
    const configuredChannels = await listConfiguredChannels({ includeCli: false });
    if (configuredChannels.length === 0) {
      return {
        skipChannels: true,
        channelStartupSummary: 'skipped(no configured channels)',
      };
    }

    return {
      skipChannels: false,
      channelStartupSummary: `enabled(${configuredChannels.join(',')})`,
    };
  } catch (error) {
    logger.warn('Failed to determine configured channels for gateway launch:', error);
    return {
      skipChannels: false,
      channelStartupSummary: 'enabled(unknown)',
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
  const { skipChannels, channelStartupSummary } = await withTimeout(
    resolveChannelStartupPolicy(),
    1500,
    'resolveChannelStartupPolicy',
    {
      skipChannels: false,
      channelStartupSummary: 'enabled(timeout-fallback)',
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
  const proxySummary =
    proxyMode === 'direct'
      ? 'direct'
      : hasResolvedProxy
        ? `${proxyMode}: http=${resolvedProxy.httpProxy || '-'}, https=${resolvedProxy.httpsProxy || '-'}, all=${resolvedProxy.allProxy || '-'}`
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
