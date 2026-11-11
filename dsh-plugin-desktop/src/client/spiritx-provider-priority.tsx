import { useEffect, useId, useRef, useState } from 'react'
import { ReasoningEditor } from '@deepseek-ai/dsh-client-ui-settings-models/reasoning-editor'
import { inferAutomaticReasoning, reasoningMode } from '@deepseek-ai/dsh-client-ui-settings-models/reasoning-config'
import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import {
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  discoverSpiritXModels,
  firstLanguageModel,
  loadSpiritXProfile,
  provisionSpiritX,
  saveSpiritXModels,
  spiritXReasoningConfigValid,
  SPIRITX_BASE_URL,
  SPIRITX_SETTINGS_NS,
} from './spiritx-provisioning.ts'
import type { SpiritXModelDraft, SpiritXProfileDraft, SpiritXResult } from './spiritx-provisioning.ts'
import { SPIRITX_MODEL_PURPOSES, type SpiritXModelPurpose } from './spiritx-model-purpose.ts'
import { SPIRITX_PLATFORM_URL } from './spiritx-onboarding-state.ts'

const NS = 'desktop.spiritx-provider'
export const SPIRITX_PROVIDER_COPY = {
  en: {
    title: 'SpiritX', pending: 'Setup required', keyConfigured: 'API key configured',
    description: 'Connect SpiritX to use its available models in ClawClaw.',
    getKey: 'Get an API key on SpiritX',
    getKeyHelp: 'Register or sign in, then open Model Plaza (模型广场) > API-Key Management (API-Key管理). Under My API-Key (我的 API-Key), create a key and click its copy icon.',
    browserHelp: 'Opens in your browser. Return here after copying your key.',
    keyHelp: 'Paste your API key, then click Connect models. ClawClaw will fetch the available models automatically.',
    replaceHelp: 'Leave this field empty to keep your saved API key. Paste a new key to replace it.',
    connect: 'Connect models', connecting: 'Connecting…',
    edit: 'Edit', collapse: 'Collapse', key: 'API key', required: 'Enter an API key.',
    replacePlaceholder: 'Configured - enter a new value to replace', placeholder: 'Enter your SpiritX API key',
    customized: 'Advanced settings', baseUrl: 'Base URL', models: 'Models', fetch: 'Fetch available models',
    fetching: 'Fetching...', empty: 'No models configured.', addModel: 'Add model', modelId: 'Model ID',
    modelName: 'Model name', advanced: 'Advanced model settings', contextWindow: 'Context window',
    maxTokens: 'Max output tokens', inputTypes: 'Input types', removeModel: 'Remove model',
    purpose: 'Model purpose', purposeAuto: 'Detect automatically',
    'purpose.conversation': 'Conversation / understanding', 'purpose.decision': 'Specialized decision',
    'purpose.image-generation': 'Image generation', 'purpose.video-generation': 'Video generation',
    'purpose.speech-generation': 'Speech synthesis', 'purpose.transcription': 'Transcription',
    'purpose.embedding': 'Embedding', 'purpose.rerank': 'Reranking', 'purpose.safety-classifier': 'Safety classification',
    'purpose.other': 'Other specialized model', 'purpose.unknown': 'Unknown purpose',
    inputText: 'Text', inputImage: 'Image',
    reasoningEditor_title: "Reasoning levels",
    reasoningEditor_advanced: "Advanced parameters",
    reasoningEditor_path: "Parameter path",
    reasoningEditor_value: "Value",
    reasoningEditor_min: "Minimum",
    reasoningEditor_max: "Maximum",
    reasoningEditor_step: "Step",

    reasoningEditor_mapping: "Parameter mapping",
    reasoningEditor_effort: "Effort value",
    reasoningEditor_number: "Numeric effort",
    reasoningEditor_budget: "Token budget",
    reasoningEditor_toggle: "Boolean toggle",
    reasoningEditor_parameters: "Combined parameters",
    reasoningEditor_newLevel: "New level ID, e.g. ultra",
    reasoningEditor_addLevel: "Add level",

    reasoningEditor_mode: "Configuration",
    reasoningEditor_auto: "Detect automatically",
    reasoningEditor_custom: "Custom",
    reasoningEditor_disabled: "Disabled",
    reasoningEditor_autoHelp: "Use detected model capabilities. Future discoveries can update these levels.",
    reasoningEditor_customHelp: "Add model-specific options and configure their API values or parameters.",
    reasoningEditor_disabledHelp: "Hide the reasoning selector and follow the provider default.",
    reasoningEditor_default: "Default level",
    reasoningEditor_providerDefault: "Provider default",
    reasoningEditor_apiValue: "API value",
    reasoningEditor_offBehavior: "When selecting Off",
    reasoningEditor_omit: "Omit reasoning parameters (provider default)",
    reasoningEditor_explicit: "Send the configured API value",
    reasoningEditor_qwen: "Send Qwen enable_thinking: false (Chat Completions)",
    reasoningEditor_deepseek: "Send thinking.type: disabled (Chat Completions)",
    reasoningEditor_invalid: "Check option IDs, API values, parameter paths and numeric ranges.",
    reasoningEditor_defaultError: "Choose a default from the enabled levels.",
    reasoningEditor_offError: "Check the Off value and the selected API protocol.",
    invalidModel: 'Add at least one language model and give every model a unique ID.', cancel: 'Cancel', save: 'Save', saving: 'Saving...',
  },
  zh: {
    title: '神石（SpiritX）', pending: '待配置', keyConfigured: 'API Key 已配置',
    description: '连接神石平台，在 ClawClaw 中使用可用模型。',
    getKey: '前往神石平台获取 API Key',
    getKeyHelp: '注册或登录后，进入“模型广场” > “API-Key管理”，在“我的 API-Key”中创建密钥，再点击密钥旁的复制图标。',
    browserHelp: '将在浏览器中打开，复制密钥后请回到这里。',
    keyHelp: '粘贴 API Key 后，点击“连接模型”，ClawClaw 会自动获取可用模型。',
    replaceHelp: '留空则保留已保存的 API Key；粘贴新密钥可替换。',
    connect: '连接模型', connecting: '正在连接…',
    edit: '编辑', collapse: '收起', key: 'API Key（API 密钥）', required: '请输入 API Key。',
    replacePlaceholder: '已保存 API Key，输入新密钥可替换', placeholder: '粘贴神石平台的 API Key',
    customized: '高级设置', baseUrl: 'Base URL', models: '模型', fetch: '获取可用模型',
    fetching: '获取中...', empty: '尚未配置模型。', addModel: '添加模型', modelId: '模型 ID',
    modelName: '模型名称', advanced: '模型高级设置', contextWindow: '上下文窗口',
    maxTokens: '最大输出 token 数', inputTypes: '输入类型', removeModel: '删除模型',
    purpose: '模型用途', purposeAuto: '自动识别',
    'purpose.conversation': '对话 / 多模态理解', 'purpose.decision': '专用决策',
    'purpose.image-generation': '图像生成', 'purpose.video-generation': '视频生成',
    'purpose.speech-generation': '语音合成', 'purpose.transcription': '语音转写',
    'purpose.embedding': '向量嵌入', 'purpose.rerank': '重排序', 'purpose.safety-classifier': '审核分类',
    'purpose.other': '其他专用模型', 'purpose.unknown': '未知用途',
    inputText: '文本', inputImage: '图片',
    reasoningEditor_title: "推理等级",
    reasoningEditor_advanced: "高级参数",
    reasoningEditor_path: "参数路径",
    reasoningEditor_value: "数值",
    reasoningEditor_min: "最小值",
    reasoningEditor_max: "最大值",
    reasoningEditor_step: "步长",

    reasoningEditor_mapping: "参数映射",
    reasoningEditor_effort: "等级值",
    reasoningEditor_number: "数值 effort",
    reasoningEditor_budget: "Token 预算",
    reasoningEditor_toggle: "布尔开关",
    reasoningEditor_parameters: "组合参数",
    reasoningEditor_newLevel: "新等级 ID，例如 ultra",
    reasoningEditor_addLevel: "添加等级",

    reasoningEditor_mode: "配置方式",
    reasoningEditor_auto: "自动识别",
    reasoningEditor_custom: "自定义",
    reasoningEditor_disabled: "禁用",
    reasoningEditor_autoHelp: "使用识别到的模型能力，后续获取模型时可自动更新档位。",
    reasoningEditor_customHelp: "配置模型支持的选项，以及对应的 API 等级值或参数。",
    reasoningEditor_disabledHelp: "隐藏推理等级选择器，使用服务端默认行为。",
    reasoningEditor_default: "默认等级",
    reasoningEditor_providerDefault: "遵循服务端默认",
    reasoningEditor_apiValue: "API 参数值",
    reasoningEditor_offBehavior: "选择 Off 时",
    reasoningEditor_omit: "省略推理参数（遵循服务端）",
    reasoningEditor_explicit: "发送配置的 API 参数值",
    reasoningEditor_qwen: "发送 Qwen enable_thinking: false（Chat Completions）",
    reasoningEditor_deepseek: "发送 thinking.type: disabled（Chat Completions）",
    reasoningEditor_invalid: "请检查选项 ID、API 参数值、参数路径及数值范围。",
    reasoningEditor_defaultError: "请从已启用的档位中选择默认等级。",
    reasoningEditor_offError: "请检查 Off 参数值及当前 API 协议。",
    invalidModel: '请至少添加一个大语言模型，并确保每个模型都有不重复的模型 ID。', cancel: '取消', save: '保存', saving: '保存中...',
  },
} as const
type CopyKey = keyof typeof SPIRITX_PROVIDER_COPY.en

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop.spiritx-provider': CopyKey }
}

