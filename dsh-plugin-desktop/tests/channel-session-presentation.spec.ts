// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
// @ts-expect-error The owned JavaScript channel adapter is exercised across package boundaries.
import { installChannelSessionPresentation } from '../../channels/dsh-im/client/session-presentation.js'
let dispose: (() => void) | undefined
const logos = { weixin: () => ({ type: 'svg', props: { viewBox: '0 0 16 16' } }), feishu: () => ({ type: 'svg', props: { viewBox: '0 0 16 16' } }) }
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren() })
it('keeps an official channel icon beside the clean title when activity occupies the leading seat', async () => {
  document.body.innerHTML = '<div role="treeitem" aria-selected="false"><span data-status="running"></span><span class="_title_test">微信 · Hi</span></div>'
  const title = document.querySelector<HTMLElement>('._title_test')!
  const text = title.firstChild
  dispose = installChannelSessionPresentation(logos)
  await flush()
  expect(title.textContent).toBe('Hi')
  expect(title.lastChild).toBe(text)
  expect(title.querySelector('[data-dsh-session-source-icon="weixin"]')).not.toBeNull()
  expect(title.getAttribute('data-dsh-im-session-channel')).toBe('weixin')
  expect(document.querySelector('[data-status="running"]')).not.toBeNull()
})
it('does not restore stale channel text over a React-updated ordinary row', async () => {
  document.body.innerHTML = '<div role="treeitem" aria-selected="false"><span class="_title_test">飞书 · Original</span></div>'
  const title = document.querySelector<HTMLElement>('._title_test')!
  dispose = installChannelSessionPresentation(logos); await flush()
  title.lastChild!.nodeValue = 'New ordinary title'; await flush()
  expect(title.querySelector('svg')).toBeNull()
  dispose!(); dispose = undefined
  expect(title.textContent).toBe('New ordinary title')
  expect(title.hasAttribute('data-dsh-im-session-channel')).toBe(false)
})
it('preserves compact search/header logos and cleans up without overwriting new titles', async () => {
  document.body.innerHTML = '<span class="_searchResultTitle_test">微信 · Hi</span><span class="_crumbCurrent_test">飞书 · Report</span>'
  dispose = installChannelSessionPresentation(logos); await flush()
  const search = document.querySelector<HTMLElement>('._searchResultTitle_test')!
  const header = document.querySelector<HTMLElement>('._crumbCurrent_test')!
  expect(search.textContent).toBe('Hi'); expect(search.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 16 16')
  expect(header.textContent).toBe('Report')
  header.textContent = 'User changed title'; await flush()
  dispose!(); dispose = undefined
  expect(search.textContent).toBe('微信 · Hi'); expect(header.textContent).toBe('User changed title')
})

// @ts-expect-error Desktop-owned JavaScript asset registry.
import { CHANNEL_LOGOS } from '../../channels/dsh-im/client/channel-icons.js'
// @ts-expect-error Pinned channel title vocabulary, shared with the runtime.
import { SESSION_CHANNEL_LABELS } from '../../channels/dsh-im/node_modules/@xmanrui/dsh-im/src/channels/shared/session-channel-labels.mjs'
it('renders official embedded images consistently in search, headers, and hover cards', async () => {
  const channels = Object.keys(CHANNEL_LOGOS).filter(channel => channel !== 'office')
  for (const channel of channels) {
    for (const surface of ['searchResultTitle', 'crumbCurrent', 'hoverTitle']) {
      const title = document.createElement('span')
      title.className = `_${surface}_test`
      title.textContent = `${SESSION_CHANNEL_LABELS[channel][0]} · Test ${channel}`
      document.body.append(title)
    }
  }
  dispose = installChannelSessionPresentation(CHANNEL_LOGOS); await flush()
  expect(document.querySelectorAll('img')).toHaveLength(channels.length * 3)
  for (const image of document.querySelectorAll('img')) {
    const channel = image.getAttribute('data-im-channel-logo')!
    expect(image.namespaceURI).toBe('http://www.w3.org/1999/xhtml')
    expect(image.getAttribute('src')).toBe(CHANNEL_LOGOS[channel]({ size: 16 }).props.src)
    expect(image.width).toBe(16); expect(image.height).toBe(16)
    expect(image.parentElement!.textContent).toBe(`Test ${channel}`)
  }
  dispose!(); dispose = undefined
  expect(document.querySelectorAll('img')).toHaveLength(0)
  for (const title of document.body.children) expect(title.textContent).toContain(' · Test ')
})

it('does not duplicate icons or restore stale text when a channel row is renamed', async () => {
  document.body.innerHTML = '<div role="treeitem" aria-selected="true"><span data-dsh-im-session-leading="qq"></span><span class="_title_test">QQ · Greeting</span></div>'
  const title = document.querySelector<HTMLElement>('._title_test')!
  dispose = installChannelSessionPresentation(CHANNEL_LOGOS); await flush()
  expect(title.textContent).toBe('Greeting')
  expect(title.querySelectorAll('img')).toHaveLength(1)
  const fallback = title.querySelector('img')!
  const leading = document.querySelector('[data-dsh-im-session-leading]')!
  expect(getComputedStyle(fallback).display).toBe('none')
  leading.remove()
  expect(getComputedStyle(fallback).display).toBe('inline-block')
  title.parentElement!.prepend(leading)
  expect(getComputedStyle(fallback).display).toBe('none')
  title.textContent = 'QQ · Renamed'; await flush()
  expect(title.textContent).toBe('Renamed')
  expect(title.querySelectorAll('img')).toHaveLength(1)
  dispose!(); dispose = undefined
  expect(title.textContent).toBe('QQ · Renamed')
})
