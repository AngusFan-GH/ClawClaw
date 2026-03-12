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

const SECURITY_RULE_KEY_SET = new Set<string>(SECURITY_RULE_DEFINITIONS.map((rule) => rule.key));

export function isSecurityRuleKey(value: unknown): value is SecurityRuleKey {
  return typeof value === 'string' && SECURITY_RULE_KEY_SET.has(value);
}

export function normalizeSecurityRules(values: unknown): SecurityRuleKey[] {
  if (!Array.isArray(values)) return [];
  const next = new Set<SecurityRuleKey>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const migrated = LEGACY_RULE_MIGRATIONS[value];
    if (migrated) {
      for (const key of migrated) next.add(key);
      continue;
    }
    if (isSecurityRuleKey(value)) next.add(value);
  }
  return Array.from(next);
}

export function getSecurityRuleDefinition(key: SecurityRuleKey): SecurityRuleDefinition | undefined {
  return SECURITY_RULE_DEFINITIONS.find((rule) => rule.key === key);
}

export function getManagedToolDenyForRules(rules: SecurityRuleKey[]): string[] {
  const managed = new Set<string>();
  for (const key of normalizeSecurityRules(rules)) {
    const rule = getSecurityRuleDefinition(key);
    if (!rule) continue;
    for (const entry of rule.managedDeny) {
      managed.add(entry);
    }
  }
  return [...managed];
}