export const SPIRITX_PROVIDER_PRIORITY_STYLE = `
li:has([data-dsh-spiritx-provider]) { order: -1; position: relative; }
li:has([data-dsh-spiritx-provider]) > div:first-child > span:last-child:has(> button) { display: none; }
li:has([data-dsh-spiritx-provider]) > div:not(.spiritxProviderEditor):not(:has(> span > button)):has(+ .spiritxProviderRoot) { display: none; }
.spiritxProviderRoot { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.spiritxProviderEdit { margin-left: auto; flex: none; box-sizing: border-box; height: 28px; padding: 0 10px; border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }
.spiritxProviderEdit:hover:not(:disabled), .spiritxProviderIcon:hover:not(:disabled), .spiritxProviderLink:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.spiritxProviderEditor { border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-module-platform); padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
.spiritxProviderHeader { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.spiritxProviderTitle { color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; font-weight: 500; }
.spiritxProviderStatus { padding: 2px 8px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.spiritxProviderHelp { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 22px; }
.spiritxProviderGuide { display: flex; flex-direction: column; gap: 8px; padding: 14px; border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md); }
.spiritxProviderPlatformLink { align-self: flex-start; color: var(--dsh-color-accent); font-size: 13px; line-height: 24px; text-decoration: underline; text-underline-offset: 3px; }
.spiritxProviderPlatformLink:focus-visible { outline: 2px solid var(--dsh-color-accent); outline-offset: 3px; }
.spiritxProviderField { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.spiritxProviderLabel { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-weight: 500; }
.spiritxProviderInput { box-sizing: border-box; width: 100%; min-width: 0; height: 32px; padding: 0 10px; border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; }
.spiritxProviderInput:focus { outline: none; border-color: var(--dsh-color-accent); }
.spiritxProviderInput:read-only { color: var(--dsw-alias-label-tertiary); background: transparent; }
.spiritxProviderCustom { border-top: .5px solid var(--dsw-alias-border-l2); padding-top: 10px; }
.spiritxProviderSummary { display: flex; align-items: center; gap: 6px; width: fit-content; padding: 2px 4px; margin-left: -4px; border-radius: var(--dsw-radius-sm); cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-weight: 500; list-style: none; }
.spiritxProviderSummary::-webkit-details-marker { display: none; }
.spiritxProviderSummary::before { content: ''; width: 5px; height: 5px; border-right: 1.5px solid currentcolor; border-bottom: 1.5px solid currentcolor; transform: rotate(-45deg) translate(-1px, -1px); transition: transform 120ms ease; }
.spiritxProviderCustom[open] > .spiritxProviderSummary::before { transform: rotate(45deg) translate(-1px, -1px); }
.spiritxProviderCustomBody { display: flex; flex-direction: column; gap: 12px; padding-top: 12px; }
.spiritxProviderCatalog { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: .5px solid var(--dsw-alias-border-l2); }
.spiritxProviderCatalogHead { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.spiritxProviderLink, .spiritxProviderIcon { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; cursor: pointer; }
.spiritxProviderLink { height: 28px; padding: 0 10px; gap: 4px; font-size: 12px; line-height: 18px; }
.spiritxProviderIcon { width: 28px; height: 28px; flex: none; }
.spiritxProviderIconDanger:hover:not(:disabled) { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-interactive-bg-hover-danger); }
.spiritxProviderModels { display: flex; flex-direction: column; gap: 8px; }
.spiritxProviderModel { padding: 6px; border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-lg); }
.spiritxProviderModelRow { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto auto; align-items: center; gap: 6px; }
.spiritxProviderModelAdvanced { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 8px 4px 2px; }
.spiritxProviderReasoning { grid-column: 1 / -1; min-width: 0; }
.spiritxProviderInputTypes { grid-column: 1 / -1; }
.spiritxProviderModalities { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 16px; }
.spiritxProviderModalities legend { margin-bottom: 6px; }
.spiritxProviderModalities label { display: flex; align-items: center; gap: 8px; min-height: 32px; color: var(--dsw-alias-label-primary); font-size: 13px; }
.spiritxProviderEmpty { margin: 0; padding: 12px; border: 1px dashed var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-lg); color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-align: center; }
.spiritxProviderError { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.spiritxProviderActions { display: flex; justify-content: flex-end; gap: 8px; }
.spiritxProviderButton { box-sizing: border-box; height: 36px; padding: 0 14px; border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 22px; cursor: pointer; }
.spiritxProviderButtonPrimary { border: none; background: var(--dsh-color-primary); color: var(--dsh-color-on-primary); }
.spiritxProviderButtonPrimary:hover:not(:disabled) { background: var(--dsh-color-primary-hover); }
.spiritxProviderButton:disabled, .spiritxProviderLink:disabled, .spiritxProviderIcon:disabled { opacity: .4; cursor: default; }
@media (max-width: 520px) { .spiritxProviderModelRow { grid-template-columns: minmax(0, 1fr) auto auto; } .spiritxProviderModelRow > input:nth-child(2) { grid-column: 1 / -1; grid-row: 2; } .spiritxProviderModelAdvanced { grid-template-columns: 1fr; } .spiritxProviderReasoning { grid-column: 1 / -1; min-width: 0; }
.spiritxProviderInputTypes { grid-column: 1; } }
`

