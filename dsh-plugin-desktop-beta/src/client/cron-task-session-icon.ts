/** Sidebar/search source marker and legacy-title migration for Cron conversations. */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { cronSessionTitle, isCronSessionId, parseCronSessionTitle } from '../cron-session-title.ts'

const SOURCE_ATTR = 'data-dsh-cron-session'
const TITLE_ATTR = 'data-dsh-cron-session-title'
const FONT_SIZE = '--dsh-cron-session-title-font-size'
const LINE_HEIGHT = '--dsh-cron-session-title-line-height'
const MARKED = `[${SOURCE_ATTR}]`
const ROW = '[role="treeitem"][aria-selected]'
const HEADER = 'button:disabled'
const installations = new WeakMap<Document, { references: number; close: () => void }>()

interface CronSessionIconSessions {
  readonly list: ObservableSnapshot<SessionListState>
  binding(sessionId: SessionId): { session: { rename(title: string): Promise<{ ok: boolean; error?: { message: string } }> } } | undefined
}

function hasClassPart(element: Element, part: string): boolean {
  const match = new RegExp(`(?:^|[_-])${part}(?:$|[_-])`, 'u')
  return [...element.classList].some(token => match.test(token))
}

function titleOf(row: Element): HTMLElement | undefined {
  if (row.matches(HEADER) && hasClassPart(row, 'crumbCurrent')) {
    return row instanceof HTMLElement && row.childNodes.length === 1 && row.firstChild?.nodeType === Node.TEXT_NODE
      ? row : undefined
  }
  if (!row.matches(ROW)) return undefined
  let title: Element | undefined
  if (row.tagName === 'DIV' && hasClassPart(row, 'sessionRow')) {
    title = [...row.children].find(child => child.tagName === 'SPAN' && hasClassPart(child, 'title'))
  } else if (row.tagName === 'BUTTON' && hasClassPart(row, 'searchResultRow')) {
    const heading = [...row.children].find(child => hasClassPart(child, 'searchResultHeading'))
    title = heading === undefined ? undefined : [...heading.children]
      .find(child => child.tagName === 'SPAN' && hasClassPart(child, 'searchResultTitle'))
  }
  return title instanceof HTMLElement && title.childNodes.length === 1 && title.firstChild?.nodeType === Node.TEXT_NODE
    ? title : undefined
}

function createDomInstallation(document: Document, label: string): () => void {
  const owned = new Map<HTMLElement, ReadonlyArray<readonly [string, string | null]>>()
  const queued = new Set<Element>()
  let closed = false
  let scheduled = false
  const style = document.createElement('style')
  style.dataset.pluginCss = 'dsh-desktop-cron-session-icons'
  // Clock 3 path data is from Lucide; a mask lets it inherit the sidebar text color.
  const icon = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 6v6h4"/%3E%3C/svg%3E'
  style.textContent = `
${MARKED}[${TITLE_ATTR}]{position:relative;-webkit-text-fill-color:transparent;text-overflow:clip!important;overflow:hidden}
${MARKED}[${TITLE_ATTR}]::before{content:"";position:absolute;inset-inline-start:0;top:50%;width:16px;height:16px;transform:translateY(-50%);background:currentColor;mask:url('${icon}') center/contain no-repeat;-webkit-mask:url('${icon}') center/contain no-repeat;pointer-events:none}
${MARKED}[${TITLE_ATTR}]::after{content:attr(${TITLE_ATTR}) / "";position:absolute;inset:0;inset-inline-start:22px;-webkit-text-fill-color:currentColor;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;pointer-events:none}
${HEADER}${MARKED}[${TITLE_ATTR}]{display:inline-flex;align-items:center;justify-content:flex-start;gap:8px;width:auto;max-width:100%;font-size:0}
${HEADER}${MARKED}[${TITLE_ATTR}]::before{position:static;flex:0 0 16px;transform:none}
${HEADER}${MARKED}[${TITLE_ATTR}]::after{position:static;min-width:0;inset:auto;display:block;font-size:var(${FONT_SIZE});line-height:var(${LINE_HEIGHT})}
`
  document.head.appendChild(style)

  const restore = (title: HTMLElement): void => {
    const previous = owned.get(title)
    if (previous === undefined) return
    owned.delete(title)
    for (const [attribute, value] of previous) {
      if (value === null) title.removeAttribute(attribute)
      else title.setAttribute(attribute, value)
    }
  }
  const update = (row: Element): void => {
    const title = row.isConnected ? titleOf(row) : undefined
    const marked = [...row.querySelectorAll<HTMLElement>(MARKED)]
    if (row instanceof HTMLElement && row.matches(MARKED)) marked.push(row)
    for (const item of marked) if (item !== title) restore(item)
    if (title === undefined) return
    const parsed = parseCronSessionTitle(title.textContent ?? '')
    if (parsed === undefined) { restore(title); return }
    if (!owned.has(title)) {
      owned.set(title, [SOURCE_ATTR, TITLE_ATTR, 'aria-label', 'style'].map(attribute => [attribute, title.getAttribute(attribute)] as const))
      if (title.matches(HEADER)) {
        const computed = document.defaultView?.getComputedStyle(title)
        title.style.setProperty(FONT_SIZE, computed?.fontSize || '14px')
        title.style.setProperty(LINE_HEIGHT, computed?.lineHeight || 'normal')
      }
    }
    title.setAttribute(SOURCE_ATTR, '')
    title.setAttribute(TITLE_ATTR, parsed)
    title.setAttribute('aria-label', `${label}: ${parsed}`)
  }
  const schedule = (): void => {
    if (closed || scheduled || queued.size === 0) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (closed) return
      const rows = [...queued]
      queued.clear()
      for (const row of rows) update(row)
    })
  }
  const collect = (node: Node, descendants = false): void => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
    if (element === null) return
    const row = element.closest(ROW) ?? element.closest(HEADER)
    if (row !== null) queued.add(row)
    if (descendants) for (const child of element.querySelectorAll(`${ROW},${HEADER}`)) queued.add(child)
    schedule()
  }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      collect(record.target)
      if (record.type === 'childList') for (const node of record.addedNodes) collect(node, true)
    }
  })
  observer.observe(document.body, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'role', 'aria-selected'] })
  collect(document.body, true)
  return () => {
    closed = true
    observer.disconnect()
    queued.clear()
    for (const title of [...owned.keys()]) restore(title)
    style.remove()
  }
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
