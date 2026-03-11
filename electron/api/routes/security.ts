import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { getSetting, setSetting } from '../../utils/store';
import { parseJsonBody, sendJson } from '../route-utils';

const OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');

type SecurityMode = 'workspace-only' | 'strict-sandbox';

interface SecurityPolicy {
  enabled: boolean;
  mode: SecurityMode;
  allowedPaths: string[];
}

const DEFAULT_POLICY: SecurityPolicy = {
  enabled: false,
  mode: 'workspace-only',
  allowedPaths: [],
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
      return (
        lower === baseLower ||
        lower.startsWith(`${baseLower}\\`) ||
        lower.startsWith(`${baseLower}/`)
      );
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

function restoreManagedAgentOverrides(config: Record<string, unknown>): void {
  const clawclaw = ensureObject(config, 'clawclaw');
  const security = ensureObject(clawclaw, 'security');
  const originalWorkspaces =
    security.originalAgentWorkspaces && typeof security.originalAgentWorkspaces === 'object'
      ? (security.originalAgentWorkspaces as Record<string, unknown>)
      : {};
  const originalSandboxes =
    security.originalAgentSandboxes && typeof security.originalAgentSandboxes === 'object'
      ? (security.originalAgentSandboxes as Record<string, unknown>)
      : {};
  const originalAgentTools =
    security.originalAgentTools && typeof security.originalAgentTools === 'object'
      ? (security.originalAgentTools as Record<string, unknown>)
      : {};

  const agents = ensureObject(config, 'agents');
  const list = Array.isArray(agents.list) ? agents.list : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const id = typeof entry.id === 'string' ? entry.id : null;
    if (!id) continue;

    if (Object.prototype.hasOwnProperty.call(originalWorkspaces, id)) {
      const restoredWorkspace = originalWorkspaces[id];
      if (typeof restoredWorkspace === 'string' && restoredWorkspace.trim()) {
        entry.workspace = restoredWorkspace;
      } else {
        delete entry.workspace;
      }
    }

    if (Object.prototype.hasOwnProperty.call(originalSandboxes, id)) {
      const restoredSandbox = originalSandboxes[id];
      if (restoredSandbox && typeof restoredSandbox === 'object') {
        entry.sandbox = restoredSandbox;
      } else {
        delete entry.sandbox;
      }
    }

    if (Object.prototype.hasOwnProperty.call(originalAgentTools, id)) {
      const restoredTools = originalAgentTools[id];
      if (restoredTools && typeof restoredTools === 'object') {
        entry.tools = restoredTools;
      } else {
        delete entry.tools;
      }
    }
  }

  delete security.originalAgentWorkspaces;
  delete security.originalAgentSandboxes;
  delete security.originalAgentTools;
}

