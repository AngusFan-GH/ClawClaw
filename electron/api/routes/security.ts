import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { getSetting, setSetting } from '../../utils/store';
import { parseJsonBody, sendJson } from '../route-utils';

const OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');
const SECURITY_POLICY_FILE = 'SECURITY_POLICY.md';
const AGENTS_FILE = 'AGENTS.md';
const POLICY_BEGIN = '<!-- clawclaw-security:begin -->';
const POLICY_END = '<!-- clawclaw-security:end -->';

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

async function canonicalizePath(path: string): Promise<string> {
  if (!path?.trim()) return '';
  try {
    return await realpath(path);
  } catch {
    return '';
  }
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

function renderPolicyMarkdown(policy: SecurityPolicy): string {
  const lines = policy.prompt.allowedPaths.map((p) => `- ${p}`).join('\n');
  return [
    '# SECURITY_POLICY.md',
    '',
    '这是由 ClawClaw 安全页面自动生成的提示词安全策略。',
    '',
    '## 允许目录（提示词层，多目录）',
    lines || '- (未配置)',
    '',
    '## 规则',
    '- 仅在上述目录中执行文件相关操作。',
    '- 白名单外路径一律拒绝。',
    '- 如用户要求跨目录操作，先明确说明风险并请求重新配置。',
    '',
    '## 工作空间硬限制（配置层）',
    policy.workspace.enabled
      ? `- 已启用：${policy.workspace.path}`
      : '- 未启用（仅提示词限制）',
    policy.workspace.allowExec
      ? '- 允许 exec/process（高风险）'
      : '- 禁止 exec/process，禁止 elevated',
    '',
  ].join('\n');
}

function mergePolicySection(existing: string): string {
  const section = [
    POLICY_BEGIN,
    '## Security Policy (Managed by ClawClaw)',
    `- 必须先阅读并执行 \`${SECURITY_POLICY_FILE}\`。`,
    '- 文件操作仅限安全策略中列出的允许目录。',
    POLICY_END,
  ].join('\n');

  const begin = existing.indexOf(POLICY_BEGIN);
  const end = existing.indexOf(POLICY_END);
  if (begin !== -1 && end !== -1) {
    return existing.slice(0, begin) + section + existing.slice(end + POLICY_END.length);
  }
  return `${existing.trimEnd()}\n\n${section}\n`;
}

async function syncPromptPolicyFiles(config: Record<string, unknown>, policy: SecurityPolicy): Promise<void> {
  const agents = ensureObject(config, 'agents');
  const defaults = ensureObject(agents, 'defaults');
  const workspaces = new Set<string>();

  if (typeof defaults.workspace === 'string' && defaults.workspace.trim()) {
    workspaces.add(defaults.workspace);
  }

  const list = Array.isArray(agents.list) ? agents.list : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.workspace === 'string' && entry.workspace.trim()) {
      workspaces.add(entry.workspace);
    }
  }

  for (const ws of workspaces) {
    try {
      await mkdir(ws, { recursive: true });
      await writeFile(join(ws, SECURITY_POLICY_FILE), renderPolicyMarkdown(policy), 'utf8');

      const agentsPath = join(ws, AGENTS_FILE);
      let existing = '';
      try {
        existing = await readFile(agentsPath, 'utf8');
      } catch {
        existing = '# AGENTS.md\n';
      }
      await writeFile(agentsPath, mergePolicySection(existing), 'utf8');
    } catch {
      // best effort
    }
  }
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
  if (shouldEnforce && !checks.fsWorkspaceOnly) issues.push('tools.fs.workspaceOnly 未生效');
  if (shouldEnforce && !policy.workspace.allowExec && !checks.execDenied) issues.push('tools.deny 缺少 exec');
  if (shouldEnforce && !policy.workspace.allowExec && !checks.processDenied) issues.push('tools.deny 缺少 process');
  if (shouldEnforce && !checks.elevatedDisabled) issues.push('tools.elevated.enabled 未关闭');

  return { checks, issues, ok: issues.length === 0 };
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
      const current = ((await getSetting('securityPolicy')) || DEFAULT_POLICY) as SecurityPolicy;
      const policy = await normalizePolicyInput(current);

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
      await syncPromptPolicyFiles(config, policy);

      if (ctx.gatewayManager.getStatus().state === 'running') {
        await ctx.gatewayManager.restart();
      }

      sendJson(res, 200, {
        success: true,
        applied: policy,
        verify: verifyAppliedConfig(config, policy),
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
      await syncPromptPolicyFiles(config, DEFAULT_POLICY);

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
