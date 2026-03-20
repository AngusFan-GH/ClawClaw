/**
 * Persistent Storage
 * Electron-store wrapper for application settings
 */

import { randomBytes } from 'crypto';
import {
  type SecurityPolicy,
  DEFAULT_SECURITY_POLICY,
  normalizeSecurityPolicy,
} from '../shared/security-policy';
import type { ReminderItem } from '../shared/reminders';
import { normalizeReminders } from '../shared/reminders';

// Lazy-load electron-store (ESM module)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let settingsStoreInstance: any = null;

/**
 * Generate a random token for gateway authentication
 */
function generateToken(): string {
  return `clawclaw-${randomBytes(16).toString('hex')}`;
}

/**
 * Application settings schema
 */
export interface AppSettings {
  // General
  theme: 'light' | 'dark' | 'system';
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;

  // Gateway
  gatewayAutoStart: boolean;
  gatewayPort: number;
  gatewayToken: string;
  proxyMode: 'system' | 'custom' | 'direct';
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;

  // Update
  updateChannel: 'stable' | 'beta' | 'dev';
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;
  skippedVersions: string[];

  // UI State
  sidebarCollapsed: boolean;
  devModeUnlocked: boolean;
  setupComplete: boolean;

  // Presets
  selectedBundles: string[];
  enabledSkills: string[];
  disabledSkills: string[];

  // Security
  securityPolicy: SecurityPolicy;
  reminders: ReminderItem[];

  // Memory
  sessionMemoryEnabled: boolean;
  memorySearchEnabled: boolean;
}

/**
 * Default settings
 */
const defaults: AppSettings = {
  // General
  theme: 'system',
  language: 'zh',
  startMinimized: false,
  launchAtStartup: false,

  // Gateway
  gatewayAutoStart: true,
  gatewayPort: 18789,
  gatewayToken: generateToken(),
  proxyMode: 'system',
  proxyEnabled: false,
  proxyServer: '',
  proxyHttpServer: '',
  proxyHttpsServer: '',
  proxyAllServer: '',
  proxyBypassRules: '<local>;localhost;127.0.0.1;::1',

  // Update
  updateChannel: 'stable',
  autoCheckUpdate: true,
  autoDownloadUpdate: false,
  skippedVersions: [],

  // UI State
  sidebarCollapsed: false,
  devModeUnlocked: false,
  setupComplete: false,

  // Presets
  selectedBundles: ['productivity', 'developer'],
  enabledSkills: [],
  disabledSkills: [],

  // Security
  securityPolicy: DEFAULT_SECURITY_POLICY,
  reminders: [],

  // Memory
  sessionMemoryEnabled: true,
  memorySearchEnabled: true,
};

/**
 * Get the settings store instance (lazy initialization)
 */
async function getSettingsStore() {
  if (!settingsStoreInstance) {
    const Store = (await import('electron-store')).default;
    settingsStoreInstance = new Store<AppSettings>({
      name: 'settings',
      defaults,
    });
  }
  return settingsStoreInstance;
}

function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  const proxyMode =
    settings.proxyMode
    || (settings.proxyEnabled ? 'custom' : 'system');

  return {
    ...defaults,
    ...settings,
    proxyMode,
    proxyEnabled: proxyMode === 'custom',
    securityPolicy: normalizeSecurityPolicy((settings as Partial<AppSettings>).securityPolicy),
    reminders: normalizeReminders((settings as Partial<AppSettings>).reminders),
  };
}

/**
 * Get a setting value
 */
export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const store = await getSettingsStore();
  if (key === 'proxyMode') {
    const rawMode = store.get('proxyMode');
    if (rawMode === 'system' || rawMode === 'custom' || rawMode === 'direct') {
      return rawMode as AppSettings[K];
    }
    const legacyEnabled = Boolean(store.get('proxyEnabled'));
    return (legacyEnabled ? 'custom' : 'system') as AppSettings[K];
  }
  return normalizeSettings(store.store)[key];
}

/**
 * Set a setting value
 */
export async function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  const store = await getSettingsStore();
  store.set(key, value);
}

/**
 * Get all settings
 */
export async function getAllSettings(): Promise<AppSettings> {
  const store = await getSettingsStore();
  return normalizeSettings(store.store);
}

/**
 * Reset settings to defaults
 */
export async function resetSettings(): Promise<void> {
  const store = await getSettingsStore();
  store.clear();
}

/**
 * Export settings to JSON
 */
export async function exportSettings(): Promise<string> {
  const store = await getSettingsStore();
  return JSON.stringify(store.store, null, 2);
}

/**
 * Import settings from JSON
 */
export async function importSettings(json: string): Promise<void> {
  try {
    const settings = JSON.parse(json);
    const store = await getSettingsStore();
    store.set(settings);
  } catch {
    throw new Error('Invalid settings JSON');
  }
}