function removeManagedSecurityConfig(config: Record<string, unknown>): void {
  const agents = ensureObject(config, 'agents');
  const defaults = ensureObject(agents, 'defaults');
  const tools = ensureObject(config, 'tools');

  restoreManagedAgentOverrides(config);

  const fsCfg = ensureObject(tools, 'fs');
  delete fsCfg.workspaceOnly;

  const execCfg = ensureObject(tools, 'exec');
  const applyPatchCfg = ensureObject(execCfg, 'applyPatch');
  delete applyPatchCfg.workspaceOnly;

  removeFromArray(tools, 'deny', ['exec', 'process']);

  const elevated = ensureObject(tools, 'elevated');
  delete elevated.enabled;

  const sandbox = ensureObject(defaults, 'sandbox');
  delete sandbox.mode;
  delete sandbox.scope;
  delete sandbox.workspaceAccess;

  const docker = ensureObject(sandbox, 'docker');
  delete docker.binds;

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

  // Force every configured agent onto the same restricted boundary.
  const list = Array.isArray(agents.list) ? agents.list : [];
  const originalAgentWorkspaces: Record<string, string | null> = {};
  const originalAgentSandboxes: Record<string, Record<string, unknown> | null> = {};
  const originalAgentTools: Record<string, Record<string, unknown> | null> = {};
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const id = typeof entry.id === 'string' ? entry.id : null;
    if (!id) continue;

    originalAgentWorkspaces[id] = typeof entry.workspace === 'string' ? entry.workspace : null;
    originalAgentSandboxes[id] =
      entry.sandbox && typeof entry.sandbox === 'object'
        ? ({ ...(entry.sandbox as Record<string, unknown>) } as Record<string, unknown>)
        : null;
    originalAgentTools[id] =
      entry.tools && typeof entry.tools === 'object'
        ? ({ ...(entry.tools as Record<string, unknown>) } as Record<string, unknown>)
        : null;

    entry.workspace = policy.allowedPaths[0];

    const agentSandbox = ensureObject(entry, 'sandbox');
    agentSandbox.mode = 'all';
    agentSandbox.scope = 'agent';
    agentSandbox.workspaceAccess = 'none';
    const agentDocker = ensureObject(agentSandbox, 'docker');
    agentDocker.binds = policy.allowedPaths.map((hostPath, index) => `${hostPath}:/allowed/${index}:rw`);

    const agentTools = ensureObject(entry, 'tools');
    const agentDeny = ensureStringArray(agentTools, 'deny');
    for (const item of ['exec', 'process']) {
      if (!agentDeny.includes(item)) agentDeny.push(item);
    }
    const agentElevated = ensureObject(agentTools, 'elevated');
    agentElevated.enabled = false;
  }

  const fsCfg = ensureObject(tools, 'fs');
  fsCfg.workspaceOnly = true;

  const execCfg = ensureObject(tools, 'exec');
  const applyPatchCfg = ensureObject(execCfg, 'applyPatch');
  applyPatchCfg.workspaceOnly = true;

  const deny = ensureStringArray(tools, 'deny');
  for (const item of ['exec', 'process']) {
    if (!deny.includes(item)) deny.push(item);
  }

  const elevated = ensureObject(tools, 'elevated');
  elevated.enabled = false;

  // Hard boundary: once enabled, always sandbox tools and expose only allowlisted mounts.
  // This prevents non-workspace file access even if host fs guards drift.
  const sandbox = ensureObject(defaults, 'sandbox');
  sandbox.mode = 'all';
  sandbox.scope = 'agent';
  sandbox.workspaceAccess = 'none';

  const docker = ensureObject(sandbox, 'docker');
  docker.binds = policy.allowedPaths.map((hostPath, index) => `${hostPath}:/allowed/${index}:rw`);

  const clawclaw = ensureObject(config, 'clawclaw');
  const security = ensureObject(clawclaw, 'security');
  security.managed = true;
  security.lastAppliedAt = new Date().toISOString();
  security.mode = policy.mode;
  security.allowedPaths = policy.allowedPaths;
  security.originalAgentWorkspaces = originalAgentWorkspaces;
  security.originalAgentSandboxes = originalAgentSandboxes;
  security.originalAgentTools = originalAgentTools;

  return config;
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
      const body = await parseJsonBody<SecurityPolicy>(req);
      const canonicalPaths = await canonicalizeAllowedPaths(body.allowedPaths || []);
      const policy: SecurityPolicy = {
        enabled: !!body.enabled,
        mode: body.mode === 'strict-sandbox' ? 'strict-sandbox' : 'workspace-only',
        allowedPaths: canonicalPaths,
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
        mode: current.mode === 'strict-sandbox' ? 'strict-sandbox' : 'workspace-only',
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
        applied: {
          enabled: policy.enabled,
          mode: policy.mode,
          allowedPaths: policy.allowedPaths,
          harden: {
            fsWorkspaceOnly: policy.enabled,
            denyExecProcess: policy.enabled,
            disableElevated: policy.enabled,
          },
        },
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
