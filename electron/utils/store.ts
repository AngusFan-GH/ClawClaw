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
import { writeOpenClawConfigRecord } from './openclaw-config';
import { getDataDir } from './paths';

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
  updateChannel: 'stable';
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;
  skippedVersions: string[];

  // UI State
  sidebarCollapsed: boolean;
  devModeUnlocked: boolean;
  slashCommandHintsEnabled: boolean;
  setupComplete: boolean;

  // Presets
  selectedBundles: string[];
  enabledSkills: string[];
  disabledSkills: string[];

  // Security
  securityPolicy: SecurityPolicy;
  securityPolicyAppliedAt: number;
  reminders: ReminderItem[];

  // Memory
  sessionMemoryEnabled: boolean;
  memorySearchEnabled: boolean;
  dreamingEnabled: boolean;
  localModelLean: boolean;

  // Startup optimization: hash of provider config state at last successful sync.
  // If unchanged since last sync, expensive runtime sync steps are skipped.
  providerSyncHash: string;
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
  slashCommandHintsEnabled: false,
  setupComplete: false,

  // Presets
  selectedBundles: ['productivity', 'developer'],
  enabledSkills: [],
  disabledSkills: [],

  // Security
  securityPolicy: DEFAULT_SECURITY_POLICY,
  securityPolicyAppliedAt: 0,
  reminders: [],

  // Memory
  sessionMemoryEnabled: true,
  memorySearchEnabled: true,
  dreamingEnabled: false,
  localModelLean: false,

  // Startup optimization
  providerSyncHash: '',
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
      cwd: getDataDir(),
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
    securityPolicyAppliedAt: typeof (settings as Partial<AppSettings>).securityPolicyAppliedAt === 'number'
      ? (settings as Partial<AppSettings>).securityPolicyAppliedAt
      : 0,
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
  const rawStore =
    store.store && typeof store.store === 'object'
      ? store.store
      : ((store.get() ?? {}) as Partial<AppSettings>);
  return normalizeSettings(rawStore)[key];
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
  const rawStore =
    store.store && typeof store.store === 'object'
      ? store.store
      : ((store.get() ?? {}) as Partial<AppSettings>);
  return normalizeSettings(rawStore);
}

/**
 * Get the provider config sync hash (used to skip redundant runtime syncs).
 */
export async function getProviderSyncHash(): Promise<string> {
  return (await getSetting('providerSyncHash')) ?? '';
}

/**
 * Persist the provider config sync hash after a successful sync.
 */
