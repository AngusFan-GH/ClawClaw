import { access, copyFile, mkdir, readdir, rm } from 'fs/promises';
import { constants } from 'fs';
import { join, normalize } from 'path';
import { listConfiguredChannelGroups, listConfiguredChannels, readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import { expandPath, getOpenClawConfigDir } from './paths';
import * as logger from './logger';

const MAIN_AGENT_ID = 'main';
const MAIN_AGENT_NAME = 'Main';
const DEFAULT_WORKSPACE_PATH = '~/.openclaw/workspace';
const AGENT_BOOTSTRAP_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
  'IDENTITY.md',
  'HEARTBEAT.md',
  'BOOT.md',
];
const AGENT_RUNTIME_FILES = [
  'auth-profiles.json',
  'models.json',
];

interface AgentModelConfig {
  primary?: string;
  [key: string]: unknown;
}

interface AgentDefaultsConfig {
  workspace?: string;
  model?: string | AgentModelConfig;
  [key: string]: unknown;
}

interface AgentListEntry extends Record<string, unknown> {
  id: string;
  name?: string;
  default?: boolean;
  workspace?: string;
  agentDir?: string;
  model?: string | AgentModelConfig;
}

interface AgentsConfig extends Record<string, unknown> {
  defaults?: AgentDefaultsConfig;
  list?: AgentListEntry[];
}

interface BindingMatch extends Record<string, unknown> {
  channel?: string;
  accountId?: string;
}

interface BindingConfig extends Record<string, unknown> {
  agentId?: string;
  match?: BindingMatch;
}

interface AgentConfigDocument extends Record<string, unknown> {
  agents?: AgentsConfig;
  bindings?: BindingConfig[];
}

export interface AgentSummary {
  id: string;
  name: string;
  isDefault: boolean;
  modelDisplay: string;
  inheritedModel: boolean;
  workspace: string;
  agentDir: string;
  channelTypes: string[];
  channelBindings: Array<{
    channelType: string;
    accountId: string;
    isDefaultAccount: boolean;
  }>;
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
}

function formatModelLabel(model: unknown): string | null {
  if (typeof model === 'string' && model.trim()) {
    const trimmed = model.trim();
    const parts = trimmed.split('/');
    return parts[parts.length - 1] || trimmed;
  }

  if (model && typeof model === 'object') {
    const primary = (model as AgentModelConfig).primary;
    if (typeof primary === 'string' && primary.trim()) {
      const parts = primary.trim().split('/');
      return parts[parts.length - 1] || primary.trim();
    }
  }

  return null;
}

function normalizeAgentName(name: string): string {
  return name.trim() || 'Agent';
}

