/**
 * Proxy helpers shared by the Electron main process and Gateway launcher.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ProxySettings {
  proxyMode?: 'system' | 'custom' | 'direct';
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;
}

export interface ResolvedProxySettings {
  httpProxy: string;
  httpsProxy: string;
  allProxy: string;
  bypassRules: string;
}

export interface ElectronProxyConfig {
  mode: 'direct' | 'fixed_servers' | 'system';
  proxyRules?: string;
  proxyBypassRules?: string;
}

const BLANK_PROXY_ENV = {
  HTTP_PROXY: '',
  HTTPS_PROXY: '',
  ALL_PROXY: '',
  http_proxy: '',
  https_proxy: '',
  all_proxy: '',
  NO_PROXY: '',
  no_proxy: '',
};

const LOCAL_PROXY_BYPASS_RULES = ['<local>', 'localhost', '127.0.0.1', '::1'] as const;

function trimValue(value: string | undefined | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function splitBypassRules(value: string | undefined | null): string[] {
  return trimValue(value)
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function mergeProxyBypassRules(
  current: string | undefined | null,
  extras: Iterable<string>,
): string {
  const merged = new Set<string>();
  for (const entry of splitBypassRules(current)) {
    merged.add(entry);
  }
  for (const extra of extras) {
    const value = trimValue(extra);
    if (value) {
      merged.add(value);
    }
  }
  return Array.from(merged).join(',');
}

/**
 * Accept bare host:port values from users and normalize them to a valid URL.
 * Electron accepts scheme-less proxy rules in some cases, but child-process
 * env vars are more reliable when they are full URLs.
 */
export function normalizeProxyServer(proxyServer: string): string {
  const value = trimValue(proxyServer);
  if (!value) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  return `http://${value}`;
}

export function resolveProxySettings(settings: ProxySettings): ResolvedProxySettings {
  const legacyProxy = normalizeProxyServer(settings.proxyServer);
  const allProxy = normalizeProxyServer(settings.proxyAllServer);
  const httpProxy = normalizeProxyServer(settings.proxyHttpServer) || legacyProxy || allProxy;
  const httpsProxy = normalizeProxyServer(settings.proxyHttpsServer) || legacyProxy || allProxy;

  return {
    httpProxy,
    httpsProxy,
    allProxy: allProxy || legacyProxy,
    bypassRules: trimValue(settings.proxyBypassRules),
  };
}

function parseScutilProxyOutput(output: string): ResolvedProxySettings {
  const lines = output.split(/\r?\n/);
  const values = new Map<string, string>();
  const exceptions: string[] = [];
  let inExceptions = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('ExceptionsList')) {
      inExceptions = true;
      continue;
    }

    if (inExceptions) {
      if (line === '}') {
        inExceptions = false;
        continue;
      }
      const match = line.match(/^\d+\s*:\s*(.+)$/);
      if (match?.[1]) {
        exceptions.push(match[1].trim());
      }
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.+)$/);
    if (match?.[1]) {
      values.set(match[1], match[2].trim());
    }
  }

  const httpEnabled = values.get('HTTPEnable') === '1';
  const httpsEnabled = values.get('HTTPSEnable') === '1';
  const socksEnabled = values.get('SOCKSEnable') === '1';

  const httpProxy =
    httpEnabled && values.get('HTTPProxy') && values.get('HTTPPort')
      ? normalizeProxyServer(`${values.get('HTTPProxy')}:${values.get('HTTPPort')}`)
      : '';
  const httpsProxy =
    httpsEnabled && values.get('HTTPSProxy') && values.get('HTTPSPort')
      ? normalizeProxyServer(`${values.get('HTTPSProxy')}:${values.get('HTTPSPort')}`)
      : '';
  const allProxy =
    socksEnabled && values.get('SOCKSProxy') && values.get('SOCKSPort')
      ? `socks5://${values.get('SOCKSProxy')}:${values.get('SOCKSPort')}`
      : httpsProxy || httpProxy;

  return {
    httpProxy,
    httpsProxy,
    allProxy,
    bypassRules: exceptions.join(','),
  };
}

function parseWindowsRegistryQuery(output: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('HKEY_')) {
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_]+)\s+REG_\w+\s+(.+)$/);
    if (match?.[1] && match[2]) {
      values.set(match[1], match[2].trim());
    }
  }

  return values;
}

