import { app } from '../host/desktop';
import { readFile } from 'node:fs/promises';
import { join } from 'path';
import { getDataDir, getOpenClawDir } from './paths';
import { logger } from './logger';
import { ensureProviderStoreMigrated } from '../services/providers/provider-migration';
import {
  cleanupCorruptedNpmPlugins,
  getLastStartupPreflightRecovery,
  runOpenClawStartupPreflightRepair,
} from '../gateway/config-sync';
import {
  cleanupDanglingWeChatPluginState,
  cleanupLegacyChannelPlugins,
} from './channel-config';
import {
  cleanupOrphanLocalModelRuntimeAccounts,
  migrateLegacyLocalModelAccounts,
} from '../services/providers/local-model-presets';
import {
  OPENCLAW_DOCTOR_FIX_TIMEOUT_MS,
  runOpenClawDoctorFix,
  type OpenClawDoctorStatus,
} from './openclaw-doctor';

interface UpgradeState {
  lastAppVersion?: string;
  lastOpenClawVersion?: string;
  lastMaintenanceAt?: string;
  lastLegacyUpgradeAt?: string;
  lastLegacyUpgradeFromVersion?: string;
  lastPreflightAt?: string;
  lastPreflightAppVersion?: string;
  lastPreflightOpenClawVersion?: string;
  lastPreflightRecoveredTopics?: string[];
  lastDoctorFixAt?: string;
  lastDoctorFixOpenClawVersion?: string;
  lastDoctorFixStatus?: OpenClawDoctorStatus;
  lastDoctorFixWarningCount?: number;
}

let upgradeStoreInstance: {
  get: (key?: string) => unknown;
  set: (key: string, value: unknown) => void;
} | null = null;

async function getUpgradeStore() {
  if (!upgradeStoreInstance) {
    const Store = (await import('../host/json-store')).default;
    upgradeStoreInstance = new Store<UpgradeState>({
      name: 'upgrade-state',
      cwd: getDataDir(),
      defaults: {},
    });
  }
  return upgradeStoreInstance;
}

