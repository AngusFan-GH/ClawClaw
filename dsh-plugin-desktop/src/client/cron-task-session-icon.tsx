/** rc.2 Session presentation and legacy-title migration for Cron conversations. */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { DesktopFeatureIcon } from './desktop-feature-icon.tsx'
import { cronSessionTitle, isCronSessionId, parseCronSessionTitle } from '../cron-session-title.ts'

const SOURCE_ATTR = 'data-dsh-cron-session'
const RAW_TITLE_ATTR = 'data-dsh-cron-session-raw-title'
const PRESENTATION_SELECTOR = '[class*="title"], [class*="Title"], [class*="crumbCurrent"]'
const installations = new WeakMap<Document, { references: number; close: () => void }>()

interface CronSessionIconSessions {
  readonly list: ObservableSnapshot<SessionListState>
  binding(sessionId: SessionId): { session: { rename(title: string): Promise<{ ok: boolean; error?: { message: string } }> } } | undefined
}

function hasClassPart(element: Element, part: string): boolean {
  const match = new RegExp(`(?:^|[_-])${part}(?:$|[_-])`, 'u')
  return [...element.classList].some(token => match.test(token))
}

function surfaceOf(element: Element): 'row' | 'search' | 'hover' | 'header' | undefined {
  if (hasClassPart(element, 'searchResultTitle')) return 'search'
  if (hasClassPart(element, 'hoverTitle')) return 'hover'
  if (hasClassPart(element, 'crumbCurrent')) return 'header'
  if (hasClassPart(element, 'title') && element.closest('[role="treeitem"][aria-selected]') !== null) return 'row'
  return undefined
}

function clockIcon(document: Document): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke-width', '1')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('data-dsh-session-source-icon', 'cron')
  for (const pathData of [
    'M8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14Z',
    'M8 4.31V8.46L11 10.08',
  ]) {
    const path = document.createElementNS(ns, 'path')
    path.setAttribute('d', pathData)
    path.setAttribute('stroke', 'currentColor')
    svg.append(path)
  }
  return svg
}

function createDomInstallation(document: Document, label: string): () => void {
  const owned = new Set<HTMLElement>()
  const queued = new Set<Element>()
  let closed = false
  let scheduled = false
  const style = document.createElement('style')
  style.dataset.pluginCss = 'dsh-desktop-cron-session-presentation'
  style.textContent = `
[${SOURCE_ATTR}]:not([data-dsh-session-source-surface="row"]){display:inline-flex;align-items:center;gap:6px;min-width:0}
[${SOURCE_ATTR}]>[data-dsh-session-source-icon="cron"]{flex:0 0 16px;color:currentColor}
[data-dsh-cron-session-leading]{display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px;color:var(--dsw-alias-label-tertiary)}
`
  document.head.appendChild(style)

  const restore = (element: HTMLElement): void => {
    if (!owned.delete(element)) return
    const raw = element.getAttribute(RAW_TITLE_ATTR)
    element.querySelector(':scope > [data-dsh-session-source-icon="cron"]')?.remove()
    if (raw !== null) element.textContent = raw
    element.removeAttribute(SOURCE_ATTR)
    element.removeAttribute(RAW_TITLE_ATTR)
    element.removeAttribute('data-dsh-session-source-surface')
    element.removeAttribute('aria-label')
  }
  const update = (element: Element): void => {
    if (!(element instanceof HTMLElement) || !element.isConnected) return
    const surface = surfaceOf(element)
    if (surface === undefined) { restore(element); return }
    const text = element.textContent ?? ''
    const parsed = parseCronSessionTitle(text)
    if (parsed === undefined) {
      if (!element.hasAttribute(SOURCE_ATTR)) return
      return
    }
    owned.add(element)
    element.setAttribute(SOURCE_ATTR, '')
    element.setAttribute(RAW_TITLE_ATTR, text)
    element.setAttribute('data-dsh-session-source-surface', surface)
    element.setAttribute('aria-label', `${label}: ${parsed}`)
    element.replaceChildren(...surface === 'row' ? [] : [clockIcon(document)], document.createTextNode(parsed))
  }
  const schedule = (): void => {
    if (closed || scheduled || queued.size === 0) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (closed) return
      const elements = [...queued]
      queued.clear()
      for (const element of elements) update(element)
    })
  }
  const collect = (node: Node, descendants = false): void => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
    if (element === null) return
    if (element.matches(PRESENTATION_SELECTOR)) queued.add(element)
    const closest = element.closest(PRESENTATION_SELECTOR)
    if (closest !== null) queued.add(closest)
    if (descendants) for (const child of element.querySelectorAll(PRESENTATION_SELECTOR)) queued.add(child)
    schedule()
  }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      collect(record.target)
      if (record.type === 'childList') for (const node of record.addedNodes) collect(node, true)
    }
  })
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] })
  collect(document.body, true)
  return () => {
    closed = true
    observer.disconnect()
    queued.clear()
    for (const element of [...owned]) restore(element)
    style.remove()
  }
}

/** Canonical Automation glyph in the rc.2 Session-row leading seat. */
export function CronSessionLeading({ sessionId }: { readonly sessionId: SessionId }): JSX.Element | null {
  if (!isCronSessionId(String(sessionId))) return null
  return <span data-dsh-cron-session-leading=""><DesktopFeatureIcon featureId="desktop-automations" kind="panel" /></span>
}

export function installCronTaskSessionIcons(options: {
  readonly sessions: CronSessionIconSessions
  readonly label: string
  readonly document?: Document | undefined
  readonly warn?: ((message: string, reason: unknown) => void) | undefined
}): () => void {
  const document = options.document ?? globalThis.document
  const warn = options.warn ?? ((message, reason) => { console.warn(message, reason) })
  let dom = installations.get(document)
  if (dom === undefined) {
    dom = { references: 0, close: createDomInstallation(document, options.label) }
    installations.set(document, dom)
  }
  dom.references += 1
  const renaming = new Set<string>()
  const migrate = (): void => {
    const snapshot = options.sessions.list.getSnapshot()
    for (const id of snapshot.ids) {
      const sessionId = String(id)
      const title = snapshot.byId[id]?.title
      if (!isCronSessionId(sessionId) || title === undefined || parseCronSessionTitle(title) !== undefined || renaming.has(sessionId)) continue
      const session = options.sessions.binding(id)?.session
      if (session === undefined) continue
      renaming.add(sessionId)
      void session.rename(cronSessionTitle(title)).then(result => {
        if (!result.ok) warn('failed to mark scheduled task conversation:', result.error?.message)
      }, reason => { warn('failed to mark scheduled task conversation:', reason) }).finally(() => { renaming.delete(sessionId) })
    }
  }
  const stop = options.sessions.list.subscribe(migrate)
  migrate()
  let released = false
  return () => {
    if (released) return
    released = true
    stop()
    renaming.clear()
    dom.references -= 1
    if (dom.references === 0) {
      dom.close()
      installations.delete(document)
    }
  }
}