interface SpiritXProviderInjected {
  load: () => Promise<SpiritXResult<SpiritXProfileDraft>>
  discover: (key?: string) => Promise<SpiritXResult<LlmDiscoveredModel[]>>
  provision: (key: string, models?: readonly SpiritXModelDraft[]) => Promise<string | undefined>
  saveModels: (models: readonly SpiritXModelDraft[]) => Promise<string | undefined>
  t: (key: CopyKey) => string
}

type SpiritXProviderProps = PropsRuntime<'settings.models.provider-card'> & InjectFace<SpiritXProviderInjected>

function discoveredDraft(model: LlmDiscoveredModel & Partial<SpiritXModelDraft>): SpiritXModelDraft {
  return {
    id: model.id,
    ...model.api === undefined ? {} : { api: model.api },
    ...model.supportsConversation === undefined ? {} : { supportsConversation: model.supportsConversation },
    ...model.modelType === undefined ? {} : { modelType: model.modelType },
    ...model.supportedEndpointPaths === undefined ? {} : { supportedEndpointPaths: [...model.supportedEndpointPaths] },
    ...model.reasoningEfforts === undefined ? {} : { reasoningEfforts: model.reasoningEfforts },
    ...model.reasoningMappings === undefined ? {} : { reasoningMappings: model.reasoningMappings },
    ...model.reasoningMode === undefined ? {} : { reasoningMode: model.reasoningMode },
    ...model.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: model.defaultReasoningEffort },
    ...model.name === undefined ? {} : { name: model.name },
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    ...model.inputModalities === undefined ? {} : { input: [...model.inputModalities] },
  }
}

