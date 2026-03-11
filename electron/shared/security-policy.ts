export type SecurityRuleKey =
  | 'lockPolicy'
  | 'denyRuntime'
  | 'denyWrite'
  | 'denyRead'
  | 'denyWeb';

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
    key: 'lockPolicy',
    managedDeny: ['group:runtime', 'write', 'edit', 'apply_patch'],
    title: 'Lock security policy',
    description: 'Recommended baseline that blocks command execution and file modifications.',
  },
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
    key: 'denyWeb',
    managedDeny: ['group:web', 'browser'],
    title: 'Block web access',
    description: 'Deny browser, web_search, and web_fetch access.',
  },
];

const SECURITY_RULE_KEY_SET = new Set<string>(SECURITY_RULE_DEFINITIONS.map((rule) => rule.key));

export function isSecurityRuleKey(value: unknown): value is SecurityRuleKey {
  return typeof value === 'string' && SECURITY_RULE_KEY_SET.has(value);
}

export function normalizeSecurityRules(values: unknown): SecurityRuleKey[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.filter(isSecurityRuleKey)));
}

export function normalizeLinkedSecurityRules(values: unknown): SecurityRuleKey[] {
  const next = new Set<SecurityRuleKey>(normalizeSecurityRules(values));
  const hasRuntime = next.has('denyRuntime');
  const hasWrite = next.has('denyWrite');

  if (next.has('lockPolicy')) {
    next.add('denyRuntime');
    next.add('denyWrite');
  }

  if (hasRuntime && hasWrite) {
    next.add('lockPolicy');
  } else if (!next.has('lockPolicy')) {
    next.delete('lockPolicy');
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
