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
