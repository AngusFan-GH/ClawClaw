import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  const normalized = Array.from(
    new Set(
      paths
        .map((item) => normalizePath(item))
        .filter(Boolean)
    )
  ).sort((a, b) => a.length - b.length);

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

function applySecurityPolicyToConfig(
  config: Record<string, unknown>,
  policy: SecurityPolicy
): Record<string, unknown> {
  const allowedPaths = dedupeAndCompactPaths(policy.allowedPaths);
  const agents = ensureObject(config, 'agents');
  const defaults = ensureObject(agents, 'defaults');
  const tools = ensureObject(config, 'tools');

  if (!policy.enabled || allowedPaths.length === 0) {
    return config;
  }

  defaults.workspace = allowedPaths[0];

  const fsCfg = ensureObject(tools, 'fs');
  fsCfg.workspaceOnly = true;

  const execCfg = ensureObject(tools, 'exec');
  const applyPatchCfg = ensureObject(execCfg, 'applyPatch');
  applyPatchCfg.workspaceOnly = true;

  if (policy.mode === 'strict-sandbox') {
    const sandbox = ensureObject(defaults, 'sandbox');
    sandbox.mode = 'all';
    sandbox.scope = 'agent';
    sandbox.workspaceAccess = 'none';

    const docker = ensureObject(sandbox, 'docker');
    docker.binds = allowedPaths.map((hostPath, index) => `${hostPath}:/allowed/${index}:rw`);

    const elevated = ensureObject(tools, 'elevated');
    elevated.enabled = false;
  }

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
      const policy: SecurityPolicy = {
        enabled: !!body.enabled,
        mode: body.mode === 'strict-sandbox' ? 'strict-sandbox' : 'workspace-only',
        allowedPaths: dedupeAndCompactPaths(body.allowedPaths || []),
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
        allowedPaths: dedupeAndCompactPaths(current.allowedPaths || []),
      };

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
        },
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