function humanizeAgentId(agentId: string): string {
  if (agentId === MAIN_AGENT_ID) return MAIN_AGENT_NAME;
  return agentId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function slugifyAgentId(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!normalized) return 'agent';
  if (normalized === MAIN_AGENT_ID) return 'agent';
  return normalized;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(path: string): Promise<void> {
  if (!(await fileExists(path))) {
    await mkdir(path, { recursive: true });
  }
}

function getDefaultWorkspacePath(config: AgentConfigDocument): string {
  const defaults = (config.agents && typeof config.agents === 'object'
    ? (config.agents as AgentsConfig).defaults
    : undefined);
  return typeof defaults?.workspace === 'string' && defaults.workspace.trim()
    ? defaults.workspace
    : DEFAULT_WORKSPACE_PATH;
}

function getDefaultAgentDirPath(agentId: string): string {
  return `~/.openclaw/agents/${agentId}/agent`;
}

function createImplicitMainEntry(config: AgentConfigDocument): AgentListEntry {
  return {
    id: MAIN_AGENT_ID,
    name: MAIN_AGENT_NAME,
    default: true,
    workspace: getDefaultWorkspacePath(config),
    agentDir: getDefaultAgentDirPath(MAIN_AGENT_ID),
  };
}

function normalizeAgentsConfig(config: AgentConfigDocument): {
  agentsConfig: AgentsConfig;
  entries: AgentListEntry[];
  defaultAgentId: string;
  syntheticMain: boolean;
} {
  const agentsConfig = (config.agents && typeof config.agents === 'object'
    ? { ...(config.agents as AgentsConfig) }
    : {}) as AgentsConfig;
  const rawEntries = Array.isArray(agentsConfig.list)
    ? agentsConfig.list.filter((entry): entry is AgentListEntry => (
      Boolean(entry) && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.trim().length > 0
    ))
    : [];

  if (rawEntries.length === 0) {
    const main = createImplicitMainEntry(config);
    return {
      agentsConfig,
      entries: [main],
      defaultAgentId: MAIN_AGENT_ID,
      syntheticMain: true,
    };
  }

  const defaultEntry = rawEntries.find((entry) => entry.default) ?? rawEntries[0];
  return {
    agentsConfig,
    entries: rawEntries.map((entry) => ({ ...entry })),
    defaultAgentId: defaultEntry.id,
    syntheticMain: false,
  };
}

function isSimpleChannelBinding(binding: unknown): binding is BindingConfig {
  if (!binding || typeof binding !== 'object') return false;
  const candidate = binding as BindingConfig;
  if (typeof candidate.agentId !== 'string' || !candidate.agentId) return false;
  if (!candidate.match || typeof candidate.match !== 'object' || Array.isArray(candidate.match)) return false;
  const keys = Object.keys(candidate.match);
  const allowedKeys = keys.every((key) => key === 'channel' || key === 'accountId');
  return allowedKeys
    && typeof candidate.match.channel === 'string'
    && Boolean(candidate.match.channel)
    && (
      candidate.match.accountId === undefined
      || (typeof candidate.match.accountId === 'string' && Boolean(candidate.match.accountId))
    );
}

/** Normalize agent ID for consistent comparison (bindings vs entries). */
function normalizeAgentIdForBinding(id: string): string {
  return (id ?? '').trim().toLowerCase() || '';
}

function normalizeBindingAccountId(accountId?: string | null): string {
  const normalized = typeof accountId === 'string' ? accountId.trim() : '';
  return normalized || 'default';
}

function makeChannelAccountBindingKey(channelType: string, accountId?: string | null): string {
  return `${channelType}:${normalizeBindingAccountId(accountId)}`;
}

function getSimpleChannelBindingMaps(bindings: unknown): {
  typeOwners: Map<string, string>;
  accountOwners: Map<string, string>;
} {
  const typeOwners = new Map<string, string>();
  const accountOwners = new Map<string, string>();
  if (!Array.isArray(bindings)) {
    return { typeOwners, accountOwners };
  }

  for (const binding of bindings) {
    if (!isSimpleChannelBinding(binding)) continue;
    const agentId = normalizeAgentIdForBinding(binding.agentId!);
    const channel = binding.match?.channel;
    const accountId = binding.match?.accountId;
    if (!agentId || !channel) continue;
    if (typeof accountId === 'string' && accountId.trim()) {
      accountOwners.set(makeChannelAccountBindingKey(channel, accountId), agentId);
    } else {
      typeOwners.set(channel, agentId);
    }
  }

  return { typeOwners, accountOwners };
}

function upsertBindingsForChannel(
  bindings: unknown,
  channelType: string,
  agentId: string | null,
  accountId?: string | null,
): BindingConfig[] | undefined {
  const nextBindings = Array.isArray(bindings)
    ? [...bindings as BindingConfig[]].filter((binding) => {
      if (!isSimpleChannelBinding(binding) || binding.match?.channel !== channelType) {
        return true;
      }
      const bindingAccountId = normalizeBindingAccountId(binding.match?.accountId);
      if (accountId) {
        return bindingAccountId !== normalizeBindingAccountId(accountId);
      }
      return typeof binding.match?.accountId === 'string' && binding.match.accountId.trim().length > 0;
    })
    : [];

  if (agentId) {
    nextBindings.push({
      agentId,
      match: {
        channel: channelType,
        ...(accountId ? { accountId: normalizeBindingAccountId(accountId) } : {}),
      },
    });
  }

  return nextBindings.length > 0 ? nextBindings : undefined;
}

async function listExistingAgentIdsOnDisk(): Promise<Set<string>> {
  const ids = new Set<string>();
  const agentsDir = join(getOpenClawConfigDir(), 'agents');

  try {
    if (!(await fileExists(agentsDir))) return ids;
    const entries = await readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) ids.add(entry.name);
    }
  } catch {
    // ignore discovery failures
  }

  return ids;
}

