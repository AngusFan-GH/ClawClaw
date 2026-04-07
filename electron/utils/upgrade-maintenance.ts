import { app } from 'electron';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { getOpenClawDir } from './paths';
import { logger } from './logger';
import { ensureProviderStoreMigrated } from '../services/providers/provider-migration';
import { runOpenClawStartupPreflightRepair } from '../gateway/config-sync';
import { runOpenClawDoctorRepair } from '../gateway/supervisor';

interface UpgradeState {
  lastAppVersion?: string;
  lastOpenClawVersion?: string;
}

let upgradeStoreInstance: {
  get: (key?: string) => unknown;
  set: (key: string, value: unknown) => void;
} | null = null;

async function getUpgradeStore() {
  if (!upgradeStoreInstance) {
    const Store = (await import('electron-store')).default;
    upgradeStoreInstance = new Store<UpgradeState>({
      name: 'upgrade-state',
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

export interface UpgradeMaintenanceResult {
  triggered: boolean;
  currentAppVersion: string;
  previousAppVersion: string | null;
  currentOpenClawVersion: string | null;
  previousOpenClawVersion: string | null;
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
    };
  }

  logger.info(
    `Running upgrade maintenance (app ${previousAppVersion ?? 'none'} -> ${currentAppVersion}, openclaw ${previousOpenClawVersion ?? 'none'} -> ${currentOpenClawVersion ?? 'unknown'})`,
  );

  await ensureProviderStoreMigrated();
  await runOpenClawStartupPreflightRepair();
  if (openClawUpgraded) {
    const doctorOk = await runOpenClawDoctorRepair();
    if (!doctorOk) {
      logger.warn('OpenClaw doctor --fix did not complete successfully during upgrade maintenance');
    }
  }

  store.set('lastAppVersion', currentAppVersion);
  if (currentOpenClawVersion) {
    store.set('lastOpenClawVersion', currentOpenClawVersion);
  }

  return {
    triggered: true,
    currentAppVersion,
    previousAppVersion,
    currentOpenClawVersion,
    previousOpenClawVersion,
  };
}
