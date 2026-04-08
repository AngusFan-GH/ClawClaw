export type SecurityRuleKey =
  | 'denyRuntime'
  | 'denyWrite'
  | 'denyRead'
  | 'denyBrowser'
  | 'denyWebSearch'
  | 'denyWebFetch'
  | 'denyGateway';

export interface PromptSecurityPolicy {
  enabled: boolean;
  deniedPaths: string[];
  rules: SecurityRuleKey[];
}

export interface SecurityPolicy {
  prompt: PromptSecurityPolicy;
}

export interface SecurityRuntimeState {
  toolDeny: string[];
  activeRules: SecurityRuleKey[];
  activeManagedDeny: string[];
  expectedManagedDeny: string[];
  extraToolDeny: string[];
  managedInSync: boolean;
}

export interface SecurityPolicySnapshot {
  policy: SecurityPolicy;
  runtime: SecurityRuntimeState;
}

export interface SecurityRuleDefinition {
  key: SecurityRuleKey;
  managedDeny: string[];
  title: string;
  description: string;
}

export const SECURITY_RULE_DEFINITIONS: SecurityRuleDefinition[] = [
  {
    key: 'denyRuntime',
    managedDeny: ['group:runtime'],
    title: 'Block runtime commands',
    description: 'Deny exec, bash, and process tools.',
  },
  {
    key: 'denyWrite',
    managedDeny: ['write', 'edit', 'apply_patch'],
    title: 'Block file writes',
    description: 'Deny write, edit, and apply_patch file modifications.',
  },
  {
    key: 'denyRead',
    managedDeny: ['read'],
    title: 'Block file reads',
    description: 'Deny direct file reads from the agent tool surface.',
  },
  {
    key: 'denyBrowser',
    managedDeny: ['browser'],
    title: 'Block browser automation',
    description: 'Deny opening pages, clicking elements, filling forms, and taking browser snapshots.',
  },
  {
    key: 'denyWebSearch',
    managedDeny: ['web_search'],
    title: 'Block web search',
    description: 'Deny search-engine style web_search lookups.',
  },
  {
    key: 'denyWebFetch',
    managedDeny: ['web_fetch'],
    title: 'Block web fetch',
    description: 'Deny direct web_fetch page retrieval.',
  },
  {
    key: 'denyGateway',
    managedDeny: ['gateway'],
    title: 'Block gateway access',
    description: 'Deny direct access to the local OpenClaw gateway control surface.',
  },
];

const LEGACY_RULE_MIGRATIONS: Record<string, SecurityRuleKey[]> = {
  denyWeb: ['denyBrowser', 'denyWebSearch', 'denyWebFetch'],
};

const TOOL_NAME_ALIASES: Record<string, string> = {
  bash: 'exec',
  'apply-patch': 'apply_patch',
};

const TOOL_GROUPS: Record<string, string[]> = {
  'group:fs': ['read', 'write', 'edit', 'apply_patch'],
  'group:runtime': ['exec', 'process'],
  'group:web': ['web_search', 'web_fetch'],
};

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  prompt: {
    enabled: false,
    deniedPaths: [],
    rules: [],
  },
};

