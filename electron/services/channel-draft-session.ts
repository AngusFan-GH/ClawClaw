import { cp, mkdir, rm, stat } from 'fs/promises';
import { dirname, join } from 'path';
import {
  readOpenClawConfigRecordRaw,
  withConfigLock,
  writeOpenClawConfigRecord,
} from '../utils/openclaw-config';
import { getDataDir, resolveOpenClawDir } from '../utils/paths';
import { logger } from '../utils/logger';

type ChannelDraftSnapshot = {
  hasChannels: boolean;
  channels?: unknown;
  hasPlugins: boolean;
  plugins?: unknown;
  hasBindings: boolean;
  bindings?: unknown;
};

type ChannelDraftState = {
  snapshot: ChannelDraftSnapshot;
  draftConfig: Record<string, unknown>;
  pendingRemovedPaths: string[];
};

type BackedPath = {
  livePath: string;
  backupPath: string;
};

const CHANNEL_DRAFT_BACKUP_ROOT = join(getDataDir(), 'runtime-apply', 'channels-draft');

let activeDraftState: ChannelDraftState | null = null;

function cloneJsonValue<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function getChannelBackedPaths(): BackedPath[] {
  const openclawDir = resolveOpenClawDir();
  const backup = (name: string) => join(CHANNEL_DRAFT_BACKUP_ROOT, name);
  return [
    {
      livePath: join(openclawDir, 'credentials'),
      backupPath: backup('credentials'),
    },
    {
      livePath: join(openclawDir, 'openclaw-weixin'),
      backupPath: backup('openclaw-weixin'),
    },
    {
      livePath: join(openclawDir, 'qqbot'),
      backupPath: backup('qqbot'),
    },
    {
      livePath: join(openclawDir, 'agents', 'default', 'sessions', '.openclaw-weixin-sync'),
      backupPath: backup('wechat-sync-state'),
    },
    {
      livePath: join(openclawDir, 'extensions', 'openclaw-weixin'),
      backupPath: backup('wechat-extension'),
    },
    {
      livePath: join(openclawDir, 'extensions', 'channels'),
      backupPath: backup('legacy-china-plugin'),
    },
  ];
}

async function copyPathIfExists(source: string, target: string): Promise<void> {
  if (!(await pathExists(source))) {
    return;
  }
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true });
}

async function restoreBackedPath(target: BackedPath): Promise<void> {
  await rm(target.livePath, { recursive: true, force: true }).catch(() => undefined);
  if (!(await pathExists(target.backupPath))) {
    return;
  }
  await mkdir(dirname(target.livePath), { recursive: true });
  await cp(target.backupPath, target.livePath, { recursive: true, force: true });
}

export async function beginChannelDraftSession(): Promise<void> {
  if (activeDraftState) {
    return;
  }

  const config = await readOpenClawConfigRecordRaw<Record<string, unknown>>().catch(() => ({}));
  const snapshot: ChannelDraftSnapshot = {
    hasChannels: Object.prototype.hasOwnProperty.call(config, 'channels'),
    channels: cloneJsonValue(config.channels),
    hasPlugins: Object.prototype.hasOwnProperty.call(config, 'plugins'),
    plugins: cloneJsonValue(config.plugins),
    hasBindings: Object.prototype.hasOwnProperty.call(config, 'bindings'),
    bindings: cloneJsonValue(config.bindings),
  };

  await rm(CHANNEL_DRAFT_BACKUP_ROOT, { recursive: true, force: true });
  await mkdir(CHANNEL_DRAFT_BACKUP_ROOT, { recursive: true });
  for (const target of getChannelBackedPaths()) {
    await copyPathIfExists(target.livePath, target.backupPath);
  }

  activeDraftState = { snapshot, draftConfig: cloneJsonValue(config), pendingRemovedPaths: [] };
}

export function getChannelDraftConfigSnapshot<T extends Record<string, unknown>>(): T | null {
  if (!activeDraftState) {
    return null;
  }
  return cloneJsonValue(activeDraftState.draftConfig) as T;
}

export async function updateChannelDraftConfig<T>(
  updater: (config: Record<string, unknown>) => Promise<T> | T,
): Promise<T> {
  if (!activeDraftState) {
    throw new Error('Channel draft session is not active');
  }

  const workingConfig = cloneJsonValue(activeDraftState.draftConfig);
  const result = await updater(workingConfig);
  activeDraftState.draftConfig = workingConfig;
  return result;
}

export async function stageChannelRemovedPaths(paths: Iterable<string>): Promise<void> {
  if (!activeDraftState) {
    return;
  }

  const next = new Set(activeDraftState.pendingRemovedPaths);
  for (const path of paths) {
    if (path) {
      next.add(path);
    }
  }
  activeDraftState.pendingRemovedPaths = [...next];
}

export async function commitChannelDraftSession(): Promise<void> {
  if (!activeDraftState) {
    return;
  }

  await withConfigLock(async () => {
    const currentConfig = await readOpenClawConfigRecordRaw<Record<string, unknown>>().catch(() => ({}));
    const nextConfig = { ...currentConfig };
    const draftConfig = activeDraftState!.draftConfig;

    if (Object.prototype.hasOwnProperty.call(draftConfig, 'channels')) {
      nextConfig.channels = cloneJsonValue(draftConfig.channels);
    } else {
      delete nextConfig.channels;
    }

    if (Object.prototype.hasOwnProperty.call(draftConfig, 'plugins')) {
      nextConfig.plugins = cloneJsonValue(draftConfig.plugins);
    } else {
      delete nextConfig.plugins;
    }

    if (Object.prototype.hasOwnProperty.call(draftConfig, 'bindings')) {
      nextConfig.bindings = cloneJsonValue(draftConfig.bindings);
    } else {
      delete nextConfig.bindings;
    }

    await writeOpenClawConfigRecord(nextConfig);
  });
}

export async function discardChannelDraftSession(): Promise<void> {
  const draft = activeDraftState;
  if (!draft) {
    return;
  }

  await withConfigLock(async () => {
    const config = await readOpenClawConfigRecordRaw<Record<string, unknown>>().catch(() => ({}));
    if (draft.snapshot.hasChannels) {
      config.channels = cloneJsonValue(draft.snapshot.channels);
    } else {
      delete config.channels;
    }
    if (draft.snapshot.hasPlugins) {
      config.plugins = cloneJsonValue(draft.snapshot.plugins);
    } else {
      delete config.plugins;
    }
    if (draft.snapshot.hasBindings) {
      config.bindings = cloneJsonValue(draft.snapshot.bindings);
    } else {
      delete config.bindings;
    }
    await writeOpenClawConfigRecord(config);

    for (const target of getChannelBackedPaths()) {
      await restoreBackedPath(target);
    }
  });

  await clearChannelDraftSession();
}

export async function clearChannelDraftSession(): Promise<void> {
  if (!activeDraftState) {
    return;
  }
  activeDraftState = null;
  await rm(CHANNEL_DRAFT_BACKUP_ROOT, { recursive: true, force: true }).catch((error) => {
    logger.warn('Failed to clear channel draft backup', { error: String(error) });
  });
}

export async function finalizeChannelDraftSession(): Promise<void> {
  if (!activeDraftState) {
    return;
  }

  for (const targetPath of activeDraftState.pendingRemovedPaths) {
    await rm(targetPath, { recursive: true, force: true }).catch((error) => {
      logger.warn('Failed to remove channel runtime path after apply', {
        path: targetPath,
        error: String(error),
      });
    });
  }

  await clearChannelDraftSession();
}
