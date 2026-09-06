import type { AgentsSnapshot } from '../utils/agent-config';
import { listAgentsSnapshot } from '../utils/agent-config';
import type { ConfiguredChannelGroupSnapshot } from '../utils/channel-config';
import {
  ensureDefaultChannelBindings,
  listConfiguredChannelAccountsFromConfig,
  listConfiguredChannelGroupsFromConfig,
  migrateQQBotSessionAccountsToConfig,
  readOpenClawConfigSnapshot,
} from '../utils/channel-config';
import { getOpenClawSkillsDir } from '../utils/paths';
import { getAllSkillConfigs } from '../utils/skill-config';
import {
  getManagedInstalledSkillSlugs,
  getProjectBundledSkillSlugs,
  getSkillMetadata,
} from '../utils/skill-metadata';
import type { SkillConfigMap, SkillMetadataMap } from '../utils/skill-list';

export type AgentsConfigSnapshot = AgentsSnapshot;

export type ChannelsConfigSnapshot = {
  groups: ConfiguredChannelGroupSnapshot[];
  accountsByType: Record<string, string[]>;
};

export type SkillsConfigSnapshot = {
  agentId?: string;
  configs: SkillConfigMap;
  localInstalledSlugs: string[];
  projectBundledSlugs: string[];
  metadataMap: SkillMetadataMap;
  workspaceDir: string | null;
  managedSkillsDir: string | null;
};

async function resolveSkillSnapshotDirs(agentId?: string): Promise<{
  workspaceDir: string | null;
  managedSkillsDir: string | null;
}> {
  try {
    const snapshot = await listAgentsSnapshot();
    const selected =
      (agentId ? snapshot.agents.find((agent) => agent.id === agentId) : undefined)
      || snapshot.agents.find((agent) => agent.id === snapshot.defaultAgentId)
      || snapshot.agents[0];
    return {
      workspaceDir: selected?.workspace || null,
      managedSkillsDir: getOpenClawSkillsDir(),
    };
  } catch {
    return {
      workspaceDir: null,
      managedSkillsDir: getOpenClawSkillsDir(),
    };
  }
}

export async function getAgentsConfigSnapshot(): Promise<AgentsConfigSnapshot> {
  return listAgentsSnapshot();
}

export async function getChannelsConfigSnapshot(): Promise<ChannelsConfigSnapshot> {
  await migrateQQBotSessionAccountsToConfig().catch(() => false);
  await ensureDefaultChannelBindings().catch(() => false);
  const config = await readOpenClawConfigSnapshot();
  const groups = listConfiguredChannelGroupsFromConfig(config, { includeCli: false });
  const accountsByType = listConfiguredChannelAccountsFromConfig(config, { includeCli: false });

  return {
    groups,
    accountsByType,
  };
}

export async function getSkillsConfigSnapshot(agentId?: string): Promise<SkillsConfigSnapshot> {
  const [configs, localInstalledSlugs, projectBundledSlugs, dirs] = await Promise.all([
    getAllSkillConfigs(),
    getManagedInstalledSkillSlugs().catch(() => []),
    getProjectBundledSkillSlugs().catch(() => []),
    resolveSkillSnapshotDirs(agentId),
  ]);

  const candidateSlugs = new Set<string>();
  for (const slug of localInstalledSlugs) candidateSlugs.add(slug);
  for (const slug of projectBundledSlugs) candidateSlugs.add(slug);
  Object.keys(configs).forEach((key) => candidateSlugs.add(key));
  const metadataMap = await getSkillMetadata([...candidateSlugs]);

  return {
    agentId,
    configs,
    localInstalledSlugs,
    projectBundledSlugs,
    metadataMap,
    workspaceDir: dirs.workspaceDir,
    managedSkillsDir: dirs.managedSkillsDir,
  };
}
