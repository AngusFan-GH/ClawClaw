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
  reasoningEfforts?: NonNullable<LlmDiscoveredModel['reasoningEfforts']>
  api?: string
  supportsConversation?: boolean
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

export const SPIRITX_REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export function spiritXReasoningValid(efforts: SpiritXModelDraft['reasoningEfforts']): boolean {
  if (efforts === undefined || efforts === false) return true
  const entries = Object.entries(efforts)
  return entries.some(([level]) => level !== 'off') && entries.every(([level, wire]) =>
    SPIRITX_REASONING_LEVELS.some(candidate => candidate === level)
    && (level === 'off' && wire === null || typeof wire === 'string' && wire.trim().length > 0))
}

const NON_LANGUAGE_MODEL = /(?:^|[-_.])(image|embedding|embed|rerank|moderation|tts|speech|whisper|transcri(?:be|ption)|audio)(?:$|[-_.\d])/i

/** Advertised capability wins; names are only a fallback for legacy catalogs without metadata. */
export function isConversationModel(model: Pick<LlmDiscoveredModel, 'id' | 'name' | 'supportsConversation'>): boolean {
  return model.supportsConversation ?? !NON_LANGUAGE_MODEL.test(`${model.id} ${model.name ?? ''}`)
}

/** Pick the first conversational model without treating vision input as image generation. */
export function firstLanguageModel(models: readonly LlmDiscoveredModel[]): LlmDiscoveredModel | undefined {
  return models.find(isConversationModel)
}

/** Fallbacks for exact IDs returned by SpiritX's /models, which omits effort metadata.
 * GLM: https://huggingface.co/zai-org/GLM-5.3#note
 * DeepSeek: https://api-docs.deepseek.com/guides/thinking_mode/
 * Qwen: https://huggingface.co/Qwen/Qwen3.8-27B
 */
const SPIRITX_REASONING: Record<string, NonNullable<SpiritXModelDraft['reasoningEfforts']>> = {
  'glm-5.3': { low: 'low', high: 'high', max: 'max' },
  'glm-5.3-flash': { low: 'low', high: 'high', max: 'max' },
  'deepseek-v4-flash': { off: 'none', low: 'low', high: 'high', max: 'max' },
  'deepseek-v4-flash-0731': { off: 'none', low: 'low', high: 'high', max: 'max' },
  'deepseek-v4.1-flash-1017': { off: 'none', low: 'low', high: 'high', xhigh: 'xhigh', max: 'max' },
  'deepseek-v4.1-flash': { off: 'none', low: 'low', high: 'high', max: 'max' },
  'startlux-decision-v1.1-9b-instant': false,
  'qwen3guard-gen-4b': false,
  'qwen3.8-27b-fp8': { low: 'low', medium: 'medium', xhigh: 'xhigh' },
  'qwen3.8-flash-next-nvfp4': { low: 'low', medium: 'medium', xhigh: 'xhigh' },
  'qwen3.8-flash-next': { low: 'low', medium: 'medium', xhigh: 'xhigh' },
  'qwen3.8-27b': { low: 'low', medium: 'medium', xhigh: 'xhigh' },
}

function withSpiritXReasoning<T extends SpiritXModelDraft>(model: T): T {
  if (model.reasoningEfforts !== undefined
    || (model.api !== undefined && !['openai-completions', 'openai-responses'].includes(model.api))) return model
  const id = model.id.toLowerCase()
  const reasoningEfforts = Object.hasOwn(SPIRITX_REASONING, id) ? SPIRITX_REASONING[id] : undefined
  return reasoningEfforts === undefined ? model : { ...model, reasoningEfforts }
}

function profileModel(model: LlmDiscoveredModel): JsonValue {
  return {
    id: model.id,
    ...model.reasoningEfforts === undefined ? {} : { reasoningEfforts: model.reasoningEfforts },
    ...model.api === undefined ? {} : { api: model.api },
    ...model.supportsConversation === undefined ? {} : { supportsConversation: model.supportsConversation },
    name: model.name ?? model.id,
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    ...model.inputModalities === undefined ? {} : { input: [...model.inputModalities] },
  }
}

