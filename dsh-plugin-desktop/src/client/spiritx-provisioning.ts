/** Verify a SpiritX credential, materialize its catalog, and select its first language model. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { LlmDiscoveredModel, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export const SPIRITX_API_KEY_REF = 'SPIRITX_API_KEY'
export const SPIRITX_BASE_URL = 'https://ai.xzinfra.com/spiritx-api/v1'
export const SPIRITX_API = 'openai-responses'
export const SPIRITX_SETTINGS_NS = 'llm-pi-ai'

export interface SpiritXModelDraft {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: string[]
}

export interface SpiritXProfileDraft {
  baseURL: string
  models: SpiritXModelDraft[]
}

export type SpiritXResult<T> = { ok: true; value: T } | { ok: false; error: string }

const NON_LANGUAGE_MODEL = /(?:^|[-_.])(image|embedding|embed|rerank|moderation|tts|speech|whisper|transcri(?:be|ption)|audio)(?:$|[-_.\d])/i

/** Pick the first returned generative language model while excluding dedicated media and ranking models. */
export function firstLanguageModel(models: readonly LlmDiscoveredModel[]): LlmDiscoveredModel | undefined {
  return models.find(model => !NON_LANGUAGE_MODEL.test(`${model.id} ${model.name ?? ''}`))
}

function profileModel(model: LlmDiscoveredModel): JsonValue {
  return {
    id: model.id,
    name: model.name ?? model.id,
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    ...model.inputModalities === undefined ? {} : { input: [...model.inputModalities] },
  }
}

function modelValue(model: SpiritXModelDraft): JsonValue {
  return {
    id: model.id.trim(),
    ...model.name === undefined ? {} : { name: model.name },
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    ...model.input === undefined ? {} : { input: [...model.input] },
  }
}

function normalizedModels(models: readonly SpiritXModelDraft[]): SpiritXModelDraft[] {
  return models.map(model => ({ ...model, id: model.id.trim() }))
}

function modelCatalogValid(models: readonly SpiritXModelDraft[]): boolean {
  const ids = models.map(model => model.id)
  return ids.length > 0
    && ids.every(id => id.length > 0)
    && new Set(ids).size === ids.length
    && firstLanguageModel(models) !== undefined
}

function objectAt(value: JsonValue | undefined, path: readonly string[]): Record<string, JsonValue> | undefined {
  let current: JsonValue | undefined = value
  for (const part of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = current[part]
  }
  return typeof current === 'object' && current !== null && !Array.isArray(current)
    ? current as Record<string, JsonValue>
    : undefined
}

function modelDraft(value: JsonValue): SpiritXModelDraft | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const id = value.id
  if (typeof id !== 'string') return undefined
  return {
    id,
    ...typeof value.name === 'string' ? { name: value.name } : {},
    ...typeof value.contextWindow === 'number' ? { contextWindow: value.contextWindow } : {},
    ...typeof value.maxTokens === 'number' ? { maxTokens: value.maxTokens } : {},
    ...Array.isArray(value.input) && value.input.every(item => typeof item === 'string')
      ? { input: [...value.input] as string[] }
      : {},
  }
}

function namespaceOf(namespaces: readonly SettingsNamespaceView[], ns: string): SettingsNamespaceView | undefined {
  return namespaces.find(namespace => namespace.ns === ns)
}

async function mutate(
  ctx: ClientContext,
  namespace: SettingsNamespaceView,
  ops: SettingsPathOpView[],
): Promise<string | undefined> {
  const response = await ctx.remote.settings.mutate(namespace.ns, ops, namespace.revision)
  return response.ok ? undefined : response.error.message
}

async function settingsView(ctx: ClientContext): Promise<readonly SettingsNamespaceView[] | undefined> {
  const mirror = ctx.configForms.describe()
  await mirror.ensure()
  return mirror.getSnapshot().view?.namespaces
}

/** Read the effective built-in profile shown by the Models editor. */
export async function loadSpiritXProfile(ctx: ClientContext): Promise<SpiritXResult<SpiritXProfileDraft>> {
  const namespaces = await settingsView(ctx)
  const spiritx = namespaces === undefined ? undefined : namespaceOf(namespaces, SPIRITX_SETTINGS_NS)
  if (spiritx === undefined) return { ok: false, error: '模型配置暂不可用，请稍后重试。' }
  const profile = objectAt(spiritx.value, ['providers', 'spiritx'])
  const models = Array.isArray(profile?.models)
    ? profile.models.map(modelDraft).filter((model): model is SpiritXModelDraft => model !== undefined)
    : []
  return {
    ok: true,
    value: {
      baseURL: typeof profile?.baseURL === 'string' ? profile.baseURL : SPIRITX_BASE_URL,
      models,
    },
  }
}

/** Whether the product route has enough persisted configuration to resolve a language model. */
export async function hasUsableSpiritXProfile(ctx: ClientContext): Promise<boolean> {
  const namespaces = await settingsView(ctx)
  const spiritx = namespaces === undefined ? undefined : namespaceOf(namespaces, SPIRITX_SETTINGS_NS)
  const profile = spiritx === undefined ? undefined : objectAt(spiritx.value, ['providers', 'spiritx'])
  if (profile?.apiKeyEnv !== SPIRITX_API_KEY_REF || profile.api !== SPIRITX_API) return false
  if (typeof profile.baseURL !== 'string' || profile.baseURL.trim().length === 0 || !Array.isArray(profile.models)) return false
  const models = profile.models.map(modelDraft).filter((model): model is SpiritXModelDraft => model !== undefined)
  return firstLanguageModel(models.filter(model => model.id.trim().length > 0)) !== undefined
}

