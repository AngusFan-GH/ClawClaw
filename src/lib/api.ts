import { invoke } from './ipc';
import type {
  Agent, Artifact, ChannelAccount, ChannelAdapterMeta, ConversationSummary, CronJob, MemoryItem,
  MessagePage, Provider, Readiness, RunEvent, Skill, ToolInvocation, Vendor,
} from './types';

const WS = 'default';

export const api = {
  // meta / settings
  appVersion: () => invoke<string>('app:version'),
  readiness: () => invoke<Readiness>('app:readiness', WS),
  settings: {
    getAll: () => invoke<Record<string, unknown>>('settings:getAll'),
    set: (key: string, value: unknown) => invoke('settings:set', key, value),
  },

  // providers
  providerCatalog: () => invoke<Vendor[]>('provider:catalog'),
  providers: () => invoke<Provider[]>('provider:list', WS),
  createProvider: (input: unknown) => invoke<Provider>('provider:create', WS, input),
  updateProvider: (id: string, patch: unknown) => invoke<Provider>('provider:update', WS, id, patch),
  deleteProvider: (id: string) => invoke('provider:delete', WS, id),
  setDefaultProvider: (id: string) => invoke<Provider>('provider:setDefault', WS, id),
  setProviderEnabled: (id: string, enabled: boolean) => invoke<Provider>('provider:setEnabled', WS, id, enabled),
  setProviderSecret: (id: string, secret: string) => invoke<Provider>('provider:setSecret', WS, id, secret),
  deleteProviderSecret: (id: string) => invoke<Provider>('provider:deleteSecret', WS, id),
  validateProvider: (id: string) => invoke<{ ok: boolean; code?: string; message?: string }>('provider:validate', WS, id),

  // agents
  agents: () => invoke<Agent[]>('agent:list', WS),
  createAgent: (name: string) => invoke<Agent>('agent:create', WS, name),
  updateAgent: (id: string, patch: unknown) => invoke<Agent>('agent:update', WS, id, patch),
  deleteAgent: (id: string) => invoke('agent:delete', WS, id),
  setDefaultAgent: (id: string) => invoke<Agent>('agent:setDefault', WS, id),
  bindChannel: (id: string, type: string, accountId: string) => invoke<Agent>('agent:bindChannel', WS, id, type, accountId),
  unbindChannel: (id: string, type: string, accountId: string) => invoke<Agent>('agent:unbindChannel', WS, id, type, accountId),

  // skills
  skills: () => invoke<Skill[]>('skill:list', WS),
  searchSkills: (q: string) => invoke<Skill[]>('skill:search', WS, q),
  setSkillEnabled: (slug: string, enabled: boolean) => invoke<Skill>('skill:setEnabled', WS, slug, enabled),
  configureSkill: (slug: string, config: Record<string, unknown>) => invoke<Skill>('skill:configure', WS, slug, config),
  installSkill: (slug: string) => invoke<Skill>('skill:install', WS, slug),
  installSkillFromPath: (path: string) => invoke<Skill>('skill:installFromPath', WS, path),
  uninstallSkill: (slug: string) => invoke('skill:uninstall', WS, slug),

  // artifacts
  stagePaths: (paths: string[]) => invoke<Artifact[]>('artifact:stagePaths', WS, paths),
  stageBuffer: (base64: string, fileName: string, mime?: string) => invoke<Artifact>('artifact:stageBuffer', WS, base64, fileName, mime ?? null),
  artifacts: () => invoke<Artifact[]>('artifact:list', WS),
  readImage: (id: string) => invoke<{ dataUrl: string }>('artifact:readImage', WS, id),
  deleteArtifact: (id: string) => invoke('artifact:delete', WS, id),

  // channels
  channelCatalog: () => invoke<ChannelAdapterMeta[]>('channel:catalog'),
  channels: () => invoke<ChannelAccount[]>('channel:list', WS),
  createChannel: (input: unknown) => invoke<ChannelAccount>('channel:create', WS, input),
  updateChannel: (id: string, config: Record<string, unknown>, secrets?: Record<string, string>) =>
    invoke<ChannelAccount>('channel:update', WS, id, config, secrets),
  connectChannel: (id: string) => invoke<ChannelAccount>('channel:connect', WS, id),
  disconnectChannel: (id: string) => invoke<ChannelAccount>('channel:disconnect', WS, id),
  deleteChannel: (id: string) => invoke('channel:delete', WS, id),
  sendChannel: (id: string, text: string) =>
    invoke<{ delivered: boolean; providerMessageId?: string }>('channel:send', WS, id, text),
  startInbound: (id: string) => invoke('channel:startInbound', WS, id),
  stopInbound: (id: string) => invoke('channel:stopInbound', WS, id),
  ingest: (id: string, input: unknown) =>
    invoke<{ routed: boolean; runId?: string; conversationId?: string; reason?: string }>('channel:ingest', WS, id, input),

  // runs / conversations
  send: (input: unknown) => invoke<{ run: { id: string; conversationId: string; status: string }; created: boolean }>('core:chat:send', input),
  events: (runId: string, after = 0) => invoke<RunEvent[]>('core:run:getEvents', runId, after),
  cancelRun: (runId: string, reason?: string) => invoke('core:run:cancel', runId, reason),
  resolveApproval: (runId: string, toolCallId: string, approved: boolean, reason?: string) =>
    invoke('core:run:resolveApproval', runId, toolCallId, approved, reason ?? null),
  invocations: (runId: string) => invoke<ToolInvocation[]>('core:run:invocations', runId),
  conversations: () => invoke<ConversationSummary[]>('core:conversation:list', WS),
  conversationPage: (id: string, opts?: { beforeSeq?: number; limit?: number }) =>
    invoke<MessagePage>('core:conversation:page', WS, id, opts ?? {}),
  renameConversation: (id: string, title: string) => invoke('core:conversation:rename', WS, id, title),
  deleteConversation: (id: string) => invoke('core:conversation:delete', WS, id),

  // cron
  cron: () => invoke<CronJob[]>('cron:list', WS),
  saveCron: (input: unknown) => invoke<CronJob>('cron:save', input),
  deleteCron: (id: string) => invoke('cron:delete', WS, id),
  setCronEnabled: (id: string, enabled: boolean) => invoke<CronJob>('cron:setEnabled', WS, id, enabled),
  triggerCron: (id: string) => invoke('cron:trigger', WS, id),

  // memory
  memories: () => invoke<MemoryItem[]>('memory:list', WS),
  searchMemories: (q: string) => invoke<MemoryItem[]>('memory:search', WS, q),
  addMemory: (input: unknown) => invoke<MemoryItem>('memory:add', WS, input),
  deleteMemory: (id: string) => invoke('memory:delete', WS, id),
};