async function getEffectiveAgentEntries(config: AgentConfigDocument): Promise<{
  agentsConfig: AgentsConfig;
  entries: AgentListEntry[];
  defaultAgentId: string;
}> {
  const { agentsConfig, entries, defaultAgentId } = normalizeAgentsConfig(config);
  const diskIds = await listExistingAgentIdsOnDisk();
  const existingIds = new Set(entries.map((entry) => entry.id));
  const mergedEntries = [...entries];

  for (const diskId of Array.from(diskIds).sort()) {
    if (existingIds.has(diskId)) continue;
    mergedEntries.push({
      id: diskId,
      name: humanizeAgentId(diskId),
      default: diskId === defaultAgentId,
      workspace:
        diskId === MAIN_AGENT_ID ? getDefaultWorkspacePath(config) : `~/.openclaw/workspace-${diskId}`,
      agentDir: getDefaultAgentDirPath(diskId),
    });
  }

  return {
    agentsConfig,
    entries: mergedEntries,
    defaultAgentId,
  };
}

async function removeAgentRuntimeDirectory(agentId: string): Promise<void> {
  const runtimeDir = join(getOpenClawConfigDir(), 'agents', agentId);
  try {
    await rm(runtimeDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to remove agent runtime directory', {
      agentId,
      runtimeDir,
      error: String(error),
    });
  }
}

function trimTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

function getManagedWorkspaceDirectory(agent: AgentListEntry): string | null {
  if (agent.id === MAIN_AGENT_ID) return null;

  const configuredWorkspace = expandPath(agent.workspace || `~/.openclaw/workspace-${agent.id}`);
  const managedWorkspace = join(getOpenClawConfigDir(), `workspace-${agent.id}`);
  const normalizedConfigured = trimTrailingSeparators(normalize(configuredWorkspace));
  const normalizedManaged = trimTrailingSeparators(normalize(managedWorkspace));

  return normalizedConfigured === normalizedManaged ? configuredWorkspace : null;
}

async function removeAgentWorkspaceDirectory(agent: AgentListEntry): Promise<void> {
  const workspaceDir = getManagedWorkspaceDirectory(agent);
  if (!workspaceDir) {
    logger.warn('Skipping agent workspace deletion for unmanaged path', {
      agentId: agent.id,
      workspace: agent.workspace,
    });
    return;
  }

  try {
    await rm(workspaceDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to remove agent workspace directory', {
      agentId: agent.id,
      workspaceDir,
      error: String(error),
    });
  }
}

async function copyBootstrapFiles(sourceWorkspace: string, targetWorkspace: string): Promise<void> {
  await ensureDir(targetWorkspace);

  for (const fileName of AGENT_BOOTSTRAP_FILES) {
    const source = join(sourceWorkspace, fileName);
    const target = join(targetWorkspace, fileName);
    if (!(await fileExists(source)) || (await fileExists(target))) continue;
    await copyFile(source, target);
  }
}

async function copyRuntimeFiles(sourceAgentDir: string, targetAgentDir: string): Promise<void> {
  await ensureDir(targetAgentDir);

  for (const fileName of AGENT_RUNTIME_FILES) {
    const source = join(sourceAgentDir, fileName);
    const target = join(targetAgentDir, fileName);
    if (!(await fileExists(source)) || (await fileExists(target))) continue;
    await copyFile(source, target);
  }
}

async function provisionAgentFilesystem(config: AgentConfigDocument, agent: AgentListEntry): Promise<void> {
  const { entries } = normalizeAgentsConfig(config);
  const mainEntry = entries.find((entry) => entry.id === MAIN_AGENT_ID) ?? createImplicitMainEntry(config);
  const sourceWorkspace = expandPath(mainEntry.workspace || getDefaultWorkspacePath(config));
  const targetWorkspace = expandPath(agent.workspace || `~/.openclaw/workspace-${agent.id}`);
  const sourceAgentDir = expandPath(mainEntry.agentDir || getDefaultAgentDirPath(MAIN_AGENT_ID));
  const targetAgentDir = expandPath(agent.agentDir || getDefaultAgentDirPath(agent.id));
  const targetSessionsDir = join(getOpenClawConfigDir(), 'agents', agent.id, 'sessions');

  await ensureDir(targetWorkspace);
  await ensureDir(targetAgentDir);
  await ensureDir(targetSessionsDir);

  if (targetWorkspace !== sourceWorkspace) {
    await copyBootstrapFiles(sourceWorkspace, targetWorkspace);
  }
  if (targetAgentDir !== sourceAgentDir) {
    await copyRuntimeFiles(sourceAgentDir, targetAgentDir);
  }
}

