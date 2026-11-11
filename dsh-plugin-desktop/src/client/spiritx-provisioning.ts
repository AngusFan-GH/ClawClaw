/** Verify a SpiritX credential, materialize its catalog, and select its first language model. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { LlmDiscoveredModel, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { isSpiritXConversationModel, withSpiritXModelPurpose, SPIRITX_MODEL_PURPOSES, type SpiritXModelPurpose } from './spiritx-model-purpose.ts'
import { reasoningMode, reasoningConfigError, validReasoningId, automaticReasoningPreset, inferAutomaticReasoning, type ReasoningConfiguration } from '@deepseek-ai/dsh-client-ui-settings-models/reasoning-config'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export const SPIRITX_API_KEY_REF = 'SPIRITX_API_KEY'
export const SPIRITX_BASE_URL = 'https://ai.xzinfra.com/spiritx-api/v1'
export const SPIRITX_API = 'openai-responses'
export const SPIRITX_SETTINGS_NS = 'llm-pi-ai'

export interface SpiritXModelDraft extends ReasoningConfiguration {
  id: string
  reasoningEfforts?: NonNullable<LlmDiscoveredModel['reasoningEfforts']>
  api?: string
  supportsConversation?: boolean
  purpose?: SpiritXModelPurpose
  modelType?: string
  supportedEndpointPaths?: string[]
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

export function spiritXReasoningConfigValid(model: SpiritXModelDraft): boolean {
  return reasoningConfigError(inferAutomaticReasoning(model)) === undefined
}

/** Use the same purpose policy for discovery, edited catalogs, defaults and runtime flags. */
export const isConversationModel = isSpiritXConversationModel

/** Pick the first conversational model without treating vision input as image generation. */
export function firstLanguageModel(models: readonly LlmDiscoveredModel[]): LlmDiscoveredModel | undefined {
  return models.find(isConversationModel)
}

/** Materialize automatic capabilities separately from the user's override mode. */
function withSpiritXReasoning<T extends SpiritXModelDraft>(model: T, discovered?: LlmDiscoveredModel): T {
  const mode = reasoningMode(model)
  if (mode === 'disabled') return model.reasoningMode === 'disabled' ? { ...model, reasoningEfforts: false, defaultReasoningEffort: null } : model
  if (mode === 'custom') return model
  if (model.api !== undefined && !['openai-completions', 'openai-responses'].includes(model.api)) return model
  const preset = automaticReasoningPreset(model.id)
  const { reasoningEfforts: _previous, ...automatic } = model
  const efforts = discovered?.reasoningEfforts
    ?? preset?.efforts
    ?? model.reasoningEfforts
  if (efforts === undefined && model.reasoningMode === undefined) return model
  const next = {
    ...automatic,
    ...discovered?.reasoningEfforts === undefined ? {} : { reasoningMappings: discovered.reasoningMappings },
    ...model.defaultReasoningEffort === undefined && discovered?.defaultReasoningEffort !== undefined
      ? { defaultReasoningEffort: discovered.defaultReasoningEffort } : {},
    reasoningMode: 'auto',
    ...efforts === undefined ? {} : { reasoningEfforts: efforts },
  } as T
  if (efforts && next.defaultReasoningEffort === undefined) {
    const recommended = preset?.defaultEffort
    if (recommended !== undefined && efforts[recommended] !== undefined) next.defaultReasoningEffort = recommended
  }
  if (next.defaultReasoningEffort != null && (efforts === false || efforts && efforts[next.defaultReasoningEffort] === undefined)) next.defaultReasoningEffort = null
  return inferAutomaticReasoning(next)
}

function profileModel(model: LlmDiscoveredModel & ReasoningConfiguration): JsonValue {
  return {
    id: model.id,
    ...model.reasoningEfforts === undefined ? {} : { reasoningEfforts: model.reasoningEfforts },
    ...model.reasoningMode === undefined ? {} : { reasoningMode: model.reasoningMode },
    ...model.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: model.defaultReasoningEffort },
    ...model.reasoningMappings === undefined ? {} : { reasoningMappings: model.reasoningMappings as JsonValue },
    ...model.reasoningOff === undefined ? {} : { reasoningOff: model.reasoningOff },
    ...model.api === undefined ? {} : { api: model.api },
    ...model.supportsConversation === undefined ? {} : { supportsConversation: model.supportsConversation },
    ...model.modelType === undefined ? {} : { modelType: model.modelType },
    ...model.supportedEndpointPaths === undefined ? {} : { supportedEndpointPaths: [...model.supportedEndpointPaths] },
    name: model.name ?? model.id,
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    ...model.inputModalities === undefined ? {} : { input: [...model.inputModalities] },
  }
}