function modelsValid(models: readonly SpiritXModelDraft[]): boolean {
  const ids = models.map(model => model.id.trim())
  return ids.length > 0
    && ids.every(id => id.length > 0)
    && new Set(ids).size === ids.length
    && models.some(model => firstLanguageModel([model]) !== undefined)
    && models.every(spiritXReasoningConfigValid)
}

function SpiritXReasoningEditor({ model, disabled, change, t }: {
  model: SpiritXModelDraft
  disabled: boolean
  change: (model: SpiritXModelDraft) => void
  t: SpiritXProviderInjected['t']
}): ReactNode {
  return <div className="spiritxProviderReasoning">
    <ReasoningEditor<SpiritXModelDraft> model={model} disabled={disabled}
      labels={{
        title: t("reasoningEditor_title"),
        advanced: t("reasoningEditor_advanced"),
        path: t("reasoningEditor_path"),
        value: t("reasoningEditor_value"),
        min: t("reasoningEditor_min"),
        max: t("reasoningEditor_max"),
        step: t("reasoningEditor_step"),

        mapping: t("reasoningEditor_mapping"),
        effort: t("reasoningEditor_effort"),
        number: t("reasoningEditor_number"),
        budget: t("reasoningEditor_budget"),
        toggle: t("reasoningEditor_toggle"),
        parameters: t("reasoningEditor_parameters"),
        newLevel: t("reasoningEditor_newLevel"),
        addLevel: t("reasoningEditor_addLevel"),

        mode: t("reasoningEditor_mode"),
        auto: t("reasoningEditor_auto"),
        custom: t("reasoningEditor_custom"),
        disabled: t("reasoningEditor_disabled"),
        autoHelp: t("reasoningEditor_autoHelp"),
        customHelp: t("reasoningEditor_customHelp"),
        disabledHelp: t("reasoningEditor_disabledHelp"),
        default: t("reasoningEditor_default"),
        providerDefault: t("reasoningEditor_providerDefault"),
        apiValue: t("reasoningEditor_apiValue"),
        offBehavior: t("reasoningEditor_offBehavior"),
        omit: t("reasoningEditor_omit"),
        explicit: t("reasoningEditor_explicit"),
        qwen: t("reasoningEditor_qwen"),
        deepseek: t("reasoningEditor_deepseek"),
        invalid: t("reasoningEditor_invalid"),
        defaultError: t("reasoningEditor_defaultError"),
        offError: t("reasoningEditor_offError"),
      }} onChange={change} />
  </div>
}