async function buildSnapshotFromConfig(config: AgentConfigDocument): Promise<AgentsSnapshot> {
  const { entries, defaultAgentId } = await getEffectiveAgentEntries(config);
  const configuredGroups = await listConfiguredChannelGroups();
  const configuredChannels = configuredGroups.map((group) => group.type);
  const { typeOwners, accountOwners } = getSimpleChannelBindingMaps(config.bindings);
  const channelOwners: Record<string, string> = {};
  const channelAccountOwners: Record<string, string> = {};

  for (const group of configuredGroups) {
    const ownerIds = new Set<string>();
    for (const account of group.accounts) {
      const bindingKey = makeChannelAccountBindingKey(group.type, account.accountId);
      const explicitOwner = accountOwners.get(bindingKey) ?? typeOwners.get(group.type);
      if (explicitOwner) {
        channelAccountOwners[bindingKey] = explicitOwner;
        ownerIds.add(explicitOwner);
      }
    }

    if (ownerIds.size === 1) {
      channelOwners[group.type] = Array.from(ownerIds)[0];
    } else {
      const typeOwner = typeOwners.get(group.type);
      if (typeOwner) {
        channelOwners[group.type] = typeOwner;
      }
    }
  }

  const defaultModelLabel = formatModelLabel((config.agents as AgentsConfig | undefined)?.defaults?.model);
  const agents: AgentSummary[] = entries.map((entry) => {
    const modelLabel = formatModelLabel(entry.model) || defaultModelLabel || 'Not configured';
    const inheritedModel = !formatModelLabel(entry.model) && Boolean(defaultModelLabel);
    const entryIdNorm = normalizeAgentIdForBinding(entry.id);
    const channelBindings = configuredGroups.flatMap((group) =>
      group.accounts
        .filter((account) => channelAccountOwners[makeChannelAccountBindingKey(group.type, account.accountId)] === entryIdNorm)
        .map((account) => ({
          channelType: group.type,
          accountId: account.accountId,
          isDefaultAccount: account.isDefaultAccount,
        }))
    );

    return {
      id: entry.id,
      name: entry.name || humanizeAgentId(entry.id),
      isDefault: entry.id === defaultAgentId,
      modelDisplay: modelLabel,
      inheritedModel,
      workspace: entry.workspace || (entry.id === MAIN_AGENT_ID ? getDefaultWorkspacePath(config) : `~/.openclaw/workspace-${entry.id}`),
      agentDir: entry.agentDir || getDefaultAgentDirPath(entry.id),
      channelTypes: Array.from(new Set(channelBindings.map((binding) => binding.channelType))),
      channelBindings,
    };
  });

  return {
    agents,
    defaultAgentId,
    configuredChannelTypes: configuredChannels,
    channelOwners,
    channelAccountOwners,
  };
}

export async function listAgentsSnapshot(): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  return buildSnapshotFromConfig(config);
}

export async function listConfiguredAgentIds(): Promise<string[]> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { entries } = await getEffectiveAgentEntries(config);
  const ids = [...new Set(entries.map((entry) => entry.id.trim()).filter(Boolean))];
  return ids.length > 0 ? ids : [MAIN_AGENT_ID];
}

export async function createAgent(name: string): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { agentsConfig, entries } = await getEffectiveAgentEntries(config);
  const normalizedName = normalizeAgentName(name);
  const existingIds = new Set(entries.map((entry) => entry.id));
  const diskIds = await listExistingAgentIdsOnDisk();
  let nextId = slugifyAgentId(normalizedName);
  let suffix = 2;

  while (existingIds.has(nextId) || diskIds.has(nextId)) {
    nextId = `${slugifyAgentId(normalizedName)}-${suffix}`;
    suffix += 1;
  }

  const nextEntries = [...entries];
  const newAgent: AgentListEntry = {
    id: nextId,
    name: normalizedName,
    workspace: `~/.openclaw/workspace-${nextId}`,
    agentDir: getDefaultAgentDirPath(nextId),
  };
  nextEntries.push(newAgent);

  config.agents = {
    ...agentsConfig,
    list: nextEntries,
  };

  await provisionAgentFilesystem(config, newAgent);
  await writeOpenClawConfig(config);
  logger.info('Created agent config entry', { agentId: nextId });
  return buildSnapshotFromConfig(config);
}

