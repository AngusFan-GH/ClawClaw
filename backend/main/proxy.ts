import { buildProxyEnvAsync } from '../utils/proxy';
import { getAllSettings, type AppSettings } from '../utils/store';
import { configureProxyFetch } from '../utils/proxy-fetch';
export async function applyProxySettings(settings?: Pick<AppSettings, 'proxyMode' | 'proxyEnabled' | 'proxyServer' | 'proxyHttpServer' | 'proxyHttpsServer' | 'proxyAllServer' | 'proxyBypassRules'>): Promise<void> {
  configureProxyFetch(await buildProxyEnvAsync(settings ?? await getAllSettings()));
}
