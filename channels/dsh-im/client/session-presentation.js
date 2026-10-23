import * as React from 'react'
import { COMPACT_CHANNEL_ICON_CSS } from './channel-icons.js'
import { parseSessionChannelTitle } from '../node_modules/@xmanrui/dsh-im/src/channels/shared/session-channel-labels.mjs'

const SOURCE_ATTR = 'data-dsh-im-session-channel'
const RAW_TITLE_ATTR = 'data-dsh-im-session-raw-title'
const PRESENTATION_SELECTOR = '[class*="title"], [class*="Title"], [class*="crumbCurrent"]'
const CHANNEL_IDS = Object.freeze([
  'weixin', 'feishu', 'dingtalk', 'wecom', 'qq', 'slack', 'telegram', 'discord', 'whatsapp', 'imessage', 'office',
])
const SESSION_ID = new RegExp(`^(${CHANNEL_IDS.join('|')})-`, 'u')
const installations = new WeakMap()

export function channelFromSessionId(sessionId) {
  return SESSION_ID.exec(String(sessionId))?.[1] ?? null
}

export function channelForSession(sessionId, title) {
  return parseSessionChannelTitle(title)?.channel ?? channelFromSessionId(sessionId)
}

function hasClassPart(element, part) {
  const match = new RegExp(`(?:^|[_-])${part}(?:$|[_-])`, 'u')
  return [...element.classList].some(token => match.test(token))
}

function surfaceOf(element) {
  if (hasClassPart(element, 'searchResultTitle')) return 'search'
  if (hasClassPart(element, 'hoverTitle')) return 'hover'
  if (hasClassPart(element, 'crumbCurrent')) return 'header'
  if (hasClassPart(element, 'title') && element.closest('[role="treeitem"][aria-selected]')) return 'row'
  return null
}

export function svgAttributeName(name) {
  if (name === 'viewBox' || name === 'preserveAspectRatio') return name
  return name.replace(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`)
}

function domNode(document, reactNode) {
  if (typeof reactNode === 'string') return document.createTextNode(reactNode)
  if (!reactNode || typeof reactNode.type !== 'string') throw new Error('Unsupported channel logo element')
  const element = reactNode.type === 'img'
    ? document.createElement('img')
    : document.createElementNS('http://www.w3.org/2000/svg', reactNode.type)
  for (const [name, value] of Object.entries(reactNode.props)) {
    if (name === 'children' || value == null || typeof value === 'boolean') continue
    const attribute = svgAttributeName(name)
    element.setAttribute(attribute, String(value))
  }
  for (const child of [reactNode.props.children].flat(Infinity).filter(Boolean)) element.append(domNode(document, child))
  return element
}

function logoNode(document, Logo, channel) {
  const svg = domNode(document, Logo({ size: 16 }))
  svg.setAttribute('data-dsh-session-source-icon', channel)
  return svg
}

export function ChannelSessionLeading({ sessionId, logos, sessions }) {
  const list = React.useSyncExternalStore(
    listener => sessions.list.subscribe(listener),
    () => sessions.list.getSnapshot(),
    () => sessions.list.getSnapshot(),
  )
  const summary = list.byId[sessionId]
  const channel = channelForSession(sessionId, summary?.title ?? summary?.displayTitle)
  const Logo = channel && logos[channel]
  if (!Logo) return null
  return React.createElement('span', {
    'data-dsh-im-session-leading': channel,
    'aria-hidden': 'true',
  }, React.createElement(Logo, { size: 16 }))
}

export function installChannelSessionPresentation(logos, document = globalThis.document) {
  let entry = installations.get(document)
  if (entry) {
    entry.references += 1
    return () => release(document, entry)
  }
  const owned = new Set()
  const renderedText = new Map()
  const queued = new Set()
  let closed = false
  let scheduled = false
  const style = document.createElement('style')
  style.dataset.pluginCss = 'clawclaw-im-session-presentation'
  style.textContent = `
[${SOURCE_ATTR}]:not([data-dsh-session-source-surface="row"]){display:inline-flex;align-items:center;gap:6px;min-width:0}
[${SOURCE_ATTR}]>[data-dsh-session-source-icon]{flex:0 0 16px}
[data-dsh-im-session-leading]{display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px}
${COMPACT_CHANNEL_ICON_CSS}
[data-dsh-session-source-surface="row"]>[data-dsh-session-source-icon]{display:inline-block;vertical-align:-3px;margin-right:6px}
[role="treeitem"]:has([data-dsh-im-session-leading]) [data-dsh-session-source-surface="row"]>[data-dsh-session-source-icon]{display:none}
`
  document.head.append(style)

  const restore = (element, restoreText = true) => {
    if (!owned.delete(element)) return
    const raw = element.getAttribute(RAW_TITLE_ATTR)
    if (restoreText && raw !== null && element.textContent === renderedText.get(element) && element.textContent !== raw) element.textContent = raw
    for (const child of [...element.children]) {
      if (child.hasAttribute('data-dsh-session-source-icon')) child.remove()
    }
    renderedText.delete(element)
    element.removeAttribute(SOURCE_ATTR)
    element.removeAttribute(RAW_TITLE_ATTR)
    element.removeAttribute('data-dsh-session-source-surface')
  }
  const update = element => {
    if (!(element instanceof HTMLElement) || !element.isConnected) return
    const surface = surfaceOf(element)
    if (!surface) { restore(element); return }
    if (owned.has(element) && element.getAttribute('data-dsh-session-source-surface') !== surface) restore(element)
    const text = element.textContent ?? ''
    const parsed = parseSessionChannelTitle(text)
    if (!parsed) {
      if (owned.has(element) && text !== renderedText.get(element)) restore(element, false)
      return
    }
    const Logo = logos[parsed.channel]
    if (!Logo) { restore(element, false); return }
    owned.add(element)
    element.setAttribute(SOURCE_ATTR, parsed.channel)
    element.setAttribute(RAW_TITLE_ATTR, text)
    element.setAttribute('data-dsh-session-source-surface', surface)
    // Idle rows use the native leading seat. A second image in the title is
    // visible only when activity/attention occupies that seat, so removing the
    // textual channel prefix never removes the channel identity.
    renderedText.set(element, parsed.title)
    if (surface === 'row') {
      const textNode = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE)
      if (textNode && element.childNodes.length === 1) {
        textNode.nodeValue = parsed.title
        element.insertBefore(logoNode(document, Logo, parsed.channel), textNode)
        return
      }
    }
    element.replaceChildren(logoNode(document, Logo, parsed.channel), document.createTextNode(parsed.title))
  }
  const schedule = () => {
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
  const collect = (node, descendants = false) => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
    if (!element) return
    if (element.matches(PRESENTATION_SELECTOR)) queued.add(element)
    const closest = element.closest(PRESENTATION_SELECTOR)
    if (closest) queued.add(closest)
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
  entry = {
    references: 1,
    close: () => {
      closed = true
      observer.disconnect()
      queued.clear()
      for (const element of [...owned]) restore(element)
      style.remove()
    },
  }
  installations.set(document, entry)
  return () => release(document, entry)
}

function release(document, entry) {
  entry.references -= 1
  if (entry.references > 0) return
  entry.close()
  installations.delete(document)
}
