import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { ISidebarRight, SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ExpertSummary } from '../expert-contract.js'
import type { ExpertTeam } from '../team-contract.js'
import { Avatar, TeamAvatars } from './team-shared.js'
// @ts-expect-error package subpath has no declaration file
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.mjs'
// @ts-expect-error package subpath has no declaration file
import Play from 'lucide-react/dist/esm/icons/play.mjs'
// @ts-expect-error package subpath has no declaration file
import CircleAlert from 'lucide-react/dist/esm/icons/circle-alert.mjs'
// @ts-expect-error package subpath has no declaration file
import X from 'lucide-react/dist/esm/icons/x.mjs'

export const CAPABILITY_SIDEBAR_KIND = 'clawclaw-capability-details'
export const CAPABILITY_SIDEBAR_ADDRESS = 'dsh-resource://clawclaw-capability/details/'

interface CapabilitySidebarBase {
  readonly locale: 'zh' | 'en'
  readonly examples: readonly string[]
  readonly select?: CapabilitySidebarActions['select']
  readonly focusComposer?: CapabilitySidebarActions['focusComposer']
}

export interface CapabilitySidebarActions {
  readonly select: (example: string) => boolean | Promise<boolean>
  readonly focusComposer: () => void
}

export interface ExpertSidebarEntry extends CapabilitySidebarBase {
  readonly kind: 'expert'
  readonly expert: ExpertSummary
  readonly avatar: string
}

export interface TeamSidebarEntry extends CapabilitySidebarBase {
  readonly kind: 'team'
  readonly team: ExpertTeam
  readonly experts: readonly ExpertSummary[]
}

export type CapabilitySidebarEntry = ExpertSidebarEntry | TeamSidebarEntry
export type ActionableCapabilitySidebarEntry = CapabilitySidebarEntry & CapabilitySidebarActions
export type CapabilitySidebarActionResolver = (
  entry: CapabilitySidebarEntry,
  sessionId: SessionId,
) => CapabilitySidebarActions | undefined

export interface CapabilitySidebarResource {
  readonly entry?: CapabilitySidebarEntry
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    'clawclaw-capability': CapabilitySidebarResource
  }
}

const STORAGE_PREFIX = 'clawclaw.capability-sidebar.v1.'
const STORAGE_INDEX = `${STORAGE_PREFIX}index`
const MAX_PERSISTED_ENTRIES = 50
const entries = new Map<string, ActionableCapabilitySidebarEntry>()
let resolveActions: CapabilitySidebarActionResolver | undefined

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
}

function entryAddress(token: string): string {
  return `${CAPABILITY_SIDEBAR_ADDRESS}${encodeURIComponent(token)}`
}

function storageKey(token: string): string {
  return `${STORAGE_PREFIX}${token}`
}

function storage(): Storage | undefined {
  try { return globalThis.localStorage } catch { return undefined }
}

function rememberEntry(token: string, entry: CapabilitySidebarEntry): void {
  const target = storage()
  if (target === undefined) return
  try {
    target.setItem(storageKey(token), JSON.stringify(entry))
    const previous = JSON.parse(target.getItem(STORAGE_INDEX) ?? '[]') as unknown
    const tokens = Array.isArray(previous) ? previous.filter(item => typeof item === 'string' && item !== token) : []
    tokens.push(token)
    while (tokens.length > MAX_PERSISTED_ENTRIES) {
      const oldest = tokens.shift()
      if (oldest !== undefined) target.removeItem(storageKey(oldest))
    }
    target.setItem(STORAGE_INDEX, JSON.stringify(tokens))
  } catch {
    // Storage can be unavailable in hardened or quota-constrained renderers.
  }
}

function forgetEntry(token: string): void {
  entries.delete(token)
  const target = storage()
  if (target === undefined) return
  try {
    target.removeItem(storageKey(token))
    const previous = JSON.parse(target.getItem(STORAGE_INDEX) ?? '[]') as unknown
    if (Array.isArray(previous)) target.setItem(STORAGE_INDEX, JSON.stringify(previous.filter(item => item !== token)))
  } catch {
    // Cleanup is best-effort; the bounded index prevents unbounded growth.
  }
}

function isEntry(value: unknown): value is CapabilitySidebarEntry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if ((candidate.locale !== 'zh' && candidate.locale !== 'en') || !Array.isArray(candidate.examples)) return false
  if (candidate.kind === 'expert') return candidate.expert !== null && typeof candidate.expert === 'object' && typeof candidate.avatar === 'string'
  return candidate.kind === 'team' && candidate.team !== null && typeof candidate.team === 'object' && Array.isArray(candidate.experts)
}

