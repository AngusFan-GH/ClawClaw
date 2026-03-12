export type SecurityRuleKey =
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

export function normalizeSecurityRules(values: unknown): SecurityRuleKey[] {
  const next = new Set<SecurityRuleKey>();
  if (!Array.isArray(values)) {
    return [];
  }
  for (const item of values) {
    if (typeof item !== 'string') continue;
    if (SECURITY_RULE_DEFINITIONS.some((rule) => rule.key === item)) {
      next.add(item as SecurityRuleKey);
    }
  }
  return Array.from(next);
}