async function getBundledOpenClawVersion(): Promise<string | null> {
  try {
    const pkgPath = join(getOpenClawDir(), 'package.json');
    const raw = await readFile(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version.trim()
      ? parsed.version.trim()
      : null;
  } catch (error) {
    logger.warn('Failed to read bundled OpenClaw version for upgrade maintenance:', error);
    return null;
  }
}

function hasUpgrade(previous: string | null, current: string | null): boolean {
  if (!current) return false;
  if (!previous) return true;
  return previous !== current;
}

function parseVersionParts(version: string): [number, number, number] | null {
  const normalized = version.trim().replace(/^v/i, '');
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isLegacyInstallUpgradeVersion(version: string | null | undefined): boolean {
  if (!version) return false;
  const parsed = parseVersionParts(version);
  if (!parsed) return false;
  const [major, minor, patch] = parsed;
  if (major !== 0) {
    return false;
  }
  if (minor !== 1) {
    return minor < 1;
  }
  return patch <= 15;
}

async function runLegacyInstallUpgradeCleanup(previousAppVersion: string | null): Promise<void> {
  logger.info(
    `Running legacy install upgrade cleanup for app ${previousAppVersion ?? 'unknown'} -> ${app.getVersion()}`,
  );

  await ensureProviderStoreMigrated();
  await migrateLegacyLocalModelAccounts();

  const [wechatCleanup, channelCleanup, orphanRuntimeCleanup] = await Promise.all([
    cleanupDanglingWeChatPluginState(),
    cleanupLegacyChannelPlugins(),
    cleanupOrphanLocalModelRuntimeAccounts(),
  ]);

  logger.info(
    `Legacy install upgrade cleanup completed (wechat=${wechatCleanup.cleanedDanglingState}, legacyChannels=${channelCleanup.cleaned}, orphanLocalModelAccounts=${orphanRuntimeCleanup.removedAccountIds.length})`,
  );
}

export interface UpgradeMaintenanceResult {
  triggered: boolean;
  currentAppVersion: string;
  previousAppVersion: string | null;
  currentOpenClawVersion: string | null;
  previousOpenClawVersion: string | null;
  legacyUpgradeRan: boolean;
  preflightRan: boolean;
  preflightRecoveredTopics: string[];
  doctorFixRan: boolean;
  doctorFixStatus: OpenClawDoctorStatus | null;
  doctorFixWarningCount: number;
}

export async function performUpgradeMaintenanceIfNeeded(): Promise<UpgradeMaintenanceResult> {
  const store = await getUpgradeStore();
  const currentAppVersion = app.getVersion();
  const currentOpenClawVersion = await getBundledOpenClawVersion();
  const previousAppVersion = (store.get('lastAppVersion') as string | undefined) ?? null;
  const previousOpenClawVersion = (store.get('lastOpenClawVersion') as string | undefined) ?? null;

  const appUpgraded = hasUpgrade(previousAppVersion, currentAppVersion);
  const openClawUpgraded = hasUpgrade(previousOpenClawVersion, currentOpenClawVersion);
  if (!appUpgraded && !openClawUpgraded) {
    return {
      triggered: false,
      currentAppVersion,
      previousAppVersion,
      currentOpenClawVersion,
      previousOpenClawVersion,
      legacyUpgradeRan: false,
      preflightRan: false,
      preflightRecoveredTopics: [],
      doctorFixRan: false,
      doctorFixStatus: null,
      doctorFixWarningCount: 0,
    };
  }

  logger.info(
    `Running upgrade maintenance (app ${previousAppVersion ?? 'none'} -> ${currentAppVersion}, openclaw ${previousOpenClawVersion ?? 'none'} -> ${currentOpenClawVersion ?? 'unknown'})`,
  );

  await ensureProviderStoreMigrated();
  const legacyUpgradeRan = isLegacyInstallUpgradeVersion(previousAppVersion);
  if (legacyUpgradeRan) {
    await runLegacyInstallUpgradeCleanup(previousAppVersion);
  }
  await runOpenClawStartupPreflightRepair();
  const preflightRecoveredTopics = getLastStartupPreflightRecovery()?.topics ?? [];
  const maintenanceAt = new Date().toISOString();
  if (legacyUpgradeRan) {
    store.set('lastLegacyUpgradeAt', maintenanceAt);
    if (previousAppVersion) {
      store.set('lastLegacyUpgradeFromVersion', previousAppVersion);
    }
  }
  store.set('lastPreflightAt', maintenanceAt);
  store.set('lastPreflightAppVersion', currentAppVersion);
  if (currentOpenClawVersion) {
    store.set('lastPreflightOpenClawVersion', currentOpenClawVersion);
  }
  store.set('lastPreflightRecoveredTopics', preflightRecoveredTopics);

  let doctorFixRan = false;
  let doctorFixStatus: OpenClawDoctorStatus | null = null;
  let doctorFixWarningCount = 0;
  if (openClawUpgraded || legacyUpgradeRan) {
    doctorFixRan = true;
    const doctorResult = await runOpenClawDoctorFix({
      timeoutMs: OPENCLAW_DOCTOR_FIX_TIMEOUT_MS,
    });
    doctorFixStatus = doctorResult.status;
    doctorFixWarningCount = doctorResult.warnings.length;
    store.set('lastDoctorFixAt', new Date().toISOString());
    if (currentOpenClawVersion) {
      store.set('lastDoctorFixOpenClawVersion', currentOpenClawVersion);
    }
    store.set('lastDoctorFixStatus', doctorResult.status);
    store.set('lastDoctorFixWarningCount', doctorResult.warnings.length);

    if (!doctorResult.success) {
      logger.warn('OpenClaw doctor --fix did not complete successfully during upgrade maintenance');
    } else if (doctorResult.status === 'success_with_warnings') {
      logger.warn(
        `OpenClaw doctor --fix completed with ${doctorResult.warnings.length} warning(s) during upgrade maintenance`,
      );
    }

    // openclaw doctor --fix can auto-install channel plugins into
    // ~/.openclaw/npm/node_modules/@openclaw/<name> at npm "latest", which may
    // be newer than our pinned `openclaw` runtime and break with plugin-sdk
    // import mismatches. We bundle our own version-pinned mirrors into
    // ~/.openclaw/extensions/, so the npm-mode copies are always redundant —
    // purge them right after doctor runs.
    try {
      const purgeResult = cleanupCorruptedNpmPlugins();
      if (purgeResult.cleaned) {
        logger.warn(
          `Removed npm-mode plugin copies installed by openclaw doctor: ${purgeResult.removedPlugins.join(', ')}`,
        );
      }
    } catch (err) {
      logger.warn('Failed to clean up npm-mode plugin copies after doctor --fix:', err);
    }
  }

  store.set('lastAppVersion', currentAppVersion);
  if (currentOpenClawVersion) {
    store.set('lastOpenClawVersion', currentOpenClawVersion);
  }
  store.set('lastMaintenanceAt', maintenanceAt);

  return {
    triggered: true,
    currentAppVersion,
    previousAppVersion,
    currentOpenClawVersion,
    previousOpenClawVersion,
    legacyUpgradeRan,
    preflightRan: true,
    preflightRecoveredTopics,
    doctorFixRan,
    doctorFixStatus,
    doctorFixWarningCount,
  };
}