function restoredEntry(token: string): CapabilitySidebarEntry | undefined {
  const target = storage()
  if (target === undefined) return undefined
  try {
    const raw = target.getItem(storageKey(token))
    if (raw === null) return undefined
    const value: unknown = JSON.parse(raw)
    return isEntry(value) ? value : undefined
  } catch {
    return undefined
  }
}

function parseToken(address: string): string | undefined {
  let url: URL
  try { url = new URL(address) } catch { return undefined }
  if (url.protocol !== 'dsh-resource:' || url.hostname !== 'clawclaw-capability') return undefined
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2 || parts[0] !== 'details' || url.search !== '' || url.hash !== '') return undefined
  try { return decodeURIComponent(parts[1]!) || undefined } catch { return undefined }
}

function provider(): ResourceProvider<'clawclaw-capability'> {
  return {
    protocol: 'clawclaw-capability',
    async *open(address, { signal }) {
      const token = parseToken(address)
      if (token === undefined) throw new Error(`clawclaw capability: invalid address "${address}"`)
      const entry = entries.get(token) ?? restoredEntry(token)
      yield { ok: true, value: entry === undefined ? {} : { entry } }
      await waitForAbort(signal)
    },
  }
}

function copy(locale: 'zh' | 'en') {
  return locale === 'en'
    ? { expired: 'Capability unavailable', expiredBody: 'This capability was removed or its saved details could not be restored.', unavailable: 'This saved capability is no longer in the library. You can review its details, then close this tab.', close: 'Close details', try: 'Try asking', test: 'Test now', failed: 'Could not open a new conversation with this capability.', members: 'Team members', skills: 'Skills', connectors: 'Connectors', role: 'Expert', team: 'Expert team', alias: 'Name', type: 'Type', category: 'Category', intro: 'Capabilities', strengths: 'Areas of expertise', coordinator: 'Coordinator', lead: 'Lead' }
    : { expired: '能力详情不可用', expiredBody: '该能力可能已被移除，或保存的详情无法恢复。', unavailable: '这个已保存的能力已不在专家库中。你仍可查看原有详情，确认后关闭此标签。', close: '关闭详情', try: '试试这样问', test: '立即测试', failed: '无法新建对话并添加该能力。', members: '团队成员', skills: '技能', connectors: '连接器', role: '专家', team: '专家团', alias: '名称', type: '类型', category: '行业分类', intro: '能力介绍', strengths: '擅长领域', coordinator: '统筹官', lead: '主理人' }
}

function CapabilitySection(props: { readonly title: string; readonly className?: string; readonly children: React.ReactNode }) {
  return <section className={props.className}><h3>{props.title}</h3>{props.children}</section>
}

function CapabilityHero(props: { readonly visual: React.ReactNode; readonly name: string; readonly facts: readonly [string, string][] }) {
  return <header className="clawCapabilityHero">
    <div className="clawCapabilityVisual">{props.visual}</div>
    <div className="clawCapabilityIdentity"><h2>{props.name}</h2><dl>{props.facts.map(([label, value]) => <div key={label}><dt>{label}：</dt><dd>{value}</dd></div>)}</dl></div>
  </header>
}

function CapabilityTags({ values }: { readonly values: readonly string[] }) {
  return <div className="clawCapabilityTags">{values.map(value => <span key={value}>{value}</span>)}</div>
}

function ExpertBody({ entry }: { readonly entry: ExpertSidebarEntry }) {
  const labels = copy(entry.locale)
  const expert = entry.expert
  const name = entry.locale === 'en' ? expert.nameEn : expert.name
  const description = entry.locale === 'en' ? expert.descriptionEn : expert.description
  const strengths = [...new Set([expert.divisionZh, ...expert.skills.map(item => item.name)])]
  return <>
    <CapabilityHero visual={<img src={entry.avatar} alt="" width={84} height={84}/>} name={name} facts={[[labels.alias, name], [labels.type, labels.role], [labels.category, expert.divisionZh]]}/>
    <CapabilitySection title={labels.intro}><p className="clawCapabilityDescription">{description}</p></CapabilitySection>
    <CapabilitySection title={labels.strengths}><CapabilityTags values={strengths}/></CapabilitySection>
    {expert.mcpServers.length > 0 && <CapabilitySection title={labels.connectors}><CapabilityTags values={expert.mcpServers.map(item => item.name)}/></CapabilitySection>}
  </>
}

