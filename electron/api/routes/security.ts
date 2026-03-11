import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { getSetting, setSetting } from '../../utils/store';
import { logger } from '../../utils/logger';
import { getOpenClawConfigDir } from '../../utils/paths';
import { parseJsonBody, sendJson } from '../route-utils';

const OPENCLAW_CONFIG_PATH = join(getOpenClawConfigDir(), 'openclaw.json');
const SECURITY_POLICY_FILE = 'SECURITY_POLICY.md';
const AGENTS_FILE = 'AGENTS.md';
const POLICY_BEGIN = '<!-- clawclaw-security:begin -->';
const POLICY_END = '<!-- clawclaw-security:end -->';
const DEFAULT_WORKSPACE_POLICY_ROOT = join(getOpenClawConfigDir(), 'workspace');

interface WorkspacePolicy {
  enabled: boolean;
  path: string;
  allowExec: boolean;
}

interface PromptPolicy {
  enabled: boolean;
  allowedPaths: string[];
}

interface SecurityPolicy {
  workspace: WorkspacePolicy;
  prompt: PromptPolicy;
}

interface SyncFailure {
  workspace: string;
  file: string;
  error: string;
}

interface SecuritySyncResult {
  targets: string[];
  succeeded: string[];
  skipped: string[];
  failures: SyncFailure[];
}

const DEFAULT_POLICY: SecurityPolicy = {
  workspace: {
    enabled: false,
    path: '',
    allowExec: false,
  },
  prompt: {
    enabled: false,
    allowedPaths: [],
  },
};

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (/^[A-Za-z]:[\\/]+$/.test(trimmed)) {
    return `${trimmed[0].toUpperCase()}:\\`;
  }
  if (trimmed === '/' || trimmed === '\\') {
    return trimmed;
  }

  return trimmed.replace(/[\\/]+$/, '');
}

function expandHomePath(value: string): string {
  return value.startsWith('~') ? value.replace(/^~/, homedir()) : value;
}

async function canonicalizeOrPreservePath(rawPath: string): Promise<string> {
  const normalized = normalizePath(expandHomePath(rawPath));
  if (!normalized) {
    return '';
  }

  try {
    return await realpath(normalized);
  } catch {
    return normalized;
  }
}

function dedupeAndCompactPaths(paths: string[]): string[] {
  const normalized = Array.from(new Set(paths.map((item) => normalizePath(item)).filter(Boolean))).sort(
    (a, b) => a.length - b.length
  );

  const compacted: string[] = [];
  for (const current of normalized) {
    const lower = current.toLowerCase();
    const covered = compacted.some((base) => {
      const baseLower = base.toLowerCase();
      return lower === baseLower || lower.startsWith(`${baseLower}\\`) || lower.startsWith(`${baseLower}/`);
    });
    if (!covered) compacted.push(current);
  }
  return compacted;
}

async function canonicalizePath(path: string): Promise<string> {
  return canonicalizeOrPreservePath(path);
}

async function canonicalizeAllowedPaths(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    const resolved = await canonicalizeOrPreservePath(p);
    if (resolved) {
      out.push(resolved);
    }
  }
  return dedupeAndCompactPaths(out);
}

function mergePolicyInput(previous: SecurityPolicy, patch: Partial<SecurityPolicy>): SecurityPolicy {
  return {
    workspace: {
      enabled: patch.workspace?.enabled ?? previous.workspace.enabled,
      path: patch.workspace?.path ?? previous.workspace.path,
      allowExec: patch.workspace?.allowExec ?? previous.workspace.allowExec,
    },
    prompt: {
      enabled: patch.prompt?.enabled ?? previous.prompt.enabled,
      allowedPaths:
        patch.prompt?.allowedPaths !== undefined
          ? patch.prompt.allowedPaths
          : previous.prompt.allowedPaths,
    },
  };
}

function mergePolicySyncTargets(previous: SecurityPolicy, next: SecurityPolicy): string[] {
  return dedupeAndCompactPaths([...previous.prompt.allowedPaths, ...next.prompt.allowedPaths]);
}

