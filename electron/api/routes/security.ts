import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { getSetting, setSetting } from '../../utils/store';
import { logger } from '../../utils/logger';
import { getOpenClawConfigDir } from '../../utils/paths';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  type SecurityPolicy,
  SECURITY_RULE_DEFINITIONS,
  getManagedToolDenyForRules,
  normalizeLinkedSecurityRules,
} from '../../shared/security-policy';

const OPENCLAW_CONFIG_DIR = getOpenClawConfigDir();
const OPENCLAW_CONFIG_PATH = join(OPENCLAW_CONFIG_DIR, 'openclaw.json');
const SECURITY_POLICY_FILE = 'SECURITY_POLICY.md';
const AGENTS_FILE = 'AGENTS.md';
const POLICY_BEGIN = '<!-- clawclaw-security:begin -->';
const POLICY_END = '<!-- clawclaw-security:end -->';
const DEFAULT_WORKSPACE_POLICY_ROOT = join(getOpenClawConfigDir(), 'workspace');
const ALWAYS_MANAGED_DENY = ['gateway'];

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
  prompt: {
    enabled: false,
    deniedPaths: [],
    rules: [],
  },
};

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

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
  if (!normalized) return '';

  try {
    return await realpath(normalized);
  } catch {
    return normalized;
  }
}