function TeamBody({ entry }: { readonly entry: TeamSidebarEntry }) {
  const labels = copy(entry.locale)
  const team = entry.team
  const leadSlug = team.runtime.leadExpertSlug ?? team.members[0]?.expertSlug
  const lead = entry.experts.find(item => item.slug === leadSlug)
  const category = lead === undefined ? (team.tags[0] ?? labels.team) : entry.locale === 'en' ? lead.division : lead.divisionZh
  return <>
    <CapabilityHero visual={<div className="clawCapabilityTeamVisual aag-team-avatar"><TeamAvatars team={team} experts={entry.experts}/></div>} name={team.name} facts={[[labels.alias, team.name], [labels.type, labels.team], [labels.category, category]]}/>
    <CapabilitySection title={labels.intro}><p className="clawCapabilityDescription">{team.description}</p></CapabilitySection>
    {team.tags.length > 0 && <CapabilitySection title={labels.strengths}><CapabilityTags values={team.tags}/></CapabilitySection>}
    <CapabilitySection title={labels.members}><div className="clawCapabilityMembers">
      <div className="clawCapabilityCoordinator"><span aria-hidden="true">{entry.locale === 'en' ? 'C' : '统'}</span><div><strong>{team.name}{labels.lead}</strong><small>{labels.coordinator}</small></div><em>{labels.lead}</em></div>
      {team.members.map(member => {
      const expert = entry.experts.find(item => item.slug === member.expertSlug)
      const name = expert === undefined ? member.expertSlug : entry.locale === 'en' ? expert.nameEn : expert.name
      return <div key={member.expertSlug}><Avatar {...(expert === undefined ? {} : { expert })} size={36}/><div><strong>{name}</strong><small>{member.duty}</small></div></div>
    })}</div></CapabilitySection>
  </>
}

function CapabilityExamples(props: { readonly examples: readonly string[]; readonly busy: boolean; readonly select: (example: string) => void }) {
  return <div className="clawCapabilityExampleList">{props.examples.map(example => <button type="button" key={example} disabled={props.busy} onClick={() => props.select(example)}><span>“{example}”</span><ArrowRight size={17} aria-hidden="true"/></button>)}</div>
}

function CapabilityUnavailable({ title, body, closeLabel, close }: { readonly title: string; readonly body: string; readonly closeLabel: string; readonly close?: () => void }) {
  return <div className="clawCapabilityUnavailable" role="status">
    <span className="clawCapabilityUnavailableIcon"><CircleAlert size={22} aria-hidden="true"/></span>
    <div><h2>{title}</h2><p>{body}</p></div>
    {close === undefined ? null : <button type="button" onClick={close}><X size={16} aria-hidden="true"/>{closeLabel}</button>}
  </div>
}

export function CapabilitySidebarTab({ useResource, useTabInfo, sessionId }: PropsRuntime<'sidebar.right.pane.tab'>) {
  const { tab } = useTabInfo()
  const address = tab.contentId
  const resource = useResource<'clawclaw-capability'>(address)
  const entry = resource.value?.entry
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const locale = (document.documentElement.lang || navigator.language).toLowerCase().startsWith('en') ? 'en' : 'zh'
  if (resource.value === undefined) return null
  if (entry === undefined) {
    const labels = copy(locale)
    return <CapabilityUnavailable title={labels.expired} body={labels.expiredBody} closeLabel={labels.close} close={tab.actions?.close}/>
  }
  const labels = copy(entry.locale)
  const cached = entries.get(parseToken(address) ?? '')
  const direct = cached ?? (entry.select === undefined || entry.focusComposer === undefined
    ? undefined
    : { select: entry.select, focusComposer: entry.focusComposer })
  const actions: CapabilitySidebarActions | undefined = direct ?? resolveActions?.(entry, sessionId)
  const select = async (example: string): Promise<void> => {
    if (busy || actions === undefined) return
    setBusy(true)
    setError(undefined)
    try {
      if (!await actions.select(example)) throw new Error(labels.failed)
      requestAnimationFrame(actions.focusComposer)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.failed)
    } finally {
      setBusy(false)
    }
  }
  return <div className="clawCapabilitySidebar" data-capability-sidebar={entry.kind}>
    <div className="clawCapabilityScroll">
      {entry.kind === 'expert' ? <ExpertBody entry={entry}/> : <TeamBody entry={entry}/>}
      {actions === undefined
        ? <div className="clawCapabilityRestoreNotice"><CircleAlert size={17} aria-hidden="true"/><p>{labels.unavailable}</p></div>
        : <CapabilitySection title={labels.try} className="clawCapabilityExamples"><CapabilityExamples examples={entry.examples} busy={busy} select={example => { void select(example) }}/></CapabilitySection>}
      {error === undefined ? null : <p className="clawCapabilityError" role="alert">{error}</p>}
    </div>
    <footer>{actions === undefined
      ? tab.actions?.close === undefined ? null : <button type="button" className="clawCapabilityClose" onClick={tab.actions.close}><X size={17} aria-hidden="true"/>{labels.close}</button>
      : <button type="button" disabled={busy || entry.examples.length === 0} onClick={() => { const first = entry.examples[0]; if (first !== undefined) void select(first) }}><Play size={17} fill="currentColor" aria-hidden="true"/>{labels.test}</button>}</footer>
  </div>
}