async function readOpenclawConfig(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(OPENCLAW_CONFIG_PATH, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeOpenclawConfig(config: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(OPENCLAW_CONFIG_PATH), { recursive: true });
  await writeFile(OPENCLAW_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  const created: Record<string, unknown> = {};
  parent[key] = created;
  return created;
}

function ensureStringArray(target: Record<string, unknown>, key: string): string[] {
  const current = target[key];
  if (Array.isArray(current)) {
    const filtered = current.filter((item): item is string => typeof item === 'string');
    target[key] = filtered;
    return filtered;
  }
  const arr: string[] = [];
  target[key] = arr;
  return arr;
}

function removeFromArray(target: Record<string, unknown>, key: string, values: string[]): void {
  const current = ensureStringArray(target, key);
  const valueSet = new Set(values);
  target[key] = current.filter((item) => !valueSet.has(item));
}

function restoreManagedAgentWorkspaces(config: Record<string, unknown>): void {
  const clawclaw = ensureObject(config, 'clawclaw');
  const security = ensureObject(clawclaw, 'security');
  const original =
    security.originalAgentWorkspaces && typeof security.originalAgentWorkspaces === 'object'
      ? (security.originalAgentWorkspaces as Record<string, unknown>)
      : {};

  const agents = ensureObject(config, 'agents');
  const list = Array.isArray(agents.list) ? agents.list : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const id = typeof entry.id === 'string' ? entry.id : null;
    if (!id) continue;
    if (Object.prototype.hasOwnProperty.call(original, id)) {
      const restored = original[id];
      if (typeof restored === 'string' && restored.trim()) {
        entry.workspace = restored;
      } else {
        delete entry.workspace;
      }
    }
  }

  delete security.originalAgentWorkspaces;
}

function removeManagedSecurityConfig(config: Record<string, unknown>): void {
  const agents = ensureObject(config, 'agents');
  const tools = ensureObject(config, 'tools');

  restoreManagedAgentWorkspaces(config);

  const fsCfg = ensureObject(tools, 'fs');
  delete fsCfg.workspaceOnly;

  const execCfg = ensureObject(tools, 'exec');
  const applyPatchCfg = ensureObject(execCfg, 'applyPatch');
  delete applyPatchCfg.workspaceOnly;

  removeFromArray(tools, 'deny', ['exec', 'process']);

  const elevated = ensureObject(tools, 'elevated');
  delete elevated.enabled;

  const clawclaw = ensureObject(config, 'clawclaw');
  const security = ensureObject(clawclaw, 'security');
  delete security.lastAppliedAt;
  security.managed = false;

  // Keep defaults.workspace untouched on reset; users may rely on their existing config.
  const defaults = ensureObject(agents, 'defaults');
  if (security.originalDefaultsWorkspace !== undefined) {
    const restored = security.originalDefaultsWorkspace;
    if (typeof restored === 'string' && restored.trim()) {
      defaults.workspace = restored;
    }
    delete security.originalDefaultsWorkspace;
  }
}

function applyWorkspacePolicy(config: Record<string, unknown>, workspace: WorkspacePolicy): void {
  if (!workspace.enabled || !workspace.path) return;

  const agents = ensureObject(config, 'agents');
  const defaults = ensureObject(agents, 'defaults');
  const tools = ensureObject(config, 'tools');
  const clawclaw = ensureObject(config, 'clawclaw');
  const security = ensureObject(clawclaw, 'security');

  security.originalDefaultsWorkspace = typeof defaults.workspace === 'string' ? defaults.workspace : '';
  defaults.workspace = workspace.path;

  const list = Array.isArray(agents.list) ? agents.list : [];
  const originalAgentWorkspaces: Record<string, string | null> = {};
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const id = typeof entry.id === 'string' ? entry.id : null;
    if (!id) continue;
    originalAgentWorkspaces[id] = typeof entry.workspace === 'string' ? entry.workspace : null;
    entry.workspace = workspace.path;
  }
  security.originalAgentWorkspaces = originalAgentWorkspaces;

  const fsCfg = ensureObject(tools, 'fs');
  fsCfg.workspaceOnly = true;

  const execCfg = ensureObject(tools, 'exec');
  const applyPatchCfg = ensureObject(execCfg, 'applyPatch');
  applyPatchCfg.workspaceOnly = true;

  const elevated = ensureObject(tools, 'elevated');
  elevated.enabled = false;

  if (!workspace.allowExec) {
    const deny = ensureStringArray(tools, 'deny');
    for (const item of ['exec', 'process']) {
      if (!deny.includes(item)) deny.push(item);
    }
  }
}

interface SecuritySyncOptions {
  extraPromptPaths?: string[];
}

async function collectSecurityWorkspaces(
  config: Record<string, unknown>,
  policy: SecurityPolicy,
  options: SecuritySyncOptions = {}
): Promise<string[]> {
  const agents = ensureObject(config, 'agents');
  const defaults = ensureObject(agents, 'defaults');
  const workspaces = new Set<string>();

  const addWorkspace = async (value: unknown): Promise<void> => {
    if (typeof value !== 'string') return;
    const normalized = await canonicalizeOrPreservePath(value);
    if (!normalized) return;
    workspaces.add(normalized);
  };

  const { extraPromptPaths = [] } = options;

  await addWorkspace(DEFAULT_WORKSPACE_POLICY_ROOT);
  if (policy.workspace.enabled) {
    await addWorkspace(policy.workspace.path);
  }
  await addWorkspace(defaults.workspace);

  const list = Array.isArray(agents.list) ? agents.list : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    await addWorkspace(entry.workspace);
  }

  if (policy.prompt.enabled) {
    for (const path of policy.prompt.allowedPaths) {
      await addWorkspace(path);
    }
  }

  for (const path of extraPromptPaths) {
    await addWorkspace(path);
  }

  if (workspaces.size === 0) {
    workspaces.add(DEFAULT_WORKSPACE_POLICY_ROOT);
  }

  return [...workspaces].sort((a, b) => a.localeCompare(b));
}

