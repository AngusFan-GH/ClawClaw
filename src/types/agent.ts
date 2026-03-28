export interface AgentIdentitySummary {
  name?: string;
  theme?: string;
  emoji?: string;
  avatar?: string;
  avatarUrl?: string;
}

export interface GatewayAgentSummary {
  id: string;
  name: string;
  identity?: AgentIdentitySummary;
  isDefault: boolean;
}

export interface BoundChannelAccountSummary {
  channelType: string;
  accountId: string;
  isDefaultAccount: boolean;
}

export interface LocalAgentExtras {
  workspace: string;
  agentDir: string;
  modelDisplay: string;
  modelRef?: string;
  inheritedModel: boolean;
  boundChannels: string[];
  boundChannelAccounts: BoundChannelAccountSummary[];
}

export interface AgentSummary {
  gateway: GatewayAgentSummary;
  local: LocalAgentExtras;
}

export interface LocalAgentSnapshot {
  id: string;
  name: string;
  isDefault: boolean;
  modelDisplay: string;
  modelRef?: string;
  inheritedModel: boolean;
  workspace: string;
  agentDir: string;
  channelTypes: string[];
  channelBindings: BoundChannelAccountSummary[];
}

export interface AgentsSnapshot {
  agents: LocalAgentSnapshot[];
  defaultAgentId: string;
  mainKey?: string;
  scope?: string;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
}