/** Enforce product-owned card chrome without depending on upstream hashed CSS classes. */
export function protectSpiritXProviderRow(root: HTMLElement): () => void {
  const row = root.closest('li')
  if (!(row instanceof HTMLElement)) return () => {}
  const originalOrder = row.style.getPropertyValue('order')
  const originalPriority = row.style.getPropertyPriority('order')
  const hidden = new Map<HTMLElement, string>()
  const hide = (element: Element | null): void => {
    if (!(element instanceof HTMLElement) || hidden.has(element)) return
    hidden.set(element, element.style.display)
    element.style.display = 'none'
  }
  const apply = (): void => {
    row.style.setProperty('order', '-1', 'important')
    const head = [...row.children].find(child => child !== root
      && child.querySelector('button[aria-label*="SpiritX"]') !== null)
    if (!(head instanceof HTMLElement)) return
    const identity = head.firstElementChild
    if (identity instanceof HTMLElement) {
      for (const child of [...identity.children].slice(1)) {
        if (child.getAttribute('role') !== 'img') hide(child)
      }
    }
    if (head.lastElementChild !== identity) hide(head.lastElementChild)
    hide(head)
  }
  apply()
  const observer = new MutationObserver(apply)
  observer.observe(row, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    if (originalOrder.length === 0) row.style.removeProperty('order')
    else row.style.setProperty('order', originalOrder, originalPriority)
    for (const [element, display] of hidden) element.style.display = display
  }
}