function renderPolicyLine(label: string, enabled: boolean): string {
  return `- ${label}: ${enabled ? 'enabled' : 'disabled'}`;
}

function renderSecurityPolicyMarkdown(policy: SecurityPolicy): string {
  const promptLines = policy.prompt.allowedPaths.map((p) => `- ${p}`).join('\n');
  return [
    '# SECURITY_POLICY.md',
    '',
    'This file is generated by ClawClaw to document current security policy.',
    '',
    '## Directory allowlist',
    renderPolicyLine('status', policy.prompt.enabled),
    policy.prompt.enabled ? promptLines || '- (none configured)' : '- not configured',
    '',
    '## Workspace policy',
    policy.workspace.enabled ? `- enforced path: ${policy.workspace.path}` : '- disabled',
    policy.workspace.allowExec ? '- exec/process allowed' : '- exec/process denied',
    '',
  ].join('\n');
}

function mergeAgentsSecuritySection(existing: string, policy: SecurityPolicy): string {
  const promptPaths = policy.prompt.enabled
    ? policy.prompt.allowedPaths.map((p) => `  - ${p}`).join('\n')
    : '  - not configured';

  const section = [
    POLICY_BEGIN,
    '## Security Policy (Managed by ClawClaw)',
    renderPolicyLine('directory allowlist', policy.prompt.enabled),
    `- workspace policy: ${policy.workspace.enabled ? 'enabled' : 'disabled'}`,
    `- workspace policy path: ${policy.workspace.enabled ? policy.workspace.path : 'N/A'}`,
    `- exec/process allowed: ${policy.workspace.allowExec ? 'yes' : 'no'}`,
    '- directory allowlist:',
    `  - enabled: ${policy.prompt.enabled ? 'yes' : 'no'}`,
    `  - allowed paths:\n${promptPaths}`,
    POLICY_END,
  ].join('\n');

  const begin = existing.indexOf(POLICY_BEGIN);
  const end = existing.indexOf(POLICY_END);
  if (begin !== -1 && end !== -1) {
    return `${existing.slice(0, begin)}${section}${existing.slice(end + POLICY_END.length)}`;
  }
  return `${existing.trimEnd()}\n\n${section}\n`;
}

async function syncSecurityPolicyArtifacts(
  config: Record<string, unknown>,
  policy: SecurityPolicy,
  options: SecuritySyncOptions = {}
): Promise<SecuritySyncResult> {
  const workspaces = await collectSecurityWorkspaces(config, policy, options);
  const result: SecuritySyncResult = {
    targets: [...workspaces],
    succeeded: [],
    skipped: [],
    failures: [],
  };

  for (const workspace of workspaces) {
    const targetWorkspace = normalizePath(expandHomePath(workspace));
    if (!targetWorkspace) {
      result.failures.push({ workspace, file: SECURITY_POLICY_FILE, error: 'Invalid workspace path' });
      continue;
    }

    const agentsPath = join(targetWorkspace, AGENTS_FILE);
    const policyPath = join(targetWorkspace, SECURITY_POLICY_FILE);

    try {
      await mkdir(targetWorkspace, { recursive: true });
      await writeFile(policyPath, renderSecurityPolicyMarkdown(policy), 'utf8');

      let existingAgents = '# AGENTS.md\n';
      try {
        existingAgents = await readFile(agentsPath, 'utf8');
      } catch {
        existingAgents = '# AGENTS.md\n';
      }

      const mergedAgents = mergeAgentsSecuritySection(existingAgents, policy);
      if (mergedAgents === existingAgents) {
        result.skipped.push(agentsPath);
      } else {
        await writeFile(agentsPath, mergedAgents, 'utf8');
      }

      result.succeeded.push(targetWorkspace);
    } catch (error) {
      result.failures.push({
        workspace: targetWorkspace,
        file: AGENTS_FILE,
        error: String(error),
      });
      logger.warn(`[security] Failed to sync policy docs for workspace: ${targetWorkspace}`, error);
    }
  }

  return result;
}

