import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { getSetting, setSetting } from '../../utils/store';
import { parseJsonBody, sendJson } from '../route-utils';

const OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');

interface SecurityPolicy {
  enabled: boolean;
  allowedPaths: string[];
  allowExec: boolean;
}

const DEFAULT_POLICY: SecurityPolicy = {
  enabled: false,
  allowedPaths: [],
  allowExec: false,
};

function normalizePath(value: string): string {
  return value.trim().replace(/[\\/]+$/, '');
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

async function canonicalizeAllowedPaths(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    try {
      const resolved = await realpath(p);
      out.push(resolved);
    } catch {
      // ignore invalid paths
    }
  }
  return dedupeAndCompactPaths(out);
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
    return current.filter((item): item is string => typeof item === 'string');
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
  const defaults = ensureObject(agents, 'defaults');
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
}

function applySecurityPolicyToConfig(config: Record<string, unknown>, policy: SecurityPolicy): Record<string, unknown> {
  const agents = ensureObject(config, 'agents');
  const defaults = ensureObject(agents, 'defaults');
  const tools = ensureObject(config, 'tools');

  removeManagedSecurityConfig(config);

  if (!policy.enabled || policy.allowedPaths.length === 0) {
    return config;
  }

  defaults.workspace = policy.allowedPaths[0];

  const list = Array.isArray(agents.list) ? agents.list : [];
  const originalAgentWorkspaces: Record<string, string | null> = {};
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const id = typeof entry.id === 'string' ? entry.id : null;
    if (!id) continue;
    originalAgentWorkspaces[id] = typeof entry.workspace === 'string' ? entry.workspace : null;
    entry.workspace = policy.allowedPaths[0];
  }

  const fsCfg = ensureObject(tools, 'fs');
  fsCfg.workspaceOnly = true;

  const execCfg = ensureObject(tools, 'exec');
  const applyPatchCfg = ensureObject(execCfg, 'applyPatch');
  applyPatchCfg.workspaceOnly = true;

  if (!policy.allowExec) {
    const deny = ensureStringArray(tools, 'deny');
    for (const item of ['exec', 'process']) {
      if (!deny.includes(item)) deny.push(item);
    }
  }

  const elevated = ensureObject(tools, 'elevated');
  elevated.enabled = false;

  const clawclaw = ensureObject(config, 'clawclaw');
  const security = ensureObject(clawclaw, 'security');
  security.managed = true;
  security.lastAppliedAt = new Date().toISOString();
  security.allowedPaths = policy.allowedPaths;
  security.allowExec = policy.allowExec;
  security.originalAgentWorkspaces = originalAgentWorkspaces;

  return config;
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
  if (!checks.fsWorkspaceOnly) issues.push('tools.fs.workspaceOnly 未生效');
  if (!policy.allowExec && !checks.execDenied) issues.push('tools.deny 缺少 exec');
  if (!policy.allowExec && !checks.processDenied) issues.push('tools.deny 缺少 process');
  if (!checks.elevatedDisabled) issues.push('tools.elevated.enabled 未关闭');

  return { checks, issues, ok: issues.length === 0 };
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
      const canonicalPaths = await canonicalizeAllowedPaths(body.allowedPaths || []);
      const policy: SecurityPolicy = {
        enabled: !!body.enabled,
        allowedPaths: canonicalPaths,
        allowExec: !!body.allowExec,
      };
      await setSetting('securityPolicy', policy);
      sendJson(res, 200, { success: true, policy });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/security/apply' && req.method === 'POST') {
    try {
      const current = ((await getSetting('securityPolicy')) || DEFAULT_POLICY) as SecurityPolicy;
      const policy: SecurityPolicy = {
        enabled: !!current.enabled,
        allowExec: !!current.allowExec,
        allowedPaths: await canonicalizeAllowedPaths(current.allowedPaths || []),
      };

      if (policy.enabled && policy.allowedPaths.length === 0) {
        sendJson(res, 400, { success: false, error: 'No valid allowed paths configured.' });
        return true;
      }

      await setSetting('securityPolicy', policy);

      const config = await readOpenclawConfig();
      const updated = applySecurityPolicyToConfig(config, policy);
      await writeOpenclawConfig(updated);

      if (ctx.gatewayManager.getStatus().state === 'running') {
        await ctx.gatewayManager.restart();
      }

      sendJson(res, 200, {
        success: true,
        applied: policy,
        verify: verifyAppliedConfig(updated, policy),
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
      await setSetting('securityPolicy', DEFAULT_POLICY);

      if (ctx.gatewayManager.getStatus().state === 'running') {
        await ctx.gatewayManager.restart();
      }

      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