export async function updateAgentName(agentId: string, name: string): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { agentsConfig, entries } = await getEffectiveAgentEntries(config);
  const normalizedName = normalizeAgentName(name);
  const index = entries.findIndex((entry) => entry.id === agentId);
  if (index === -1) {
    throw new Error(`Agent "${agentId}" not found`);
  }

  entries[index] = {
    ...entries[index],
    name: normalizedName,
  };

  config.agents = {
    ...agentsConfig,
    list: entries,
  };

  await writeOpenClawConfig(config);
  logger.info('Updated agent name', { agentId, name: normalizedName });
  return buildSnapshotFromConfig(config);
}

export async function deleteAgentConfig(agentId: string): Promise<AgentsSnapshot> {
  if (agentId === MAIN_AGENT_ID) {
    throw new Error('The main agent cannot be deleted');
  }

  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { agentsConfig, entries, defaultAgentId } = await getEffectiveAgentEntries(config);
  const removedEntry = entries.find((entry) => entry.id === agentId);
  const nextEntries = entries.filter((entry) => entry.id !== agentId);
  if (!removedEntry || nextEntries.length === entries.length) {
    throw new Error(`Agent "${agentId}" not found`);
  }

  config.agents = {
    ...agentsConfig,
    list: nextEntries,
  };
  config.bindings = Array.isArray(config.bindings)
    ? config.bindings.filter((binding) => !(isSimpleChannelBinding(binding) && binding.agentId === agentId))
    : undefined;

  if (defaultAgentId === agentId && nextEntries.length > 0) {
    nextEntries[0] = {
      ...nextEntries[0],
      default: true,
    };
  }

  await writeOpenClawConfig(config);
  await removeAgentRuntimeDirectory(agentId);
  await removeAgentWorkspaceDirectory(removedEntry);
  logger.info('Deleted agent config entry', { agentId });
  return buildSnapshotFromConfig(config);
}

export async function assignChannelToAgent(agentId: string, channelType: string, accountId?: string): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { agentsConfig, entries } = await getEffectiveAgentEntries(config);
  if (!entries.some((entry) => entry.id === agentId)) {
    throw new Error(`Agent "${agentId}" not found`);
  }

  config.agents = {
    ...agentsConfig,
    list: entries,
  };
  config.bindings = upsertBindingsForChannel(config.bindings, channelType, agentId, accountId);
  await writeOpenClawConfig(config);
  logger.info('Assigned channel to agent', { agentId, channelType, accountId: normalizeBindingAccountId(accountId) });
  return buildSnapshotFromConfig(config);
}

export async function clearChannelBinding(channelType: string, agentId?: string, accountId?: string): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { agentsConfig, entries } = await getEffectiveAgentEntries(config);
  const { typeOwners, accountOwners } = getSimpleChannelBindingMaps(config.bindings);
  const boundAgentId = accountId
    ? accountOwners.get(makeChannelAccountBindingKey(channelType, accountId)) ?? typeOwners.get(channelType)
    : typeOwners.get(channelType);
  const normalizedRequestedAgentId =
    typeof agentId === 'string' && agentId.trim() ? normalizeAgentIdForBinding(agentId) : '';

  if (normalizedRequestedAgentId && boundAgentId && boundAgentId !== normalizedRequestedAgentId) {
    throw new Error(`Channel "${channelType}" is not bound to agent "${agentId}"`);
  }

  config.agents = {
    ...agentsConfig,
    list: entries,
  };
  config.bindings = upsertBindingsForChannel(config.bindings, channelType, null, accountId);
  await writeOpenClawConfig(config);
  logger.info('Cleared simplified channel binding', {
    channelType,
    accountId: accountId ? normalizeBindingAccountId(accountId) : undefined,
    agentId: normalizedRequestedAgentId || boundAgentId,
  });
  return buildSnapshotFromConfig(config);
}