export function normalizeSecurityPath(value: string): string {
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

export function compactSecurityPaths(paths: string[]): string[] {
  const deduped = Array.from(new Set(paths.map((item) => normalizeSecurityPath(item)).filter(Boolean))).sort(
    (a, b) => a.length - b.length,
  );

  const result: string[] = [];
  for (const current of deduped) {
    const currentLower = current.toLowerCase();
    const covered = result.some((base) => {
      const baseLower = base.toLowerCase();
      return (
        currentLower === baseLower
        || currentLower.startsWith(`${baseLower}\\`)
        || currentLower.startsWith(`${baseLower}/`)
      );
    });
    if (!covered) {
      result.push(current);
    }
  }
  return result;
}

export function normalizeSecurityRules(values: unknown): SecurityRuleKey[] {
  const next = new Set<SecurityRuleKey>();
  if (!Array.isArray(values)) {
    return [];
  }
  for (const item of values) {
    if (typeof item !== 'string') continue;
    const migrated = LEGACY_RULE_MIGRATIONS[item];
    if (migrated) {
      for (const key of migrated) next.add(key);
      continue;
    }
    if (SECURITY_RULE_DEFINITIONS.some((rule) => rule.key === item)) {
      next.add(item as SecurityRuleKey);
    }
  }
  return Array.from(next);
}

export function normalizeSecurityPolicy(raw: unknown): SecurityPolicy {
  const prompt =
    raw && typeof raw === 'object' && 'prompt' in raw && raw.prompt && typeof raw.prompt === 'object'
      ? raw.prompt as Record<string, unknown>
      : {};

  const hasDeniedPaths = Array.isArray(prompt.deniedPaths);
  const deniedPaths = hasDeniedPaths
    ? (prompt.deniedPaths as unknown[]).filter((item): item is string => typeof item === 'string')
    : [];
  const rules = normalizeSecurityRules(prompt.rules);

  return {
    prompt: {
      enabled: hasDeniedPaths || rules.length > 0 ? Boolean(prompt.enabled) : false,
      deniedPaths: compactSecurityPaths(deniedPaths),
      rules,
    },
  };
}

function normalizeToolPolicyEntry(value: string): string {
  const normalized = value.trim().toLowerCase();
  return TOOL_NAME_ALIASES[normalized] ?? normalized;
}

export function normalizeToolPolicyEntries(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of values) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = normalizeToolPolicyEntry(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function expandToolPolicyEntry(value: string): string[] {
  const normalized = normalizeToolPolicyEntry(value);
  const group = TOOL_GROUPS[normalized];
  return group ? group.flatMap((item) => expandToolPolicyEntry(item)) : [normalized];
}

function matchesGlob(value: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return value === pattern;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

function isToolBlockedByDenyEntries(toolName: string, denyEntries: string[]): boolean {
  const normalizedToolName = normalizeToolPolicyEntry(toolName);
  return denyEntries.some((entry) => {
    const normalizedEntry = normalizeToolPolicyEntry(entry);
    const expandedEntries = expandToolPolicyEntry(normalizedEntry);
    return expandedEntries.some((candidate) => matchesGlob(normalizedToolName, candidate));
  });
}

function areRuleTargetsBlocked(rule: SecurityRuleDefinition, denyEntries: string[]): boolean {
  const targets = Array.from(
    new Set(rule.managedDeny.flatMap((entry) => expandToolPolicyEntry(entry))),
  );
  return targets.length > 0 && targets.every((tool) => isToolBlockedByDenyEntries(tool, denyEntries));
}

export function getManagedToolDenyForRules(rules: SecurityRuleKey[]): string[] {
  const selected = new Set(normalizeSecurityRules(rules));
  return SECURITY_RULE_DEFINITIONS.flatMap((rule) =>
    selected.has(rule.key) ? rule.managedDeny : [],
  );
}

export function mergeManagedToolDeny(
  existingToolDeny: readonly string[],
  previousRules: readonly SecurityRuleKey[],
  nextRules: readonly SecurityRuleKey[],
): string[] {
  const previousManaged = new Set(
    getManagedToolDenyForRules([...previousRules]).map((entry) => normalizeToolPolicyEntry(entry)),
  );
  const preserved = existingToolDeny.filter(
    (entry) => !previousManaged.has(normalizeToolPolicyEntry(entry)),
  );
  const nextManaged = getManagedToolDenyForRules([...nextRules]);
  return normalizeToolPolicyEntries([...preserved, ...nextManaged]);
}

export function inferSecurityRulesFromToolDeny(toolDeny: string[]): SecurityRuleKey[] {
  const normalizedDeny = Array.from(
    new Set(toolDeny.map((entry) => normalizeToolPolicyEntry(entry)).filter(Boolean)),
  );
  return SECURITY_RULE_DEFINITIONS
    .filter((rule) => areRuleTargetsBlocked(rule, normalizedDeny))
    .map((rule) => rule.key);
}

export function createSecurityRuntimeState(
  policy: SecurityPolicy,
  toolDeny: string[],
): SecurityRuntimeState {
  const normalizedToolDeny = normalizeToolPolicyEntries(toolDeny);
  const activeRules = inferSecurityRulesFromToolDeny(normalizedToolDeny);
  const expectedRules = policy.prompt.enabled ? normalizeSecurityRules(policy.prompt.rules) : [];
  const expectedManagedDeny = getManagedToolDenyForRules(expectedRules);
  const expectedSet = new Set(expectedRules);
  const activeSet = new Set(activeRules);
  const expectedManagedSet = new Set(expectedManagedDeny.map((entry) => normalizeToolPolicyEntry(entry)));
  const extraToolDeny = normalizedToolDeny.filter(
    (entry) => !expectedManagedSet.has(normalizeToolPolicyEntry(entry)),
  );
  const managedInSync =
    expectedRules.length === activeRules.length
    && expectedRules.every((rule) => activeSet.has(rule))
    && activeRules.every((rule) => expectedSet.has(rule));

  return {
    toolDeny: normalizedToolDeny,
    activeRules,
    activeManagedDeny: getManagedToolDenyForRules(activeRules),
    expectedManagedDeny,
    extraToolDeny,
    managedInSync,
  };
}

export function createSecurityPolicySnapshot(
  policy: SecurityPolicy,
  toolDeny: string[],
): SecurityPolicySnapshot {
  return {
    policy,
    runtime: createSecurityRuntimeState(policy, toolDeny),
  };
}