export async function setProviderSyncHash(hash: string): Promise<void> {
  await setSetting('providerSyncHash', hash);
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

// ── Backup/Restore ──────────────────────────────────────────────────────────────

import { app } from 'electron';
import { join } from 'path';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { getDefaultExportDir, getOpenClawConfigDir } from './paths';
import { logger } from './logger';

export interface BackupMetadata {
  appVersion: string;
  platform: string;
  exportedAt: string;
  backupId: string;
}

export interface ProviderBackupMeta {
  providerId: string;
  name: string;
  type: string;
  baseUrl?: string;
  model?: string;
  fallbackModels?: string[];
  fallbackProviderIds?: string[];
  enabled: boolean;
  hasApiKey: boolean;
}

export interface BackupPayload {
  version: 1;
  metadata: BackupMetadata;
  settings: Record<string, unknown>;
  openclawConfig: Record<string, unknown>;
  providerMeta: ProviderBackupMeta[];
}

export interface ApplyBackupResult {
  success: boolean;
  importedSettings: boolean;
  importedOpenClawConfig: boolean;
  importedProviders: number;
  warnings: string[];
  error?: string;
}

function generateBackupId(): string {
  return `backup-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

async function readOpenClawConfig(): Promise<Record<string, unknown>> {
  try {
    const configPath = join(getOpenClawConfigDir(), 'openclaw.json');
    const raw = await readFile(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Build a complete backup payload: ClawClaw settings + OpenClaw config + provider metadata.
 */
export async function buildBackupPayload(): Promise<BackupPayload> {
  const exportedAt = new Date().toISOString();

  const [rawSettings, openclawConfig] = await Promise.all([
    exportSettings(),
    readOpenClawConfig(),
  ]);

  const settings = JSON.parse(rawSettings) as Record<string, unknown>;

  return {
    version: 1,
    metadata: {
      appVersion: app.getVersion(),
      platform: process.platform,
      exportedAt,
      backupId: generateBackupId(),
    },
    settings,
    openclawConfig,
    providerMeta: [], // Provider meta will be populated by the caller if available
  };
}

/**
 * Apply a backup payload to the local settings store and OpenClaw config.
 * Only writes known settings keys to avoid schema drift.
 */
export async function applyBackupPayload(
  payload: BackupPayload,
  options: { skipApiKeyWarning?: boolean } = {},
): Promise<ApplyBackupResult> {
  const warnings: string[] = [];
  let importedSettings = false;
  let importedOpenClawConfig = false;
  let importedProviders = 0;

  // Validate payload
  if (
    !payload?.version ||
    payload.version !== 1 ||
    !payload?.metadata ||
    !payload?.settings ||
    !payload?.openclawConfig
  ) {
    return {
      success: false,
      importedSettings: false,
      importedOpenClawConfig: false,
      importedProviders: 0,
      warnings,
      error: 'Invalid or incompatible backup file format',
    };
  }

  const meta = payload.metadata;
  if (!meta.appVersion || !meta.backupId) {
    return {
      success: false,
      importedSettings: false,
      importedOpenClawConfig: false,
      importedProviders: 0,
      warnings,
      error: 'Backup file is missing required metadata',
    };
  }

  // Warn about API keys (we don't back them up)
  if (payload.providerMeta?.some((p) => p.hasApiKey)) {
    if (!options.skipApiKeyWarning) {
      return {
        success: false,
        importedSettings,
        importedOpenClawConfig,
        importedProviders,
        warnings,
        error:
          'Some providers in this backup have API keys. API keys are stored in your system keychain and are not exported. Provider keys will need to be re-entered after restore.',
      };
    }
    warnings.push('Some providers have API keys stored in the system keychain — these were not overwritten by the backup.');
  }

  // 1. Apply ClawClaw settings — only known keys
  try {
    const store = await getSettingsStore();
    const knownKeys = Object.keys(store.store);
    const filtered = Object.fromEntries(
      Object.entries(payload.settings as Record<string, unknown>).filter(([k]) =>
        knownKeys.includes(k),
      ),
    );
    store.set(filtered);
    importedSettings = true;
  } catch (err) {
    warnings.push(`Settings import warning: ${String(err)}`);
  }

  // 2. Apply OpenClaw config
  try {
    await writeOpenClawConfigRecord(payload.openclawConfig);
    importedOpenClawConfig = true;
  } catch (err) {
    warnings.push(`OpenClaw config import warning: ${String(err)}`);
  }

  // 3. Provider meta — log but don't auto-recreate providers (they need API keys)
  if (payload.providerMeta?.length) {
    warnings.push(
      `${payload.providerMeta.length} provider(s) recorded in backup — re-add them in Settings → AI Providers`,
    );
    importedProviders = payload.providerMeta.length;
  }

  return {
    success: true,
    importedSettings,
    importedOpenClawConfig,
    importedProviders,
    warnings,
  };
}

/**
 * Create an automatic backup before a destructive operation (reset, import).
 * Writes to exports/settings/auto-backups/auto-{reason}-{timestamp}.json
 */
export async function createAutoBackup(reason: string): Promise<string | null> {
  try {
    const payload = await buildBackupPayload();
    const autoBackupDir = join(getDefaultExportDir('settings'), 'auto-backups');
    await mkdir(autoBackupDir, { recursive: true });
    const fileName = `auto-${reason}-${Date.now()}.json`;
    const filePath = join(autoBackupDir, fileName);
    await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    logger.info(`Auto-backup created: ${filePath} (reason: ${reason})`);
    return filePath;
  } catch (err) {
    logger.warn(`Auto-backup failed: ${err}`);
    return null;
  }
}