/** Interrogate SpiritX with a replacement key, or the stored credential when the field is blank. */
export async function discoverSpiritXModels(
  ctx: ClientContext,
  rawKey?: string,
): Promise<SpiritXResult<LlmDiscoveredModel[]>> {
  const apiKey = rawKey?.trim() ?? ''
  const discovered = await ctx.remote.llm.discoverModels(SPIRITX_SETTINGS_NS, {
    provider: 'spiritx',
    baseURL: SPIRITX_BASE_URL,
    api: SPIRITX_API,
    ...apiKey.length === 0 ? {} : { apiKey },
  })
  return discovered.ok
    ? { ok: true, value: [...discovered.value] }
    : { ok: false, error: discovered.error.message }
}

async function repairSpiritXDefault(
  ctx: ClientContext,
  defaults: SettingsNamespaceView,
  models: readonly LlmDiscoveredModel[] | readonly SpiritXModelDraft[],
  force: boolean,
): Promise<string | undefined> {
  const value = defaults.value
  const provider = objectAt(value, [])?.provider
  const model = objectAt(value, [])?.model
  const ids = new Set(models.map(item => item.id))
  if (!force && provider !== 'spiritx') return undefined
  if (!force && typeof model === 'string' && ids.has(model)) return undefined
  const selected = firstLanguageModel(models.map(item => ({
    id: item.id,
    ...item.name === undefined ? {} : { name: item.name },
  })))
  if (selected === undefined) return 'SpiritX 未返回可用的大语言模型。'
  return mutate(ctx, defaults, [
    { op: 'set', path: ['provider'], value: 'spiritx' },
    { op: 'set', path: ['model'], value: selected.id },
    { op: 'unset', path: ['reasoningEffort'] },
  ])
}

/** Save hand-edited models without requiring the user to re-enter an existing key. */
export async function saveSpiritXModels(
  ctx: ClientContext,
  models: readonly SpiritXModelDraft[],
): Promise<string | undefined> {
  const normalized = normalizedModels(models)
  if (!modelCatalogValid(normalized)) return 'SpiritX 至少需要一个可用且 ID 不重复的大语言模型。'
  const namespaces = await settingsView(ctx)
  const spiritx = namespaces === undefined ? undefined : namespaceOf(namespaces, SPIRITX_SETTINGS_NS)
  const defaults = namespaces === undefined ? undefined : namespaceOf(namespaces, 'agent-default-model')
  if (spiritx === undefined || defaults === undefined) return '模型配置暂不可用，请稍后重试。'
  const failure = await mutate(ctx, spiritx, [{
    op: 'set', path: ['providers', 'spiritx', 'models'], value: normalized.map(modelValue),
  }])
  if (failure !== undefined) return failure
  return repairSpiritXDefault(ctx, defaults, normalized, false)
}

/** Complete the shared validation flow used by the Models card and first-run onboarding. */
export async function provisionSpiritX(
  ctx: ClientContext,
  rawKey: string,
  models?: readonly SpiritXModelDraft[],
): Promise<string | undefined> {
  const apiKey = rawKey.trim()
  if (apiKey.length === 0) return '请输入 SpiritX API 密钥。'
  const discovered = await discoverSpiritXModels(ctx, apiKey)
  if (!discovered.ok) return discovered.error
  const editedModels = models !== undefined && models.length > 0
    ? normalizedModels(models)
    : undefined
  if (editedModels !== undefined && !modelCatalogValid(editedModels)) {
    return 'SpiritX 至少需要一个可用且 ID 不重复的大语言模型。'
  }
  const selectedModels = editedModels ?? discovered.value
  const selected = firstLanguageModel(selectedModels)
  if (selected === undefined) return 'SpiritX 未返回可用的大语言模型。'

  const namespaces = await settingsView(ctx)
  const spiritx = namespaces === undefined ? undefined : namespaceOf(namespaces, SPIRITX_SETTINGS_NS)
  const defaults = namespaces === undefined ? undefined : namespaceOf(namespaces, 'agent-default-model')
  if (spiritx === undefined || defaults === undefined) return '模型配置暂不可用，请稍后重试。'

  const profileFailure = await mutate(ctx, spiritx, [{
    op: 'set',
    path: ['providers', 'spiritx'],
    value: {
      displayName: 'SpiritX',
      apiKeyEnv: SPIRITX_API_KEY_REF,
      api: SPIRITX_API,
      baseURL: SPIRITX_BASE_URL,
      models: editedModels !== undefined
        ? editedModels.map(modelValue)
        : discovered.value.map(profileModel),
    },
  }])
  if (profileFailure !== undefined) return profileFailure
  const defaultFailure = await repairSpiritXDefault(ctx, defaults, selectedModels, true)
  if (defaultFailure !== undefined) return defaultFailure
  const credential = await ctx.remote.credentials.set(SPIRITX_API_KEY_REF, apiKey)
  return credential.ok ? undefined : credential.error.message
}