function modelValue(model: SpiritXModelDraft): JsonValue {
  return {
    id: model.id.trim(),
    ...model.reasoningEfforts === undefined ? {} : { reasoningEfforts: model.reasoningEfforts },
    ...model.api === undefined ? {} : { api: model.api },
    ...model.supportsConversation === undefined ? {} : { supportsConversation: model.supportsConversation },
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
    && models.every(isConversationModel)
    && models.every(model => spiritXReasoningValid(model.reasoningEfforts))
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
    ...value.reasoningEfforts === undefined ? {} : { reasoningEfforts: value.reasoningEfforts as NonNullable<SpiritXModelDraft['reasoningEfforts']> },
    ...typeof value.api === 'string' ? { api: value.api } : {},
    ...typeof value.supportsConversation === 'boolean' ? { supportsConversation: value.supportsConversation } : {},
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
    ? profile.models.map(modelDraft).filter((model): model is SpiritXModelDraft => model !== undefined).filter(isConversationModel)
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

/** Refresh model protocols from current gateway capabilities without replacing catalogs or valid defaults. */
export async function syncSpiritXModelProtocols(ctx: ClientContext): Promise<void> {
  const namespaces = await settingsView(ctx)
  const namespace = namespaces === undefined ? undefined : namespaceOf(namespaces, SPIRITX_SETTINGS_NS)
  const profile = namespace === undefined ? undefined : objectAt(namespace.value, ['providers', 'spiritx'])
  if (namespace === undefined || profile?.baseURL !== SPIRITX_BASE_URL || profile.api !== SPIRITX_API
    || profile.apiKeyEnv !== SPIRITX_API_KEY_REF || !Array.isArray(profile.models)) return
  const models = profile.models.map(modelDraft)
  if (models.length === 0) return
  const discovered = await fetchSpiritXModels(ctx)
  const advertised = new Map((discovered.ok ? discovered.value : []).map(model => [model.id, model]))
  const ops: SettingsPathOpView[] = []
  models.forEach((model, index) => {
    const live = model === undefined ? undefined : advertised.get(model.id)
    const reasoningEfforts = live?.reasoningEfforts ?? (model === undefined ? undefined : withSpiritXReasoning(model).reasoningEfforts)
    if (model !== undefined && model.reasoningEfforts === undefined && reasoningEfforts !== undefined) {
      ops.push({ op: 'set', path: ['providers', 'spiritx', 'models', String(index), 'reasoningEfforts'], value: reasoningEfforts })
    }
    const api = live?.api
    if (model !== undefined && live?.supportsConversation !== undefined && model.supportsConversation !== live.supportsConversation) {
      ops.push({ op: 'set', path: ['providers', 'spiritx', 'models', String(index), 'supportsConversation'], value: live.supportsConversation })
    }
    if (model !== undefined && api !== undefined && model.api !== api) {
      ops.push({ op: 'set', path: ['providers', 'spiritx', 'models', String(index), 'api'], value: api })
    }
  })
  if (ops.length > 0 && await mutate(ctx, namespace, ops) !== undefined) return
  const defaults = namespaceOf(namespaces!, 'agent-default-model')
  if (defaults !== undefined) {
    const conversational = models.filter((model): model is SpiritXModelDraft => model !== undefined)
      .map(model => {
        const capability = advertised.get(model.id)?.supportsConversation
        return capability === undefined ? model : { ...model, supportsConversation: capability }
      })
      .filter(isConversationModel)
    await repairSpiritXDefault(ctx, defaults, conversational, false)
  }
}

/** Interrogate SpiritX with a replacement key, or the stored credential when the field is blank. */
async function fetchSpiritXModels(
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
    ? { ok: true, value: discovered.value.map(withSpiritXReasoning) }
    : { ok: false, error: discovered.error.message }
}

/** Only conversational models belong in the product's chat catalog. */
export async function discoverSpiritXModels(ctx: ClientContext, rawKey?: string): Promise<SpiritXResult<LlmDiscoveredModel[]>> {
  const result = await fetchSpiritXModels(ctx, rawKey)
  return result.ok ? { ok: true, value: result.value.filter(isConversationModel) } : result
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
  const selected = firstLanguageModel(models)
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
  if (!models.every(model => spiritXReasoningValid(model.reasoningEfforts))) return '请为思考档位填写有效的请求值，并至少选择一个开启思考的档位。'
  const normalized = normalizedModels(models).map(withSpiritXReasoning)
  if (!modelCatalogValid(normalized)) return 'SpiritX 至少需要一个可用且 ID 不重复的大语言模型，且不能包含非对话模型。'
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
  const credentialState = await ctx.remote.credentials.describe([SPIRITX_API_KEY_REF])
  if (!credentialState.ok) return credentialState.error.message
  if (credentialState.value[SPIRITX_API_KEY_REF]?.writable === false) {
    return 'SpiritX API 密钥由启动环境只读提供，无法在 ClawClaw 中替换。请先移除系统环境变量 SPIRITX_API_KEY，完全退出并重新启动 ClawClaw。'
  }
  const discovered = await discoverSpiritXModels(ctx, apiKey)
  if (!discovered.ok) return discovered.error
  if (models !== undefined && !models.every(model => spiritXReasoningValid(model.reasoningEfforts))) return '请为思考档位填写有效的请求值，并至少选择一个开启思考的档位。'
  const editedModels = models !== undefined && models.length > 0
    ? normalizedModels(models)
    : undefined
  if (editedModels !== undefined && !modelCatalogValid(editedModels)) {
    return 'SpiritX 至少需要一个可用且 ID 不重复的大语言模型，且不能包含非对话模型。'
  }
  const advertised = new Map(discovered.value.map(model => [model.id, model]))
  const selectedModels = editedModels?.map(model => withSpiritXReasoning({ ...model,
    ...model.reasoningEfforts !== undefined || advertised.get(model.id)?.reasoningEfforts === undefined ? {} : { reasoningEfforts: advertised.get(model.id)!.reasoningEfforts! },
    ...advertised.get(model.id)?.api === undefined ? {} : { api: advertised.get(model.id)!.api! },
    ...advertised.get(model.id)?.supportsConversation === undefined ? {} : { supportsConversation: advertised.get(model.id)!.supportsConversation! },
  })) ?? discovered.value
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
      setupPending: false,
      apiKeyEnv: SPIRITX_API_KEY_REF,
      api: SPIRITX_API,
      baseURL: SPIRITX_BASE_URL,
      models: editedModels !== undefined
        ? selectedModels.map(modelValue)
        : discovered.value.map(profileModel),
    },
  }])
  if (profileFailure !== undefined) return profileFailure
  const defaultFailure = await repairSpiritXDefault(ctx, defaults, selectedModels, true)
  if (defaultFailure !== undefined) return defaultFailure
  const credential = await ctx.remote.credentials.set(SPIRITX_API_KEY_REF, apiKey)
  return credential.ok ? undefined : credential.error.message
}