function modelValue(model: SpiritXModelDraft): JsonValue {
  return {
    id: model.id.trim(),
    ...model.purpose === undefined ? {} : { purpose: model.purpose },
    ...model.reasoningEfforts === undefined ? {} : { reasoningEfforts: model.reasoningEfforts },
    ...model.reasoningMode === undefined ? {} : { reasoningMode: model.reasoningMode },
    ...model.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: model.defaultReasoningEffort },
    ...model.reasoningMappings === undefined ? {} : { reasoningMappings: model.reasoningMappings as JsonValue },
    ...model.reasoningOff === undefined ? {} : { reasoningOff: model.reasoningOff },
    ...model.api === undefined ? {} : { api: model.api },
    ...model.supportsConversation === undefined ? {} : { supportsConversation: model.supportsConversation },
    ...model.modelType === undefined ? {} : { modelType: model.modelType },
    ...model.supportedEndpointPaths === undefined ? {} : { supportedEndpointPaths: [...model.supportedEndpointPaths] },
    ...model.name === undefined ? {} : { name: model.name },
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    ...model.input === undefined ? {} : { input: [...model.input] },
  }
}

function normalizedModels(models: readonly SpiritXModelDraft[]): SpiritXModelDraft[] {
  return models.map(model => withSpiritXModelPurpose({ ...model, id: model.id.trim() }))
}

function modelCatalogValid(models: readonly SpiritXModelDraft[]): boolean {
  const ids = models.map(model => model.id)
  return ids.length > 0
    && ids.every(id => id.length > 0)
    && new Set(ids).size === ids.length
    && models.some(isConversationModel)
    && models.every(spiritXReasoningConfigValid)
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
    ...['auto', 'custom', 'disabled'].includes(String(value.reasoningMode)) ? { reasoningMode: value.reasoningMode as NonNullable<SpiritXModelDraft['reasoningMode']> } : {},
    ...value.defaultReasoningEffort === null || typeof value.defaultReasoningEffort === 'string' && validReasoningId(value.defaultReasoningEffort) ? { defaultReasoningEffort: value.defaultReasoningEffort as NonNullable<SpiritXModelDraft['defaultReasoningEffort']> | null } : {},
    ...['omit', 'value', 'qwen-toggle', 'deepseek-toggle'].includes(String(value.reasoningOff)) ? { reasoningOff: value.reasoningOff as NonNullable<SpiritXModelDraft['reasoningOff']> } : {},
    ...value.reasoningMappings === undefined ? {} : { reasoningMappings: value.reasoningMappings as NonNullable<SpiritXModelDraft['reasoningMappings']> },
    ...value.reasoningEfforts === undefined ? {} : { reasoningEfforts: value.reasoningEfforts as NonNullable<SpiritXModelDraft['reasoningEfforts']> },
    ...typeof value.purpose === 'string' && SPIRITX_MODEL_PURPOSES.some(purpose => purpose === value.purpose) ? { purpose: value.purpose as SpiritXModelPurpose } : {},
    ...typeof value.modelType === 'string' ? { modelType: value.modelType } : {},
    ...Array.isArray(value.supportedEndpointPaths) && value.supportedEndpointPaths.every(path => typeof path === 'string') ? { supportedEndpointPaths: value.supportedEndpointPaths as string[] } : {},
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
    if (model !== undefined) {
      const inferred = withSpiritXReasoning(model, live)
      for (const field of ['reasoningEfforts', 'reasoningMode', 'defaultReasoningEffort', 'reasoningMappings', 'reasoningOff'] as const) {
        const value = inferred[field]
        if (JSON.stringify(value) !== JSON.stringify(model[field])) {
          ops.push(value === undefined
            ? { op: 'unset', path: ['providers', 'spiritx', 'models', String(index), field] }
            : { op: 'set', path: ['providers', 'spiritx', 'models', String(index), field], value: value as JsonValue })
        }
      }
    }
    if (model !== undefined && model.contextWindow === undefined && live?.contextWindow !== undefined) {
      ops.push({ op: 'set', path: ['providers', 'spiritx', 'models', String(index), 'contextWindow'], value: live.contextWindow })
    }
    const api = live?.api
    if (model !== undefined) {
      const effective = withSpiritXModelPurpose({ ...model, ...live,
        ...model.purpose === undefined ? {} : { purpose: model.purpose },
      })
      for (const field of ['modelType', 'supportedEndpointPaths', 'supportsConversation'] as const) {
        const value = effective[field]
        if (value !== undefined && JSON.stringify(model[field]) !== JSON.stringify(value)) {
          ops.push({ op: 'set', path: ['providers', 'spiritx', 'models', String(index), field], value: value as JsonValue })
        }
      }
    }
    if (model !== undefined && api !== undefined && model.api !== api) {
      ops.push({ op: 'set', path: ['providers', 'spiritx', 'models', String(index), 'api'], value: api })
    }
  })
  if (ops.length > 0 && await mutate(ctx, namespace, ops) !== undefined) return
  const defaults = namespaceOf(namespaces!, 'agent-default-model')
  if (defaults !== undefined) {
    const conversational = models.filter((model): model is SpiritXModelDraft => model !== undefined)
      .map(model => withSpiritXModelPurpose({ ...model, ...advertised.get(model.id),
        ...model.purpose === undefined ? {} : { purpose: model.purpose },
      }))
      .filter(isConversationModel)
    await repairSpiritXDefault(ctx, defaults, conversational, false)
  }
}

