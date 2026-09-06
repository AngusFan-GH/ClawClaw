import JsonStore from '../host/json-store';
import { app, HostWindow, requestHandlers } from '../host/desktop';
import { emitDesktop, send } from '../host/transport';
import { ClawCoreRuntime } from './runtime';
import type { CoreProvider } from './provider-store';

const settings = new JsonStore<Record<string, unknown>>({ name: 'settings', defaults: {
  setupComplete: false, autoCheckUpdate: false, theme: 'system', language: 'zh-CN',
} });
const runtime = new ClawCoreRuntime(event => emitDesktop('core:run:event', event));

function providerView(provider: CoreProvider) {
  return { ...provider, hasKey: runtime.providerStore.hasApiKey(provider.id), keyMasked: null };
}
function register(channel: string, handler: (...args: any[]) => unknown) { requestHandlers.handle(channel, (_event, ...args) => handler(...args)); }

export async function initialize(): Promise<void> {
  void new HostWindow();
  await runtime.initialize();
  register('app:version', () => app.getVersion());
  register('app:name', () => app.getName());
  register('app:platform', () => process.platform);
  register('settings:getAll', () => settings.store);
  register('settings:get', (key: string) => settings.get(key));
  register('settings:set', (key: string, value: unknown) => settings.set(key, value));
  register('settings:setMany', (values: Record<string, unknown>) => settings.set(values));
  register('settings:reset', () => settings.clear());
  register('core:run:create', (input) => runtime.runs.create(input));
  register('core:run:getEvents', (runId: string, afterSequence?: number) => runtime.runs.eventLog(runId, afterSequence));
  register('core:run:cancel', (runId: string, reason?: string) => runtime.cancelRun(runId, reason));
  register('core:run:resolveToolApproval', (runId: string, approved: boolean) => runtime.resolveToolApproval(runId, approved));
  register('core:chat:send', (input) => runtime.startChat(input));
  register('core:conversation:messages', (workspaceId: string, conversationId: string) => runtime.getConversation(workspaceId, conversationId));
  register('core:conversation:list', (workspaceId: string) => runtime.listConversations(workspaceId));
  register('core:conversation:delete', (workspaceId: string, conversationId: string) => runtime.deleteConversation(workspaceId, conversationId));
  register('cron:list', () => runtime.cron.list());
  register('cron:save', (job) => runtime.cron.save(job));
  register('cron:delete', (id: string) => runtime.cron.delete(id));
  register('cron:trigger', (id: string) => runtime.triggerCron(id));
  register('agent:list', () => runtime.agents.list());
  register('agent:create', (name: string) => runtime.agents.create(name));
  register('agent:update', (id: string, updates: { name?: string; model?: string | null; isDefault?: boolean }) => { const old = runtime.agents.get(id); if (!old) throw new Error('Agent not found'); return runtime.agents.save({ ...old, ...updates, model: updates.model ?? undefined, name: updates.name ?? old.name }); });
  register('agent:delete', (id: string) => runtime.agents.delete(id));
  register('agent:bindChannel', (id: string, channelType: string, accountId?: string) => runtime.agents.bind(id, channelType, accountId));
  register('agent:unbindChannel', (id: string, channelType: string, accountId?: string) => runtime.agents.unbind(id, channelType, accountId));
  register('skill:list', () => runtime.skills.list());
  register('skill:search', (query: string) => runtime.skills.search(query));
  register('skill:install', (slug: string) => runtime.skills.install(slug));
  register('skill:uninstall', (slug: string) => runtime.skills.uninstall(slug));
  register('skill:setEnabled', (id: string, enabled: boolean) => runtime.skills.setEnabled(id, enabled));
  register('artifact:stagePaths', (paths: string[]) => runtime.artifacts.stagePaths(paths));
  register('artifact:stageBuffer', (base64: string, fileName: string, mimeType: string) => runtime.artifacts.stageBuffer(base64, fileName, mimeType));
  register('provider:list', () => runtime.providerStore.list().map(providerView));
  register('provider:get', (id: string) => { const provider = runtime.providerStore.get(id); return provider && providerView(provider); });
  register('provider:getDefault', () => runtime.providerStore.getDefault());
  register('provider:hasApiKey', (id: string) => runtime.providerStore.hasApiKey(id));
  register('provider:save', (provider: CoreProvider) => providerView(runtime.providerStore.save(provider)));
  register('provider:setApiKey', async (id: string, apiKey: string) => runtime.providerStore.setApiKey(id, apiKey));
  register('provider:updateWithKey', async (provider: CoreProvider, apiKey?: string) => { const saved = runtime.providerStore.save(provider); if (apiKey) await runtime.providerStore.setApiKey(saved.id, apiKey); return providerView(saved); });
  register('provider:deleteApiKey', async (id: string) => runtime.providerStore.deleteApiKey(id));
  register('provider:delete', async (id: string) => runtime.providerStore.delete(id));
  register('provider:setDefault', (id: string) => runtime.providerStore.setDefault(id));
  register('app:request', async (request: { module: string; action: string; payload?: unknown }) => {
    const channel = `${request.module}:${request.action}`;
    try {
      const args = Array.isArray(request.payload) ? request.payload : request.payload === undefined ? [] : [request.payload];
      // Unified IPC is deliberately a small allowlist; it never exposes arbitrary backend calls.
      const supported = new Set(['app:version', 'app:name', 'app:platform', 'settings:getAll', 'settings:get', 'settings:set', 'settings:setMany', 'settings:reset', 'provider:list', 'provider:get', 'provider:getDefault', 'provider:hasApiKey', 'provider:save', 'provider:setApiKey', 'provider:updateWithKey', 'provider:deleteApiKey', 'provider:delete', 'provider:setDefault', 'agent:list', 'agent:create', 'agent:update', 'agent:delete', 'agent:bindChannel', 'agent:unbindChannel', 'skill:list', 'skill:search', 'skill:install', 'skill:uninstall', 'skill:setEnabled']);
      if (!supported.has(channel)) throw new Error(`APP_REQUEST_UNSUPPORTED:${channel}`);
      const { dispatch } = await import('../host/transport');
      return { ok: true, data: await dispatch(channel, args) };
    } catch (error) { return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }; }
  });
  send({ type: 'ready', platform: process.platform });
}

export async function shutdown(): Promise<void> { runtime.close(); }