function dedupeAndCompactPaths(paths: string[]): string[] {
  const normalized = Array.from(new Set(paths.map((item) => normalizePath(item)).filter(Boolean))).sort(
    (a, b) => a.length - b.length,
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

async function canonicalizeDeniedPaths(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    const resolved = await canonicalizeOrPreservePath(p);
    if (resolved) out.push(resolved);
  }
  return dedupeAndCompactPaths(out);
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

function normalizeStoredPolicy(raw: unknown): SecurityPolicy {
  const prompt =
    raw && typeof raw === 'object' && 'prompt' in raw && raw.prompt && typeof raw.prompt === 'object'
      ? raw.prompt as Record<string, unknown>
      : {};

  const hasDeniedPaths = Array.isArray(prompt.deniedPaths);
  const deniedPaths = hasDeniedPaths
    ? prompt.deniedPaths.filter((item): item is string => typeof item === 'string')
    : [];
  const rules = normalizeLinkedSecurityRules(prompt.rules);

  return {
    prompt: {
      enabled: hasDeniedPaths || rules.length > 0 ? Boolean(prompt.enabled) : false,
      deniedPaths: dedupeAndCompactPaths(deniedPaths),
      rules,
    },
  };
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

async function collectSecurityWorkspaces(config: Record<string, unknown>): Promise<string[]> {
  const agents = ensureObject(config, 'agents');
  const defaults = ensureObject(agents, 'defaults');
  const workspaces = new Set<string>();

  const addWorkspace = async (value: unknown): Promise<void> => {
    if (typeof value !== 'string') return;
    const normalized = await canonicalizeOrPreservePath(value);
    if (!normalized) return;
    workspaces.add(normalized);
  };

  await addWorkspace(DEFAULT_WORKSPACE_POLICY_ROOT);
  await addWorkspace(defaults.workspace);

  const list = Array.isArray(agents.list) ? agents.list : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    await addWorkspace(entry.workspace);
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
  const deniedLines = policy.prompt.deniedPaths.map((p) => `- ${p}`).join('\n');
  const selectedRules = policy.prompt.rules
    .map((key) => SECURITY_RULE_DEFINITIONS.find((rule) => rule.key === key))
    .filter((item): item is (typeof SECURITY_RULE_DEFINITIONS)[number] => Boolean(item));
  const ruleLines = selectedRules.map((rule) => `- ${rule.title}: ${rule.description}`).join('\n');
  return [
    '# SECURITY_POLICY.md',
    '',
    'This file is generated by ClawClaw to document current security policy.',
    '',
    '## Prompt directory denylist',
    renderPolicyLine('status', policy.prompt.enabled),
    policy.prompt.enabled ? deniedLines || '- (none configured)' : '- not configured',
    '',
    '## Preset restrictions',
    renderPolicyLine('status', policy.prompt.enabled && selectedRules.length > 0),
    selectedRules.length > 0 ? ruleLines : '- not configured',
    '',
  ].join('\n');
}

function mergeAgentsSecuritySection(existing: string, policy: SecurityPolicy): string {
  const deniedPaths = policy.prompt.enabled
    ? policy.prompt.deniedPaths.map((p) => `  - ${p}`).join('\n')
    : '  - not configured';
  const selectedRules = policy.prompt.rules
    .map((key) => SECURITY_RULE_DEFINITIONS.find((rule) => rule.key === key))
    .filter((item): item is (typeof SECURITY_RULE_DEFINITIONS)[number] => Boolean(item));
  const ruleLines = selectedRules.length > 0
    ? selectedRules.map((rule) => `  - ${rule.title}: ${rule.description}`).join('\n')
    : '  - not configured';

  const section = [
    POLICY_BEGIN,
    '## Security Policy (Managed by ClawClaw)',
    renderPolicyLine('prompt directory denylist', policy.prompt.enabled),
    '- denied directories:',
    `  - enabled: ${policy.prompt.enabled ? 'yes' : 'no'}`,
    `  - paths:\n${deniedPaths}`,
    '- preset restrictions:',
    `  - enabled: ${selectedRules.length > 0 ? 'yes' : 'no'}`,
    `  - rules:\n${ruleLines}`,
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
): Promise<SecuritySyncResult> {
  const workspaces = await collectSecurityWorkspaces(config);
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

async function normalizePolicyInput(body: Partial<SecurityPolicy>): Promise<SecurityPolicy> {
  const deniedPaths = await canonicalizeDeniedPaths(body.prompt?.deniedPaths || []);
  const rules = normalizeLinkedSecurityRules(body.prompt?.rules);

  return {
    prompt: {
      enabled: !!body.prompt?.enabled,
      deniedPaths,
      rules,
    },
  };
}

function normalizeToolEntries(values: unknown): string[] {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of values) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function mergeManagedToolDeny(existing: string[], previousManaged: string[], nextManaged: string[]): string[] {
  const previousSet = new Set(previousManaged.map((item) => item.toLowerCase()));
  const merged = existing.filter((item) => !previousSet.has(item.toLowerCase()));

  const seen = new Set(merged.map((item) => item.toLowerCase()));
  for (const item of nextManaged) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

async function applyPolicyRuntimeConfig(
  config: Record<string, unknown>,
  previousPolicy: SecurityPolicy,
  nextPolicy: SecurityPolicy,
): Promise<{ managedToolDeny: string[]; totalToolDeny: string[] }> {
  const previousManaged = previousPolicy.prompt.enabled
    ? [...ALWAYS_MANAGED_DENY, ...getManagedToolDenyForRules(previousPolicy.prompt.rules)]
    : [];
  const nextManaged = nextPolicy.prompt.enabled
    ? [...ALWAYS_MANAGED_DENY, ...getManagedToolDenyForRules(nextPolicy.prompt.rules)]
    : [];

  const tools = ensureObject(config, 'tools');
  const existingDeny = normalizeToolEntries(tools.deny);
  const mergedDeny = mergeManagedToolDeny(existingDeny, previousManaged, nextManaged);

  if (mergedDeny.length > 0) {
    tools.deny = mergedDeny;
  } else {
    delete tools.deny;
  }

  if (Object.keys(tools).length === 0) {
    delete config.tools;
  }

  await writeOpenclawConfig(config);

  return {
    managedToolDeny: nextManaged,
    totalToolDeny: mergedDeny,
  };
}

export async function handleSecurityRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/security/policy' && req.method === 'GET') {
    const current = normalizeStoredPolicy(await getSetting('securityPolicy'));
    sendJson(res, 200, current);
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
      const payload = await parseJsonBody<Partial<SecurityPolicy>>(req);
      const policy = await normalizePolicyInput(payload);

      if (policy.prompt.enabled && policy.prompt.deniedPaths.length === 0 && policy.prompt.rules.length === 0) {
        sendJson(res, 400, { success: false, error: 'Prompt policy enabled but no denied directories or preset restrictions configured.' });
        return true;
      }

      const current = normalizeStoredPolicy(await getSetting('securityPolicy'));
      const config = await readOpenclawConfig();
      const verify = await applyPolicyRuntimeConfig(config, current, policy);
      await setSetting('securityPolicy', policy);
      const syncResult = await syncSecurityPolicyArtifacts(config, policy);
      let gatewayRestarted = false;
      if (ctx.gatewayManager.getStatus().state === 'running') {
        await ctx.gatewayManager.restart();
        gatewayRestarted = true;
      }

      sendJson(res, 200, {
        success: true,
        applied: policy,
        verify,
        sync: syncResult,
        gatewayRestarted,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/security/reset' && req.method === 'POST') {
    try {
      const config = await readOpenclawConfig();
      const current = normalizeStoredPolicy(await getSetting('securityPolicy'));
      const verify = await applyPolicyRuntimeConfig(config, current, DEFAULT_POLICY);
      await setSetting('securityPolicy', DEFAULT_POLICY);
      const syncResult = await syncSecurityPolicyArtifacts(config, DEFAULT_POLICY);
      let gatewayRestarted = false;
      if (ctx.gatewayManager.getStatus().state === 'running') {
        await ctx.gatewayManager.restart();
        gatewayRestarted = true;
      }

      sendJson(res, 200, { success: true, verify, sync: syncResult, gatewayRestarted });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
