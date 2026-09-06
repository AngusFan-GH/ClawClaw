// Renderer-facing mirrors of the ClawCore views (non-secret only).

export interface Provider {
  id: string;
  workspaceId: string;
  vendorId: string;
  label: string;
  authMode: 'api_key' | 'oauth_device' | 'oauth_browser' | 'local';
  baseUrl?: string;
  apiProtocol: string;
  model?: string;
  enabled: boolean;
  isDefault: boolean;
  hasSecret: boolean;
  category: 'official' | 'compatible' | 'local' | 'custom';
  requiresSecret: boolean;
  oauthSupported: boolean;
  editableBaseUrl: boolean;
  editableModel: boolean;
  keyUrl?: string;
  defaultModel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Vendor {
  id: string;
  label: string;
  category: string;
  defaultBaseUrl: string;
  protocol: string;
  defaultModel: string;
  authModes: string[];
  defaultAuthMode: string;
  requiresSecret: boolean;
  keyUrl: string | null;
  editableBaseUrl: boolean;
  editableModel: boolean;
  oauthSupported: boolean;
}

export interface ChannelBinding {
  channelType: string;
  accountId: string;
}

export interface Agent {
  id: string;
  workspaceId: string;
  name: string;
  systemPrompt: string;
  providerId: string | null;
  model: string | null;
  toolPolicy: { allowedTools: string[]; requireApproval: boolean; maxArtifactReadBytes: number; maxListEntries: number };
  memoryPolicy: { enabled: boolean; maxItems: number; summaryThresholdTokens: number };
  budget: { maxTurns: number; maxToolCalls: number; maxWallTimeMs: number; maxInputTokens: number; maxOutputTokens: number };
  bindings: ChannelBinding[];
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Skill {
  id: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  source: 'bundled' | 'local';
  enabled: boolean;
  installedOnDisk: boolean;
  tools: string[];
  configurable: boolean;
  config: Record<string, unknown>;
}

export interface Artifact {
  id: string;
  workspaceId: string;
  displayName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  kind: 'image' | 'doc' | 'file';
  width?: number;
  height?: number;
  createdAt: string;
  updatedAt: string;
}

export type ChannelStatus = 'unconfigured' | 'configured' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface ChannelAdapterMeta {
  type: string;
  label: string;
  supported: boolean;
  unsupportedReason?: string;
  capability: { outbound: boolean; inbound: boolean; auth: string };
  configFields: Array<{ key: string; label: string; type: string; required?: boolean; placeholder?: string }>;
  secretFields: Array<{ key: string; label: string; type: string; required?: boolean }>;
}

export interface ChannelAccount {
  id: string;
  workspaceId: string;
  adapter: string;
  displayName: string;
  status: ChannelStatus;
  config: Record<string, unknown>;
  capabilities: { outbound: boolean; inbound: boolean; auth: string };
  supported: boolean;
  unsupportedReason?: string;
  inboundStarted: boolean;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  connectedAt?: string;
  lastActivityAt?: string;
  hasSecrets: boolean;
}

export interface CronJob {
  id: string;
  workspaceId: string;
  name: string;
  message: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  agentId?: string;
  delivery?: { channelType?: string; accountId?: string };
  sessionTarget?: string;
  lastRunAt?: string;
  lastStatus?: 'success' | 'error';
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryItem {
  id: string;
  workspaceId: string;
  content: string;
  tags: string[];
  sourceConversationId?: string;
  retrievalVersion: number;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus = 'queued' | 'preparing' | 'streaming' | 'waiting_for_approval' | 'stopping' | 'completed' | 'failed' | 'cancelled';

export interface RunEvent {
  eventId: string;
  runId: string;
  sequence: number;
  type: string;
  occurredAt: string;
  payload: unknown;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  lastMessagePreview: string;
  messageCount: number;
}

export interface Message {
  id: string;
  workspaceId: string;
  conversationId: string;
  runId?: string;
  seq: number;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
  artifactIds?: string[];
}

export interface MessagePage {
  messages: Message[];
  oldestSeq?: number;
  hasMore: boolean;
}

export interface ToolInvocation {
  id: string;
  toolCallId: string;
  runId: string;
  toolName: string;
  toolVersion: number;
  argsDigest: string;
  argsSummary: Record<string, unknown>;
  risk: 'low' | 'medium' | 'high';
  approvalPolicy: 'auto' | 'always';
  status: 'requested' | 'approved' | 'denied' | 'running' | 'completed' | 'failed';
  approver?: string | null;
  denialReason?: string | null;
  resultSummary?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface Readiness {
  ready: boolean;
  workspaceId: string;
  setupComplete: boolean;
  providerCount: number;
  defaultConfigured: boolean;
  defaultAgent: boolean;
}