export function openCapabilitySidebar(sidebarRight: Pick<ISidebarRight, 'openResource'> & Partial<Pick<ISidebarRight, 'mounted'>>, entry: CapabilitySidebarEntry): string {
  if (entry.select === undefined || entry.focusComposer === undefined) throw new Error('clawclaw capability: actions are required when opening details')
  const token = globalThis.crypto.randomUUID()
  entries.set(token, entry as ActionableCapabilitySidebarEntry)
  rememberEntry(token, entry)
  const address = entryAddress(token)
  const open = (): void => sidebarRight.openResource(address, { kind: CAPABILITY_SIDEBAR_KIND })
  const mounted = sidebarRight.mounted
  if (mounted !== undefined && mounted.getSnapshot() === undefined) {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const dispose = mounted.subscribe(() => {
      if (mounted.getSnapshot() === undefined) return
      dispose()
      if (timeout !== undefined) clearTimeout(timeout)
      try { open() } catch (cause) {
        forgetEntry(token)
        console.error('[clawclaw-experts] failed to open capability details:', cause)
      }
    })
    timeout = setTimeout(() => {
      dispose()
      forgetEntry(token)
    }, 15_000)
    return address
  }
  try {
    open()
  } catch (cause) {
    forgetEntry(token)
    throw cause
  }
  return address
}

export function applyCapabilitySidebar(ctx: Context, actionResolver?: CapabilitySidebarActionResolver): void {
  ctx.effect(() => {
    resolveActions = actionResolver
    return () => { if (resolveActions === actionResolver) resolveActions = undefined }
  }, 'clawclaw: capability sidebar actions')
  ctx.inject(['resources', 'sidebarRightTabs'], scope => {
    scope.effect(() => scope.resources.register(provider()), 'clawclaw: capability sidebar resources')
    scope.effect(() => scope.sidebarRightTabs.register({
      id: CAPABILITY_SIDEBAR_KIND,
      kind: CAPABILITY_SIDEBAR_KIND,
      patterns: [`${CAPABILITY_SIDEBAR_ADDRESS}**`],
      priority: 'extension',
      canOpen: address => parseToken(address) !== undefined,
      title: address => {
        const token = parseToken(address)
        const entry = token === undefined ? undefined : entries.get(token) ?? restoredEntry(token)
        return entry?.kind === 'team' ? entry.team.name : entry === undefined ? 'ClawClaw' : entry.locale === 'en' ? entry.expert.nameEn : entry.expert.name
      },
    } satisfies SidebarRightTabDefinition), 'clawclaw: capability sidebar tab')
    scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
      name: 'sidebar.right.pane.tab', key: CAPABILITY_SIDEBAR_KIND,
    }, CapabilitySidebarTab)), 'clawclaw: capability sidebar body')
  })
  const sidebar = typeof (ctx as { get?: unknown }).get === 'function'
    ? ctx.get('sidebarRight') as { registerCloseHandler?: (kind: string, handler: (_sessionId: SessionId, tab: { contentId: string }) => void) => () => void } | undefined
    : undefined
  if (sidebar?.registerCloseHandler !== undefined) ctx.effect(() => sidebar.registerCloseHandler!(CAPABILITY_SIDEBAR_KIND, (_sessionId, tab) => {
    const token = parseToken(tab.contentId)
    if (token !== undefined) forgetEntry(token)
  }), 'clawclaw: capability sidebar cleanup')
}

