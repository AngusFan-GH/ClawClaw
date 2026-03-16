export interface AgentIdentitySummary {
  name?: string;
  theme?: string;
  emoji?: string;
  avatar?: string;
  avatarUrl?: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  identity?: AgentIdentitySummary;
  isDefault: boolean;
  modelDisplay: string;
  inheritedModel: boolean;
  workspace: string;
  agentDir: string;
  channelTypes: string[];
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  mainKey?: string;
  scope?: string;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
}