function SpiritXProviderEditor(props: SpiritXProviderProps): ReactNode {
  const helpId = useId()
  const browserHelpId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState(() => !props.configured || !props.keyConfigured)
  const [key, setKey] = useState('')
  const [models, setModels] = useState<SpiritXModelDraft[]>([])
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<string | undefined>()

  useEffect(() => {
    if (!editing) return
    let active = true
    setLoading(true)
    setFailure(undefined)
    void props.load()
      .then((result) => {
        if (!active) return
        if (result.ok) setModels(result.value.models)
        else setFailure(result.error)
      })
      .catch((error: unknown) => { if (active) setFailure(errorMessage(error)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [editing])

  useEffect(() => {
    const root = rootRef.current
    return root === null ? undefined : protectSpiritXProviderRow(root)
  }, [])

  if (props.provider.provider !== 'spiritx') return null
  const disabled = busy || loading
  const patchModel = (
    index: number,
    patch: { [Key in keyof SpiritXModelDraft]?: SpiritXModelDraft[Key] | undefined },
  ): void => {
    setModels(current => current.map((model, at) => at === index
      ? Object.fromEntries(Object.entries({ ...model, ...patch }).filter(([, value]) => value !== undefined)) as unknown as SpiritXModelDraft
      : model))
    setFailure(undefined)
  }
  const removeModel = (index: number): void => {
    setModels(current => current.filter((_model, at) => at !== index))
    setExpanded(current => new Set([...current].flatMap(at => at === index ? [] : [at > index ? at - 1 : at])))
  }
  const fetchModels = async (): Promise<void> => {
    setBusy(true); setFailure(undefined)
    try {
      const result = await props.discover(key.trim().length === 0 ? undefined : key)
      if (!result.ok) { setFailure(result.error); return }
      const discovered = result.value.map(discoveredDraft)
      const advertised = new Map(discovered.map(model => [model.id, model]))
      setModels(current => {
        const existingIds = new Set(current.map(model => model.id))
        const refreshed = current.map(existing => {
          const draft = advertised.get(existing.id)
          if (draft === undefined) return existing
          const mode = reasoningMode(existing)
          const next: SpiritXModelDraft = { ...existing, ...draft, reasoningMode: mode }
          for (const field of ['name', 'contextWindow', 'maxTokens', 'input', 'purpose'] as const) {
            if (existing[field] !== undefined) Object.assign(next, { [field]: existing[field] })
          }
          if (mode !== 'auto') {
            for (const field of ['reasoningEfforts', 'reasoningMappings', 'reasoningOff', 'defaultReasoningEffort'] as const) {
              delete next[field]
              if (existing[field] !== undefined) Object.assign(next, { [field]: existing[field] })
            }
            return next
          }
          if (draft.reasoningEfforts !== undefined) {
            for (const field of ['reasoningMappings', 'reasoningOff'] as const) {
              delete next[field]
              if (draft[field] !== undefined) Object.assign(next, { [field]: draft[field] })
            }
          }
          if (existing.defaultReasoningEffort !== undefined) next.defaultReasoningEffort = existing.defaultReasoningEffort
          return inferAutomaticReasoning(next)
        })
        return [...refreshed, ...discovered.filter(model => !existingIds.has(model.id))]
      })
      setExpanded(new Set())
    } catch (error) {
      setFailure(errorMessage(error))
    } finally { setBusy(false) }
  }
  const save = async (): Promise<void> => {
    const value = key.trim()
    if ((!props.configured || !props.keyConfigured) && value.length === 0) { setFailure(props.t('required')); return }
    const discoversInitialCatalog = models.length === 0 && value.length > 0
    if (!discoversInitialCatalog && !modelsValid(models)) { setFailure(props.t('invalidModel')); return }
    setBusy(true); setFailure(undefined)
    try {
      const refused = value.length > 0
        ? await props.provision(value, discoversInitialCatalog ? undefined : models)
        : await props.saveModels(models)
      if (refused !== undefined) { setFailure(refused); return }
      setKey(''); setEditing(false)
    } catch (error) {
      setFailure(errorMessage(error))
    } finally { setBusy(false) }
  }

  return <div ref={rootRef} className="spiritxProviderRoot" data-dsh-spiritx-provider>
    <div className="spiritxProviderHeader">
      <span className="spiritxProviderTitle">{props.t('title')}</span>
      <span className="spiritxProviderStatus">{props.t(props.keyConfigured ? 'keyConfigured' : 'pending')}</span>
    <button type="button" className="spiritxProviderEdit" disabled={busy}
      aria-expanded={editing}
      onClick={() => { setEditing(current => !current); setFailure(undefined) }}>
      {props.t(editing ? 'collapse' : 'edit')}
    </button>
    </div>
    {!editing ? null : <div className="spiritxProviderEditor">
      <p className="spiritxProviderHelp">{props.t('description')}</p>
      {!props.keyConfigured ? <div className="spiritxProviderGuide">
        <p className="spiritxProviderHelp">{props.t('getKeyHelp')}</p>
        <a className="spiritxProviderPlatformLink" href={SPIRITX_PLATFORM_URL} target="_blank" rel="noopener noreferrer"
          aria-describedby={browserHelpId}>{props.t('getKey')}</a>
        <p className="spiritxProviderHelp" id={browserHelpId}>{props.t('browserHelp')}</p>
      </div> : null}
      <label className="spiritxProviderField">
        <span className="spiritxProviderLabel">{props.t('key')}</span>
        <input className="spiritxProviderInput" type="password" autoComplete="new-password" value={key}
          aria-describedby={helpId}
          placeholder={props.t(props.keyConfigured ? 'replacePlaceholder' : 'placeholder')}
          disabled={disabled} onChange={(event) => { setKey(event.target.value); setFailure(undefined) }} />
      </label>
      <p className="spiritxProviderHelp" id={helpId}>{props.t(props.keyConfigured ? 'replaceHelp' : 'keyHelp')}</p>
      <details className="spiritxProviderCustom">
        <summary className="spiritxProviderSummary">{props.t('customized')}</summary>
        <div className="spiritxProviderCustomBody">
          <label className="spiritxProviderField">
            <span className="spiritxProviderLabel">{props.t('baseUrl')}</span>
            <input className="spiritxProviderInput" type="text" value={SPIRITX_BASE_URL} readOnly />
          </label>
          <section className="spiritxProviderCatalog" aria-label={props.t('models')}>
            <div className="spiritxProviderCatalogHead">
              <span className="spiritxProviderLabel">{props.t('models')}</span>
              <button type="button" className="spiritxProviderLink" disabled={disabled} onClick={() => { void fetchModels() }}>
                <IconRefreshOutlineRegular size={14} />{props.t(busy ? 'fetching' : 'fetch')}
              </button>
            </div>
            {models.length === 0 ? <p className="spiritxProviderEmpty">{props.t('empty')}</p> : null}
            <div className="spiritxProviderModels">
              {models.map((model, index) => <div className="spiritxProviderModel" key={index}>
                <div className="spiritxProviderModelRow">
                  <input className="spiritxProviderInput" value={model.id} placeholder={props.t('modelId')}
                    aria-label={`${props.t('modelId')} ${String(index + 1)}`} disabled={disabled}
                    onChange={event => { patchModel(index, { id: event.target.value }) }} />
                  <input className="spiritxProviderInput" value={model.name ?? ''} placeholder={props.t('modelName')}
                    aria-label={`${props.t('modelName')} ${String(index + 1)}`} disabled={disabled}
                    onChange={event => { patchModel(index, { name: event.target.value || undefined }) }} />
                  <button type="button" className="spiritxProviderIcon" title={props.t('advanced')}
                    aria-label={`${props.t('advanced')} ${String(index + 1)}`} aria-expanded={expanded.has(index)}
                    onClick={() => { setExpanded(current => { const next = new Set(current); if (!next.delete(index)) next.add(index); return next }) }}>
                    {expanded.has(index) ? <IconChevronDownOutlineRegular /> : <IconChevronRightOutlineRegular />}
                  </button>
                  <button type="button" className="spiritxProviderIcon spiritxProviderIconDanger" title={props.t('removeModel')}
                    aria-label={`${props.t('removeModel')} ${String(index + 1)}`} disabled={disabled} onClick={() => { removeModel(index) }}>
                    <IconTrashOutlineRegular size={14} />
                  </button>
                </div>
                {!expanded.has(index) ? null : <div className="spiritxProviderModelAdvanced">
                  <label className="spiritxProviderField"><span className="spiritxProviderLabel">{props.t('contextWindow')}</span>
                    <input className="spiritxProviderInput" type="number" min="1" placeholder="256K" value={model.contextWindow ?? ''} disabled={disabled}
                      onChange={event => { patchModel(index, { contextWindow: event.target.value === '' ? undefined : Number(event.target.value) }) }} /></label>
                  <label className="spiritxProviderField"><span className="spiritxProviderLabel">{props.t('maxTokens')}</span>
                    <input className="spiritxProviderInput" type="number" min="1" placeholder="32K" value={model.maxTokens ?? ''} disabled={disabled}
                      onChange={event => { patchModel(index, { maxTokens: event.target.value === '' ? undefined : Number(event.target.value) }) }} /></label>
                  <fieldset className="spiritxProviderInputTypes spiritxProviderModalities" disabled={disabled}>
                    <legend className="spiritxProviderLabel">{props.t('inputTypes')}</legend>
                    <label><input type="checkbox" checked disabled />{props.t('inputText')}</label>
                    <label><input type="checkbox" checked={model.input?.includes('image') ?? false}
                      onChange={event => { patchModel(index, { input: event.target.checked ? ['text', 'image'] : ['text'] }) }} />{props.t('inputImage')}</label>
                  </fieldset>
                  <SpiritXReasoningEditor model={model} disabled={disabled} t={props.t}
                    change={next => { setModels(current => current.map((model, at) => at === index ? next : model)); setFailure(undefined) }} />
                  <label className="spiritxProviderField spiritxProviderInputTypes"><span className="spiritxProviderLabel">{props.t('purpose')}</span>
                    <select className="spiritxProviderInput" aria-label={props.t('purpose')} value={model.purpose ?? ''} disabled={disabled}
                      onChange={event => { patchModel(index, { purpose: event.target.value === '' ? undefined : event.target.value as SpiritXModelPurpose, supportsConversation: undefined }) }}>
                      <option value="">{props.t('purposeAuto')}</option>
                      {SPIRITX_MODEL_PURPOSES.map(purpose => <option key={purpose} value={purpose}>{props.t(`purpose.${purpose}`)}</option>)}
                    </select>
                  </label>
                </div>}
              </div>)}
            </div>
            <button type="button" className="spiritxProviderLink" disabled={disabled}
              onClick={() => { setModels(current => [...current, { id: '' }]) }}><IconPlusOutlineRegular size={14} />{props.t('addModel')}</button>
          </section>
        </div>
      </details>
      {failure === undefined ? null : <p className="spiritxProviderError" role="alert">{failure}</p>}
      <div className="spiritxProviderActions">
        <button type="button" className="spiritxProviderButton" disabled={busy}
          onClick={() => { setEditing(false); setKey(''); setFailure(undefined) }}>{props.t('cancel')}</button>
        <button type="button" className="spiritxProviderButton spiritxProviderButtonPrimary"
          disabled={disabled || (!modelsValid(models) && !(models.length === 0 && key.trim().length > 0))}
          onClick={() => { void save() }}>{props.t(props.keyConfigured ? (busy ? 'saving' : 'save') : (busy ? 'connecting' : 'connect'))}</button>
      </div>
    </div>}
  </div>
}

export function SpiritXProviderPriorityMarker(props: SpiritXProviderProps): ReactNode {
  return props.provider.provider === 'spiritx' ? <SpiritXProviderEditor {...props} /> : null
}

/** Keep SpiritX first and replace its generic unknown-namespace editor. */
export function applySpiritXProviderPriority(ctx: ClientContext): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => ctx.locale.register(NS, SPIRITX_PROVIDER_COPY), 'dsh-plugin-desktop: SpiritX provider copy')
  const t = ctx.locale.bind(NS) as SpiritXProviderInjected['t']
  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card',
    key: SPIRITX_SETTINGS_NS,
    inject: (): SpiritXProviderInjected => ({
      load: () => loadSpiritXProfile(ctx),
      discover: key => discoverSpiritXModels(ctx, key),
      provision: (key, models) => provisionSpiritX(ctx, key, models),
      saveModels: models => saveSpiritXModels(ctx, models),
      t,
    }),
  }, SpiritXProviderPriorityMarker))
  const style = document.createElement('style')
  style.dataset.pluginCss = 'dsh-plugin-desktop/spiritx-provider-priority'
  style.textContent = SPIRITX_PROVIDER_PRIORITY_STYLE
  document.head.append(style)
  ctx.effect(() => () => { style.remove() }, 'dsh-plugin-desktop: SpiritX provider priority styles')
}