function parseWindowsProxyServerValue(proxyServer: string): Pick<ResolvedProxySettings, 'httpProxy' | 'httpsProxy' | 'allProxy'> {
  const value = trimValue(proxyServer);
  if (!value) {
    return {
      httpProxy: '',
      httpsProxy: '',
      allProxy: '',
    };
  }

  // Windows can store a single endpoint ("host:port") or protocol-scoped
  // mappings like "http=host:port;https=host:port;socks=host:port".
  if (!value.includes('=')) {
    const normalized = normalizeProxyServer(value);
    return {
      httpProxy: normalized,
      httpsProxy: normalized,
      allProxy: normalized,
    };
  }

  const entries = new Map<string, string>();
  for (const part of value.split(';')) {
    const [rawKey, ...rest] = part.split('=');
    const key = rawKey?.trim().toLowerCase();
    const target = rest.join('=').trim();
    if (key && target) {
      entries.set(key, target);
    }
  }

  const httpProxy = normalizeProxyServer(entries.get('http') || '');
  const httpsProxy = normalizeProxyServer(entries.get('https') || entries.get('http') || '');
  const socksProxy = trimValue(entries.get('socks'));
  const allProxy = socksProxy
    ? (/^[a-z][a-z0-9+.-]*:\/\//i.test(socksProxy) ? socksProxy : `socks5://${socksProxy}`)
    : (normalizeProxyServer(entries.get('all') || '') || httpsProxy || httpProxy);

  return {
    httpProxy,
    httpsProxy,
    allProxy,
  };
}

function resolveProxyFromEnv(): ResolvedProxySettings {
  const httpProxy = normalizeProxyServer(process.env.HTTP_PROXY || process.env.http_proxy || '');
  const httpsProxy = normalizeProxyServer(process.env.HTTPS_PROXY || process.env.https_proxy || '');
  const allProxy = trimValue(process.env.ALL_PROXY || process.env.all_proxy || '')
    || httpsProxy
    || httpProxy;
  const noProxy = trimValue(process.env.NO_PROXY || process.env.no_proxy || '');

  return {
    httpProxy,
    httpsProxy,
    allProxy,
    bypassRules: noProxy,
  };
}

async function resolveSystemProxySettings(): Promise<ResolvedProxySettings> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      ]);
      const values = parseWindowsRegistryQuery(stdout);
      const proxyEnabledRaw = values.get('ProxyEnable');
      const proxyEnabled = proxyEnabledRaw === '0x1' || proxyEnabledRaw === '1';
      if (proxyEnabled) {
        const parsed = parseWindowsProxyServerValue(values.get('ProxyServer') || '');
        if (parsed.httpProxy || parsed.httpsProxy || parsed.allProxy) {
          return {
            ...parsed,
            bypassRules: trimValue(values.get('ProxyOverride') || ''),
          };
        }
      }
    } catch {
      // Fall through to env fallback below.
    }
  } else if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('scutil', ['--proxy']);
      const parsed = parseScutilProxyOutput(stdout);
      if (parsed.httpProxy || parsed.httpsProxy || parsed.allProxy) {
        return parsed;
      }
    } catch {
      // Fall through to env fallback below.
    }
  }

  const envProxy = resolveProxyFromEnv();
  if (envProxy.httpProxy || envProxy.httpsProxy || envProxy.allProxy) {
    return envProxy;
  }

  return {
    httpProxy: '',
    httpsProxy: '',
    allProxy: '',
    bypassRules: '',
  };
}

export async function resolveProxySettingsAsync(settings: ProxySettings): Promise<ResolvedProxySettings> {
  const mode = settings.proxyMode || (settings.proxyEnabled ? 'custom' : 'system');
  if (mode === 'direct') {
    return {
      httpProxy: '',
      httpsProxy: '',
      allProxy: '',
      bypassRules: '',
    };
  }
  if (mode === 'system') {
    return resolveSystemProxySettings();
  }
  return resolveProxySettings(settings);
}

export function buildElectronProxyConfig(settings: ProxySettings): ElectronProxyConfig {
  const mode = settings.proxyMode || (settings.proxyEnabled ? 'custom' : 'system');

  if (mode === 'system') {
    return { mode: 'system' };
  }
  if (mode === 'direct') {
    return { mode: 'direct' };
  }

  const resolved = resolveProxySettings(settings);
  const rules: string[] = [];

  if (resolved.httpProxy) {
    rules.push(`http=${resolved.httpProxy}`);
  }
  if (resolved.httpsProxy) {
    rules.push(`https=${resolved.httpsProxy}`);
  }

  // Fallback rule for protocols like ws/wss or when users only configured ALL_PROXY.
  const fallbackProxy = resolved.allProxy || resolved.httpsProxy || resolved.httpProxy;
  if (fallbackProxy) {
    rules.push(fallbackProxy);
  }

  if (rules.length === 0) {
    return { mode: 'system' };
  }

  return {
    mode: 'fixed_servers',
    proxyRules: rules.join(';'),
    proxyBypassRules: mergeProxyBypassRules(resolved.bypassRules, LOCAL_PROXY_BYPASS_RULES),
  };
}

export function buildProxyEnv(settings: ProxySettings): Record<string, string> {
  if (!settings.proxyEnabled) {
    return BLANK_PROXY_ENV;
  }

  const resolved = resolveProxySettings(settings);
  const noProxy = mergeProxyBypassRules(resolved.bypassRules, LOCAL_PROXY_BYPASS_RULES);

  return {
    HTTP_PROXY: resolved.httpProxy,
    HTTPS_PROXY: resolved.httpsProxy,
    ALL_PROXY: resolved.allProxy,
    http_proxy: resolved.httpProxy,
    https_proxy: resolved.httpsProxy,
    all_proxy: resolved.allProxy,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  };
}

export async function buildProxyEnvAsync(settings: ProxySettings): Promise<Record<string, string>> {
  const mode = settings.proxyMode || (settings.proxyEnabled ? 'custom' : 'system');
  if (mode === 'direct') {
    return BLANK_PROXY_ENV;
  }

  const resolved = await resolveProxySettingsAsync(settings);
  const noProxy = mergeProxyBypassRules(resolved.bypassRules, LOCAL_PROXY_BYPASS_RULES);

  if (!resolved.httpProxy && !resolved.httpsProxy && !resolved.allProxy) {
    return {
      ...BLANK_PROXY_ENV,
      NO_PROXY: noProxy,
      no_proxy: noProxy,
    };
  }

  return {
    HTTP_PROXY: resolved.httpProxy,
    HTTPS_PROXY: resolved.httpsProxy,
    ALL_PROXY: resolved.allProxy,
    http_proxy: resolved.httpProxy,
    https_proxy: resolved.httpsProxy,
    all_proxy: resolved.allProxy,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  };
}
