import JsonStore from '../host/json-store';
import { app, HostWindow, requestHandlers } from '../host/desktop';
import { emitDesktop, send } from '../host/transport';
import { ClawCoreRuntime } from './runtime';
import type { RunEvent } from './contracts';
import { CoreError, isCoreError } from './errors';
import { v, validateArgs, type Check } from './validation';
import { VENDORS } from './provider-catalog';
import { channelAccount } from './secrets/keychain';

const settings = new JsonStore<Record<string, unknown>>({
  name: 'settings',
  defaults: { setupComplete: false, autoCheckUpdate: false, theme: 'system', language: 'zh-CN' },
});

let runtime: ClawCoreRuntime;

function register(channel: string, schema: Check<unknown>[], handler: (...args: any[]) => unknown): void {
  requestHandlers.handle(channel, (_event, ...args) => {
    const valid = validateArgs(schema, args);
    return Promise.resolve()
      .then(() => handler(...valid))
      .catch((error: unknown) => {
        throw normalize(error);
      });
  });
}

function normalize(error: unknown): Error {
  if (isCoreError(error)) return new Error(error.toString());
  if (error instanceof Error) {
    // Preserve already-encoded `CODE: message` strings; wrap anything else.
    if (/^[A-Z_]+:/.test(error.message)) return error;
    return new Error(new CoreError('INTERNAL_ERROR', error.message).toString());
  }
  return new Error(new CoreError('INTERNAL_ERROR', 'Unexpected error').toString());
}

export async function initialize(): Promise<void> {
  void new HostWindow();
  runtime = new ClawCoreRuntime({
    dataDir: process.env.CLAWCLAW_DATA_DIR || app.getPath('userData'),
    onEvent: (event: RunEvent) => emit('core:run:event', event),
  });
  await runtime.initialize();
  registerMeta();
  registerProviders();
  registerAgents();
  registerSkills();
  registerArtifacts();
  registerChannels();
  registerRuns();
  registerCron();
  registerMemory();
  send({ type: 'ready', platform: process.platform });
}

export async function shutdown(): Promise<void> {
  runtime?.close();
}

function emit(channel: string, ...args: unknown[]): void {
  emitDesktop(channel, ...args);
}

function registerMeta(): void {
  register('app:version', [], () => app.getVersion());
  register('app:name', [], () => app.getName());
  register('app:platform', [], () => process.platform);
  register('app:readiness', [v.string()], async (workspaceId) => {
    const providers = runtime.providerStore.list(workspaceId);
    const def = providers.find(p => p.isDefault);
    return {
      ready: true,
      workspaceId,
      setupComplete: Boolean(settings.get('setupComplete')),
      providerCount: providers.length,
      defaultConfigured: Boolean(def && def.enabled && (def.hasSecret || !def.requiresSecret)),
      defaultAgent: Boolean(runtime.agents.getDefault(workspaceId)),
    };
  });
  register('settings:getAll', [], () => settings.store);
  register('settings:get', [v.string()], (key) => settings.get(key));
  register('settings:set', [v.string(), v.unknown()], (key, value) => settings.set(key, value));
  register('settings:setMany', [v.object()], (values) => settings.set(values as Record<string, unknown>));
  register('settings:reset', [], () => settings.clear());
}

