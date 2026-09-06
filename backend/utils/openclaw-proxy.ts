import { updateOpenClawConfig } from './channel-config';
import { resolveProxySettingsAsync, type ProxySettings } from './proxy';
import { logger } from './logger';

/**
 * Sync ClawClaw global proxy settings into OpenClaw channel config where the
 * upstream runtime expects an explicit per-channel proxy knob.
 */
export async function syncProxyConfigToOpenClaw(settings: ProxySettings): Promise<void> {
  const resolved = await resolveProxySettingsAsync(settings);
  const proxyMode = settings.proxyMode || (settings.proxyEnabled ? 'custom' : 'system');
  const nextProxy =
    proxyMode === 'direct'
      ? ''
      : resolved.allProxy || resolved.httpsProxy || resolved.httpProxy;
  await updateOpenClawConfig((config) => {
    const telegramConfig = config.channels?.telegram;
    if (!telegramConfig) {
      return false;
    }

    const currentProxy = typeof telegramConfig.proxy === 'string' ? telegramConfig.proxy : '';
    if (!nextProxy && !currentProxy) {
      return false;
    }

    if (!config.channels) {
      config.channels = {};
    }

    config.channels.telegram = {
      ...telegramConfig,
    };

    if (nextProxy) {
      config.channels.telegram.proxy = nextProxy;
    } else {
      delete config.channels.telegram.proxy;
    }

    return true;
  });
  logger.info(`Synced Telegram proxy to OpenClaw config (${nextProxy || 'disabled'})`);
}