/** Interrogate SpiritX with a replacement key, or the stored credential when the field is blank. */
async function fetchSpiritXModels(
  ctx: ClientContext,
  rawKey?: string,
): Promise<SpiritXResult<(LlmDiscoveredModel & ReasoningConfiguration)[]>> {
  const apiKey = rawKey?.trim() ?? ''
  const discovered = await ctx.remote.llm.discoverModels(SPIRITX_SETTINGS_NS, {
    provider: 'spiritx',
    baseURL: SPIRITX_BASE_URL,
    api: SPIRITX_API,
    ...apiKey.length === 0 ? {} : { apiKey },
  })
  return discovered.ok
    ? { ok: true, value: discovered.value.map(model => {
      // SpiritX reports this model's 256K context as 256 in max_model_len.
      // Native limit https://huggingface.co/Qwen/Qwen3.8-Flash-Next
      const contextWindow = model.contextWindow === 256
        && ['qwen3.8-flash-next', 'qwen3.8-flash-next-nvfp4'].includes(model.id.toLowerCase())
        ? 262144 : model.contextWindow
      return withSpiritXModelPurpose(withSpiritXReasoning({
        ...model,
        ...contextWindow === undefined ? {} : { contextWindow },
        ...model.reasoningEfforts === undefined ? {} : { reasoningMode: 'auto' as const },
      }, model))
    }) }
    : { ok: false, error: discovered.error.message }
}

/** Retain the full directory for management; purpose determines chat eligibility. */
export async function discoverSpiritXModels(ctx: ClientContext, rawKey?: string): Promise<SpiritXResult<(LlmDiscoveredModel & ReasoningConfiguration)[]>> {
  const result = await fetchSpiritXModels(ctx, rawKey)
  return result
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
  const ids = new Set(models.filter(isConversationModel).map(item => item.id))
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
  if (!models.every(spiritXReasoningConfigValid)) return '请检查推理档位、默认等级及 Off 参数配置。'
  let discovered: (LlmDiscoveredModel & ReasoningConfiguration)[] = []
  if (models.some(model => model.reasoningMode === 'auto')) {
    try {
      const result = await fetchSpiritXModels(ctx)
      if (result.ok) discovered = result.value
    } catch { /* Automatic capability inference can fall back to local presets. */ }
  }
  const normalized = normalizedModels(models).map(model => withSpiritXReasoning(model, discovered.find(live => live.id === model.id)))
  if (!modelCatalogValid(normalized)) return 'SpiritX 至少需要一个可用且 ID 不重复的大语言模型，并至少保留一个可用于聊天的模型。'
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
  if (models !== undefined && !models.every(spiritXReasoningConfigValid)) return '请检查推理档位、默认等级及 Off 参数配置。'
  const editedModels = models !== undefined && models.length > 0
    ? normalizedModels(models)
    : undefined
  if (editedModels !== undefined && !modelCatalogValid(editedModels)) {
    return 'SpiritX 至少需要一个可用且 ID 不重复的大语言模型，并至少保留一个可用于聊天的模型。'
  }
  const advertised = new Map(discovered.value.map(model => [model.id, model]))
  const selectedModels = editedModels?.map(model => withSpiritXModelPurpose(withSpiritXReasoning({ ...model,
    ...advertised.get(model.id)?.api === undefined ? {} : { api: advertised.get(model.id)!.api! },
    ...advertised.get(model.id)?.modelType === undefined ? {} : { modelType: advertised.get(model.id)!.modelType! },
    ...advertised.get(model.id)?.supportedEndpointPaths === undefined ? {} : { supportedEndpointPaths: advertised.get(model.id)!.supportedEndpointPaths! },
    ...advertised.get(model.id)?.supportsConversation === undefined ? {} : { supportsConversation: advertised.get(model.id)!.supportsConversation! },
  }, advertised.get(model.id)))) ?? discovered.value
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
