import { cp, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { withConfigLock, writeOpenClawConfigRecord } from '../utils/openclaw-config';
import { getDataDir, getOpenClawConfigDir } from '../utils/paths';
import { readOpenClawConfigSnapshot } from '../utils/channel-config';
import * as logger from '../utils/logger';

type AgentDraftSnapshot = {
  hasAgents: boolean;
  agents?: unknown;
  hasBindings: boolean;
  bindings?: unknown;
};

type AgentDraftState = {
  snapshot: AgentDraftSnapshot;
  draftConfig: Record<string, unknown>;
  pendingRemovedResources: Array<{
    agentId: string;
    workspaceDir: string | null;
  }>;
};

const AGENT_DRAFT_BACKUP_ROOT = join(getDataDir(), 'runtime-apply', 'agents-draft');
const AGENT_BACKUP_AGENTS_DIR = join(AGENT_DRAFT_BACKUP_ROOT, 'agents');
const AGENT_BACKUP_WORKSPACES_DIR = join(AGENT_DRAFT_BACKUP_ROOT, 'workspaces');

let activeDraftState: AgentDraftState | null = null;

function cloneJsonValue<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch {
    try {
      await readFile(path);
      return true;
    } catch {
      return false;
    }
  }
}

async function copyDirectoryIfExists(source: string, target: string): Promise<void> {
  if (!(await pathExists(source))) return;
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true, force: true });
}

async function backupManagedWorkspaces(configDir: string): Promise<void> {
  await mkdir(AGENT_BACKUP_WORKSPACES_DIR, { recursive: true });
  const entries = await readdir(configDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('workspace-')) continue;
    const source = join(configDir, entry.name);
    const target = join(AGENT_BACKUP_WORKSPACES_DIR, entry.name);
    await cp(source, target, { recursive: true, force: true });
  }
}

async function restoreManagedWorkspaces(configDir: string): Promise<void> {
  const currentEntries = await readdir(configDir, { withFileTypes: true }).catch(() => []);
  for (const entry of currentEntries) {
    if (!entry.isDirectory() || !entry.name.startsWith('workspace-')) continue;
    await rm(join(configDir, entry.name), { recursive: true, force: true });
  }

  const backupEntries = await readdir(AGENT_BACKUP_WORKSPACES_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of backupEntries) {
    if (!entry.isDirectory()) continue;
    await cp(join(AGENT_BACKUP_WORKSPACES_DIR, entry.name), join(configDir, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

export async function beginAgentDraftSession(): Promise<void> {
  if (activeDraftState) {
    return;
  }

  const config = await readOpenClawConfigSnapshot() as Record<string, unknown>;
  const snapshot: AgentDraftSnapshot = {
    hasAgents: Object.prototype.hasOwnProperty.call(config, 'agents'),
    agents: cloneJsonValue(config.agents),
    hasBindings: Object.prototype.hasOwnProperty.call(config, 'bindings'),
    bindings: cloneJsonValue(config.bindings),
  };

  const configDir = getOpenClawConfigDir();
  const agentsDir = join(configDir, 'agents');

  await rm(AGENT_DRAFT_BACKUP_ROOT, { recursive: true, force: true });
  await mkdir(AGENT_DRAFT_BACKUP_ROOT, { recursive: true });
  await copyDirectoryIfExists(agentsDir, AGENT_BACKUP_AGENTS_DIR);
  await backupManagedWorkspaces(configDir);

  activeDraftState = {
    snapshot,
    draftConfig: cloneJsonValue(config),
    pendingRemovedResources: [],
  };
}

export function hasActiveAgentDraftSession(): boolean {
  return activeDraftState !== null;
}

export function getAgentDraftConfigSnapshot<T extends Record<string, unknown>>(): T | null {
  if (!activeDraftState) {
    return null;
  }
  return cloneJsonValue(activeDraftState.draftConfig) as T;
}

export async function updateAgentDraftConfig<T>(
  updater: (config: Record<string, unknown>) => Promise<T> | T,
): Promise<T> {
  if (!activeDraftState) {
    throw new Error('Agent draft session is not active');
  }

  const workingConfig = cloneJsonValue(activeDraftState.draftConfig);
  const result = await updater(workingConfig);
  activeDraftState.draftConfig = workingConfig;
  return result;
}

export async function commitAgentDraftSession(): Promise<void> {
  if (!activeDraftState) {
    return;
  }

  await withConfigLock(async () => {
    await writeOpenClawConfigRecord(cloneJsonValue(activeDraftState!.draftConfig));
  });
}

export async function stageRemovedAgentResources(
  agentId: string,
  workspaceDir: string | null,
): Promise<void> {
  if (!activeDraftState) {
    return;
  }

  activeDraftState.pendingRemovedResources = activeDraftState.pendingRemovedResources.filter(
    (entry) => entry.agentId !== agentId,
  );
  activeDraftState.pendingRemovedResources.push({ agentId, workspaceDir });
}

export async function discardAgentDraftSession(): Promise<void> {
  const draft = activeDraftState;
  if (!draft) {
    return;
  }

  await withConfigLock(async () => {
    const config = await readOpenClawConfigSnapshot() as Record<string, unknown>;
    if (draft.snapshot.hasAgents) {
      config.agents = cloneJsonValue(draft.snapshot.agents);
    } else {
      delete config.agents;
    }
    if (draft.snapshot.hasBindings) {
      config.bindings = cloneJsonValue(draft.snapshot.bindings);
    } else {
      delete config.bindings;
    }
    await writeOpenClawConfigRecord(config);

    const configDir = getOpenClawConfigDir();
    const agentsDir = join(configDir, 'agents');
    await rm(agentsDir, { recursive: true, force: true });
    if (await pathExists(AGENT_BACKUP_AGENTS_DIR)) {
      await cp(AGENT_BACKUP_AGENTS_DIR, agentsDir, { recursive: true, force: true });
    }
    await restoreManagedWorkspaces(configDir);
  });

  await clearAgentDraftSession();
}

export async function clearAgentDraftSession(): Promise<void> {
  if (!activeDraftState) {
    return;
  }
  activeDraftState = null;
  await rm(AGENT_DRAFT_BACKUP_ROOT, { recursive: true, force: true }).catch((error) => {
    logger.warn('Failed to clear agent draft backup', { error: String(error) });
  });
}

export async function finalizeAgentDraftSession(): Promise<void> {
  if (!activeDraftState) {
    return;
  }

  for (const entry of activeDraftState.pendingRemovedResources) {
    const runtimeDir = join(getOpenClawConfigDir(), 'agents', entry.agentId);
    await rm(runtimeDir, { recursive: true, force: true }).catch((error) => {
      logger.warn('Failed to remove agent runtime directory after apply', {
        agentId: entry.agentId,
        runtimeDir,
        error: String(error),
      });
    });

    if (entry.workspaceDir) {
      await rm(entry.workspaceDir, { recursive: true, force: true }).catch((error) => {
        logger.warn('Failed to remove agent workspace directory after apply', {
          agentId: entry.agentId,
          workspaceDir: entry.workspaceDir,
          error: String(error),
        });
      });
    }
  }

  await clearAgentDraftSession();
}