function verifyAppliedConfig(config: Record<string, unknown>, policy: SecurityPolicy) {
  const tools = ensureObject(config, 'tools');
  const fsCfg = ensureObject(tools, 'fs');
  const deny = ensureStringArray(tools, 'deny');
  const elevated = ensureObject(tools, 'elevated');

  const checks = {
    fsWorkspaceOnly: fsCfg.workspaceOnly === true,
    execDenied: deny.includes('exec'),
    processDenied: deny.includes('process'),
    elevatedDisabled: elevated.enabled === false,
  };

  const issues: string[] = [];
  const shouldEnforce = policy.workspace.enabled;
  if (shouldEnforce && !checks.fsWorkspaceOnly) issues.push('tools.fs.workspaceOnly is not effective');
  if (shouldEnforce && !policy.workspace.allowExec && !checks.execDenied) issues.push('tools.deny 缺少 exec');
  if (shouldEnforce && !policy.workspace.allowExec && !checks.processDenied) issues.push('tools.deny 缺少 process');
  if (shouldEnforce && !checks.elevatedDisabled) issues.push('tools.elevated.enabled is not disabled');

  return { checks, issues, ok: issues.length === 0 };
}

async function restartGatewayIfRunning(
  ctx: HostApiContext
): Promise<{ ok: boolean; error?: string }> {
  if (ctx.gatewayManager.getStatus().state !== 'running') {
    return { ok: true };
  }

  try {
    await ctx.gatewayManager.restart();
    return { ok: true };
  } catch (error) {
    logger.warn('[security] Failed to restart Gateway after syncing security policy', error);
    return { ok: false, error: String(error) };
  }
}

async function normalizePolicyInput(body: Partial<SecurityPolicy>): Promise<SecurityPolicy> {
  const workspaceEnabled = !!body.workspace?.enabled;
  const workspacePath = await canonicalizePath(body.workspace?.path || '');
  const promptPaths = await canonicalizeAllowedPaths(body.prompt?.allowedPaths || []);

  return {
    workspace: {
      enabled: workspaceEnabled,
      path: workspacePath,
      allowExec: !!body.workspace?.allowExec,
    },
    prompt: {
      enabled: !!body.prompt?.enabled,
      allowedPaths: promptPaths,
    },
  };
}

export async function handleSecurityRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext
): Promise<boolean> {
  if (url.pathname === '/api/security/policy' && req.method === 'GET') {
    const current = await getSetting('securityPolicy');
    sendJson(res, 200, { ...(current || DEFAULT_POLICY) });
    return true;
  }

  if (url.pathname === '/api/security/policy' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<Partial<SecurityPolicy>>(req);
      const policy = await normalizePolicyInput(body);
      await setSetting('securityPolicy', policy);
      sendJson(res, 200, { success: true, policy });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/security/apply' && req.method === 'POST') {
    try {
      const storedPolicy = await getSetting('securityPolicy');
      const previousPolicy = await normalizePolicyInput(storedPolicy || DEFAULT_POLICY);
      const payload = await parseJsonBody<Partial<SecurityPolicy>>(req);
      const mergedPolicy = mergePolicyInput(previousPolicy, payload);
      const policy = await normalizePolicyInput(mergedPolicy);

      if (policy.workspace.enabled && !policy.workspace.path) {
        sendJson(res, 400, { success: false, error: 'Workspace policy enabled but no valid workspace path.' });
        return true;
      }

      if (policy.prompt.enabled && policy.prompt.allowedPaths.length === 0) {
        sendJson(res, 400, { success: false, error: 'Prompt policy enabled but no valid allowed directories.' });
        return true;
      }

      await setSetting('securityPolicy', policy);

      const config = await readOpenclawConfig();
      removeManagedSecurityConfig(config);
      applyWorkspacePolicy(config, policy.workspace);
      await writeOpenclawConfig(config);
      const syncPromptTargets = mergePolicySyncTargets(previousPolicy, policy);
      const syncResult = await syncSecurityPolicyArtifacts(config, policy, {
        extraPromptPaths: syncPromptTargets,
      });
      const gatewayRestart = await restartGatewayIfRunning(ctx);

      sendJson(res, 200, {
        success: true,
        applied: policy,
        verify: verifyAppliedConfig(config, policy),
        sync: syncResult,
        gatewayRestart,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/security/reset' && req.method === 'POST') {
    try {
      const config = await readOpenclawConfig();
      removeManagedSecurityConfig(config);
      await writeOpenclawConfig(config);
      const previousPolicy = await normalizePolicyInput(
        (await getSetting('securityPolicy')) || DEFAULT_POLICY
      );
      const fallbackPromptPaths = previousPolicy.prompt.allowedPaths;
      await setSetting('securityPolicy', DEFAULT_POLICY);
      const syncResult = await syncSecurityPolicyArtifacts(config, DEFAULT_POLICY, {
        extraPromptPaths: fallbackPromptPaths,
      });

      const gatewayRestart = await restartGatewayIfRunning(ctx);

      sendJson(res, 200, { success: true, sync: syncResult, gatewayRestart });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}