function registerProviders(): void {
  register('provider:catalog', [], () => VENDORS.map(vv => ({
    id: vv.id, label: vv.label, category: vv.category, defaultBaseUrl: vv.defaultBaseUrl ?? '',
    protocol: vv.protocol, defaultModel: vv.defaultModel ?? '', authModes: vv.authModes,
    defaultAuthMode: vv.defaultAuthMode, requiresSecret: vv.requiresSecret, keyUrl: vv.keyUrl ?? null,
    editableBaseUrl: vv.editableBaseUrl, editableModel: vv.editableModel,
    oauthSupported: vv.oauthImplemented === true,
  })));
  register('provider:list', [v.string()], (ws) => runtime.providerStore.list(ws));
  register('provider:get', [v.string(), v.id()], (ws, id) => runtime.providerStore.get(ws, id) ?? null);
  register('provider:create', [v.string(), v.object()], (ws, input) => runtime.providerStore.create(ws, input));
  register('provider:update', [v.string(), v.id(), v.object()], (ws, id, patch) => runtime.providerStore.update(ws, id, patch));
  register('provider:delete', [v.string(), v.id()], (ws, id) => runtime.providerStore.delete(ws, id));
  register('provider:setDefault', [v.string(), v.id()], (ws, id) => runtime.providerStore.setDefault(ws, id));
  register('provider:setEnabled', [v.string(), v.id(), v.boolean()], (ws, id, enabled) => runtime.providerStore.setEnabled(ws, id, enabled));
  register('provider:hasSecret', [v.string(), v.id()], async (ws, id) => (await runtime.providerStore.getSecret(ws, id)) !== null);
  register('provider:setSecret', [v.string(), v.id(), v.string({ max: 4096 })], (ws, id, secret) => runtime.providerStore.putSecret(ws, id, secret));
  register('provider:deleteSecret', [v.string(), v.id()], (ws, id) => runtime.providerStore.deleteSecret(ws, id));
  register('provider:validate', [v.string(), v.id()], (ws, id) => runtime.validateProvider(ws, id));
}

function registerAgents(): void {
  register('agent:list', [v.string()], (ws) => runtime.agents.list(ws));
  register('agent:get', [v.string(), v.id()], (ws, id) => runtime.agents.get(ws, id) ?? null);
  register('agent:create', [v.string(), v.string({ min: 1, max: 80 })], (ws, name) => runtime.agents.create(ws, name));
  register('agent:update', [v.string(), v.id(), v.object()], (ws, id, patch) => runtime.agents.update(ws, id, patch));
  register('agent:delete', [v.string(), v.id()], (ws, id) => runtime.agents.delete(ws, id));
  register('agent:setDefault', [v.string(), v.id()], (ws, id) => runtime.agents.setDefault(ws, id));
  register('agent:bindChannel', [v.string(), v.id(), v.string(), v.string()], (ws, id, type, accountId) => runtime.agents.bind(ws, id, type, accountId));
  register('agent:unbindChannel', [v.string(), v.id(), v.string(), v.string()], (ws, id, type, accountId) => runtime.agents.unbind(ws, id, type, accountId));
}

function registerSkills(): void {
  register('skill:list', [v.string()], (ws) => runtime.skills.list(ws));
  register('skill:search', [v.string(), v.string()], (ws, query) => runtime.skills.search(ws, query));
  register('skill:get', [v.string(), v.string()], (ws, slug) => runtime.skills.get(ws, slug) ?? null);
  register('skill:install', [v.string(), v.string()], (ws, slug) => runtime.skills.install(ws, slug));
  register('skill:installFromPath', [v.string(), v.string({ max: 1024 })], (ws, path) => runtime.skills.installFromPath(ws, path));
  register('skill:uninstall', [v.string(), v.string()], (ws, slug) => runtime.skills.uninstall(ws, slug));
  register('skill:setEnabled', [v.string(), v.string(), v.boolean()], (ws, slug, enabled) => runtime.skills.setEnabled(ws, slug, enabled));
  register('skill:configure', [v.string(), v.string(), v.object()], (ws, slug, config) => runtime.skills.configure(ws, slug, config));
}

function registerArtifacts(): void {
  register('artifact:stagePaths', [v.string(), v.array(v.string({ max: 4096 }), { max: 20 })], (ws, paths) => (paths as string[]).map((p: string) => runtime.artifacts.stagePath(ws, p)));
  register('artifact:stageBuffer', [v.string(), v.string(), v.string({ max: 300 }), v.optionalString()], (ws, base64, fileName, mime) => runtime.artifacts.stageBase64(ws, base64, fileName, mime ?? undefined));
  register('artifact:list', [v.string()], (ws) => runtime.artifacts.list(ws));
  register('artifact:get', [v.string(), v.id()], (ws, id) => runtime.artifacts.get(ws, id));
  register('artifact:readImage', [v.string(), v.id()], (ws, id) => runtime.artifacts.readImageBase64(ws, id));
  register('artifact:delete', [v.string(), v.id()], (ws, id) => runtime.artifacts.delete(ws, id));
}

