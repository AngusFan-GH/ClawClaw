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