export const CAPABILITY_SIDEBAR_CSS = `
.clawCapabilitySidebar{position:absolute;inset:0;display:flex;min-width:0;min-height:0;flex-direction:column;container-type:inline-size;background:var(--dsw-alias-bg-layer-1)}
.clawCapabilityScroll{flex:1;min-height:0;overflow:auto;padding:28px 24px 36px}.clawCapabilityScroll>section{margin-top:28px}.clawCapabilityScroll h3{margin:0 0 12px;font-size:16px;line-height:24px}
.clawCapabilityHero{display:grid;grid-template-columns:84px minmax(0,1fr);align-items:start;gap:18px}.clawCapabilityVisual{display:grid;width:84px;height:84px;place-items:center}.clawCapabilityVisual>img{width:84px;height:84px;border-radius:8px;object-fit:cover}.clawCapabilityTeamVisual{transform:scale(1.55);transform-origin:center}.clawCapabilityIdentity{min-width:0}.clawCapabilityHero h2{margin:2px 0 8px;font-size:20px;line-height:28px}.clawCapabilityHero dl,.clawCapabilityHero dl div{margin:0}.clawCapabilityHero dl div{display:grid;grid-template-columns:max-content minmax(0,1fr);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:21px}.clawCapabilityHero dt,.clawCapabilityHero dd{margin:0;min-width:0}.clawCapabilityHero dd{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.clawCapabilityDescription{margin:0;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:24px}
.clawCapabilityTags{display:flex;flex-wrap:wrap;gap:7px}.clawCapabilityTags span{padding:4px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:18px}
.clawCapabilityMembers{display:grid}.clawCapabilityMembers>div{display:grid;grid-template-columns:40px minmax(0,1fr) auto;align-items:center;gap:12px;min-height:58px;border-bottom:1px solid var(--dsw-alias-border-l2)}.clawCapabilityMembers>div:last-child{border-bottom:0}.clawCapabilityMembers>div>span{display:grid;width:36px;height:36px;place-items:center;border-radius:50%;background:var(--dsw-alias-brand-primary);color:#fff;font-weight:650}.clawCapabilityMembers>div>img{width:36px;height:36px;border-radius:50%;object-fit:cover}.clawCapabilityMembers strong,.clawCapabilityMembers small{display:inline}.clawCapabilityMembers strong{font-size:13px;line-height:20px}.clawCapabilityMembers small{margin-left:8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.clawCapabilityMembers em{padding:2px 7px;border-radius:5px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:11px;font-style:normal;white-space:nowrap}
.clawCapabilityExamples h3{margin-bottom:10px}.clawCapabilityExampleList{display:grid;gap:8px}.clawCapabilityExampleList button{display:grid;grid-template-columns:minmax(0,1fr) 18px;align-items:center;gap:10px;width:100%;min-height:48px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer}.clawCapabilityExampleList button:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-3)}.clawCapabilityExampleList button:disabled{cursor:default;opacity:.55}.clawCapabilityExampleList span{min-width:0;overflow-wrap:anywhere;font-size:13px;line-height:20px}.clawCapabilityError{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.clawCapabilitySidebar>footer{flex:none;padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}.clawCapabilitySidebar>footer button{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:42px;border:0;border-radius:7px;background:var(--dsw-alias-brand-primary);color:#fff;font-size:14px;font-weight:600;cursor:pointer}.clawCapabilitySidebar>footer button:disabled{cursor:default;opacity:.55}.clawCapabilitySidebar>footer .clawCapabilityClose{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.clawCapabilityUnavailable{position:absolute;inset:0;display:grid;align-content:center;justify-items:center;gap:16px;padding:32px;text-align:center;background:var(--dsw-alias-bg-layer-1)}.clawCapabilityUnavailableIcon{display:grid;width:48px;height:48px;place-items:center;border-radius:50%;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}.clawCapabilityUnavailable h2{margin:0 0 6px;font-size:16px;line-height:24px}.clawCapabilityUnavailable p{max-width:320px;margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:21px}.clawCapabilityUnavailable button{display:flex;min-height:40px;align-items:center;justify-content:center;gap:7px;padding:0 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer}
.clawCapabilityRestoreNotice{display:grid;grid-template-columns:20px minmax(0,1fr);gap:10px;margin-top:28px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}.clawCapabilityRestoreNotice svg{margin-top:2px}.clawCapabilityRestoreNotice p{margin:0;font-size:13px;line-height:21px}
@container(max-width:360px){.clawCapabilityScroll{padding:20px 16px 28px}.clawCapabilityHero{grid-template-columns:64px minmax(0,1fr);gap:12px}.clawCapabilityVisual{width:64px;height:64px}.clawCapabilityVisual>img{width:64px;height:64px}.clawCapabilityTeamVisual{transform:scale(1.3)}.clawCapabilityHero dl div{font-size:12px}.clawCapabilityMembers small{display:block;margin-left:0}}
`