function registerChannels(): void {
  register('channel:catalog', [], () => runtime.channels.adapterCatalog());
  register('channel:list', [v.string()], async (ws) => {
    const accounts = runtime.channels.listAccounts(ws);
    return Promise.all(accounts.map(async (a) => ({
      ...a,
      hasSecrets: (await runtime.keychain.get(channelAccount(ws, a.id))) !== null,
    })));
  });
  register('channel:create', [v.string(), v.object()], (ws, input) => runtime.channels.createAccount(ws, input));
  register('channel:update', [v.string(), v.id(), v.object(), v.optionalObject()], (ws, id, config, secrets) => runtime.channels.updateConfig(ws, id, config, (secrets as Record<string, string>) ?? undefined));
  register('channel:connect', [v.string(), v.id()], (ws, id) => runtime.channels.connect(ws, id));
  register('channel:disconnect', [v.string(), v.id()], (ws, id) => runtime.channels.disconnect(ws, id));
  register('channel:delete', [v.string(), v.id()], (ws, id) => runtime.channels.deleteAccount(ws, id));
  register('channel:send', [v.string(), v.id(), v.string({ max: 20_000 })], (ws, id, text) => runtime.channels.send(ws, id, text));
  register('channel:startInbound', [v.string(), v.id()], (ws, id) => runtime.channels.startInbound(ws, id));
  register('channel:stopInbound', [v.string(), v.id()], (ws, id) => runtime.channels.stopInbound(ws, id));
  register('channel:ingest', [v.string(), v.id(), v.object()], (ws, id, input) => runtime.channels.ingest(ws, id, input as never));
}

function registerRuns(): void {
  register('core:chat:send', [v.object()], (input) => runtime.startChat(input));
  register('core:run:getEvents', [v.id(), v.number({ integer: true, min: 0, optional: true })], (runId, after) => runtime.getEvents(runId, after ?? 0));
  register('core:run:cancel', [v.id(), v.optionalString()], (runId, reason) => runtime.cancelRun(runId, reason ?? undefined));
  register('core:run:invocations', [v.id()], (runId) => runtime.runs.listToolInvocations(runId));
  register('core:run:resolveApproval', [v.id(), v.string(), v.boolean(), v.optionalString()], (runId, toolCallId, approved, reason) =>
    runtime.resolveToolApproval(runId, toolCallId, approved, reason ?? undefined));
  register('core:conversation:list', [v.string()], (ws) => runtime.listConversations(ws));
  register('core:conversation:page', [v.string(), v.id(), v.optionalObject()], (ws, id, opts) =>
    runtime.getConversation(ws, id, opts as { beforeSeq?: number; limit?: number } | undefined));
  register('core:conversation:rename', [v.string(), v.id(), v.string({ max: 120 })], (ws, id, title) => runtime.conversations.rename(ws, id, title));
  register('core:conversation:delete', [v.string(), v.id()], (ws, id) => runtime.deleteConversation(ws, id));
}

function registerCron(): void {
  register('cron:list', [v.string()], (ws) => runtime.cron.list(ws));
  register('cron:save', [v.object()], (input) => runtime.cron.save(input));
  register('cron:delete', [v.string(), v.id()], (ws, id) => runtime.cron.delete(ws, id));
  register('cron:setEnabled', [v.string(), v.id(), v.boolean()], (ws, id, enabled) => runtime.cron.setEnabled(ws, id, enabled));
  register('cron:trigger', [v.string(), v.id()], (ws, id) => runtime.triggerCron(ws, id));
}

function registerMemory(): void {
  register('memory:list', [v.string(), v.number({ integer: true, min: 1, max: 500, optional: true })], (ws, limit) => runtime.memory.list(ws, limit));
  register('memory:search', [v.string(), v.string(), v.number({ integer: true, min: 1, max: 50, optional: true })], (ws, query, limit) => runtime.memory.search(ws, query, limit));
  register('memory:add', [v.string(), v.object()], (ws, input) => runtime.memory.add(ws, input));
  register('memory:update', [v.string(), v.id(), v.object()], (ws, id, patch) => runtime.memory.update(ws, id, patch));
  register('memory:delete', [v.string(), v.id()], (ws, id) => runtime.memory.delete(ws, id));
  register('summary:latest', [v.string(), v.id()], (ws, conv) => runtime.memory.latestSummary(ws, conv) ?? null);
}
