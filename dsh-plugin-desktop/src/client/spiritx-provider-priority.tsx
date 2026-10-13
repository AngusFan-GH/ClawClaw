import { useEffect, useRef, useState } from 'react'
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
  SPIRITX_BASE_URL,
  SPIRITX_SETTINGS_NS,
} from './spiritx-provisioning.ts'
import type { SpiritXModelDraft, SpiritXProfileDraft, SpiritXResult } from './spiritx-provisioning.ts'

const NS = 'desktop.spiritx-provider'
const COPY = {
  en: {
    edit: 'Edit', collapse: 'Collapse', key: 'API key', required: 'Enter an API key.',
    replacePlaceholder: 'Configured - enter a new value to replace', placeholder: 'Enter your SpiritX API key',
    customized: 'Custom settings', baseUrl: 'Base URL', models: 'Models', fetch: 'Fetch available models',
    fetching: 'Fetching...', empty: 'No models configured.', addModel: 'Add model', modelId: 'Model ID',
    modelName: 'Model name', advanced: 'Advanced model settings', contextWindow: 'Context window',
    maxTokens: 'Max output tokens', inputTypes: 'Input types', removeModel: 'Remove model',
    invalidModel: 'Add at least one language model and give every model a unique ID.', cancel: 'Cancel', save: 'Save', saving: 'Saving...',
  },
  zh: {
    edit: '编辑', collapse: '收起', key: 'API 密钥', required: '请输入 API 密钥。',
    replacePlaceholder: '已配置——输入新值可替换', placeholder: '输入 SpiritX API 密钥',
    customized: '自定义设置', baseUrl: 'Base URL', models: '模型', fetch: '获取可用模型',
    fetching: '获取中...', empty: '尚未配置模型。', addModel: '添加模型', modelId: '模型 ID',
    modelName: '模型名称', advanced: '模型高级设置', contextWindow: '上下文窗口',
    maxTokens: '最大输出 Token', inputTypes: '输入类型', removeModel: '删除模型',
    invalidModel: '请至少添加一个大语言模型，并确保每个模型都有不重复的模型 ID。', cancel: '取消', save: '保存', saving: '保存中...',
  },
} as const
type CopyKey = keyof typeof COPY.en

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
.spiritxProviderRoot { display: contents; }
.spiritxProviderEdit { position: absolute; top: 12px; right: 14px; box-sizing: border-box; height: 28px; padding: 0 10px; border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }
.spiritxProviderEdit:hover:not(:disabled), .spiritxProviderIcon:hover:not(:disabled), .spiritxProviderLink:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.spiritxProviderEditor { border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-module-platform); padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
.spiritxProviderHeader { display: flex; align-items: baseline; gap: 8px; }
.spiritxProviderTitle { color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; font-weight: 500; }
.spiritxProviderRoute { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.spiritxProviderField { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.spiritxProviderLabel { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-weight: 500; }
.spiritxProviderInput { box-sizing: border-box; width: 100%; min-width: 0; height: 32px; padding: 0 10px; border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; }
.spiritxProviderInput:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
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
.spiritxProviderInputTypes { grid-column: 1 / -1; }
.spiritxProviderEmpty { margin: 0; padding: 12px; border: 1px dashed var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-lg); color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-align: center; }
.spiritxProviderError { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.spiritxProviderActions { display: flex; justify-content: flex-end; gap: 8px; }
.spiritxProviderButton { box-sizing: border-box; height: 36px; padding: 0 14px; border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 22px; cursor: pointer; }
.spiritxProviderButtonPrimary { border: none; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
.spiritxProviderButton:disabled, .spiritxProviderLink:disabled, .spiritxProviderIcon:disabled { opacity: .4; cursor: default; }
@media (max-width: 520px) { .spiritxProviderModelRow { grid-template-columns: minmax(0, 1fr) auto auto; } .spiritxProviderModelRow > input:nth-child(2) { grid-column: 1 / -1; grid-row: 2; } .spiritxProviderModelAdvanced { grid-template-columns: 1fr; } .spiritxProviderInputTypes { grid-column: 1; } }
`

interface SpiritXProviderInjected {
  load: () => Promise<SpiritXResult<SpiritXProfileDraft>>
  discover: (key?: string) => Promise<SpiritXResult<LlmDiscoveredModel[]>>
  provision: (key: string, models?: readonly SpiritXModelDraft[]) => Promise<string | undefined>
  saveModels: (models: readonly SpiritXModelDraft[]) => Promise<string | undefined>
  t: (key: CopyKey) => string
}

type SpiritXProviderProps = PropsRuntime<'settings.models.provider-card'> & InjectFace<SpiritXProviderInjected>

function discoveredDraft(model: LlmDiscoveredModel): SpiritXModelDraft {
  return {
    id: model.id,
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
    && firstLanguageModel(models) !== undefined
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
    patch: Record<string, string | number | string[] | undefined>,
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
      setModels(result.value.map(discoveredDraft))
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
    <button type="button" className="spiritxProviderEdit" disabled={busy}
      onClick={() => { setEditing(current => !current); setFailure(undefined) }}>
      {props.t(editing ? 'collapse' : 'edit')}
    </button>
    {!editing ? null : <div className="spiritxProviderEditor">
      <div className="spiritxProviderHeader"><span className="spiritxProviderTitle">SpiritX</span><span className="spiritxProviderRoute">spiritx</span></div>
      <label className="spiritxProviderField">
        <span className="spiritxProviderLabel">{props.t('key')}</span>
        <input className="spiritxProviderInput" type="password" autoComplete="new-password" autoFocus value={key}
          placeholder={props.t(props.keyConfigured ? 'replacePlaceholder' : 'placeholder')}
          disabled={disabled} onChange={(event) => { setKey(event.target.value); setFailure(undefined) }} />
      </label>
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
                    <input className="spiritxProviderInput" type="number" min="1" value={model.contextWindow ?? ''} disabled={disabled}
                      onChange={event => { patchModel(index, { contextWindow: event.target.value === '' ? undefined : Number(event.target.value) }) }} /></label>
                  <label className="spiritxProviderField"><span className="spiritxProviderLabel">{props.t('maxTokens')}</span>
                    <input className="spiritxProviderInput" type="number" min="1" value={model.maxTokens ?? ''} disabled={disabled}
                      onChange={event => { patchModel(index, { maxTokens: event.target.value === '' ? undefined : Number(event.target.value) }) }} /></label>
                  <label className="spiritxProviderField spiritxProviderInputTypes"><span className="spiritxProviderLabel">{props.t('inputTypes')}</span>
                    <input className="spiritxProviderInput" value={model.input?.join(', ') ?? ''} placeholder="text, image" disabled={disabled}
                      onChange={event => { patchModel(index, { input: event.target.value.split(',').map(item => item.trim()).filter(Boolean) }) }} /></label>
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
          disabled={disabled || (!modelsValid(models) && (props.configured || key.trim().length === 0))}
          onClick={() => { void save() }}>{props.t(busy ? 'saving' : 'save')}</button>
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
  ctx.effect(() => ctx.locale.register(NS, COPY), 'dsh-plugin-desktop: SpiritX provider copy')
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
