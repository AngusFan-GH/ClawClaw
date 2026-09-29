import assert from 'node:assert/strict'
import test from 'node:test'

import { installChannelNavIcon } from '../client/nav-icon.js'

test('replaces only the message-channel navigation fallback icon', () => {
  const created = []
  let replacement
  let disconnected = false
  const fallback = {
    dataset: {},
    getAttribute: name => name === 'class' ? 'settings-nav-icon' : null,
    replaceWith: value => { replacement = value },
  }
  const channelButton = {
    children: [{ tagName: 'SPAN', textContent: '消息渠道' }],
    querySelector: selector => selector === ':scope > svg' ? fallback : null,
  }
  const unrelatedButton = {
    children: [{ tagName: 'SPAN', textContent: '通用' }],
    querySelector: () => { throw new Error('unrelated navigation icon was inspected') },
  }
  globalThis.document = {
    body: {},
    querySelectorAll: selector => selector === 'button' ? [unrelatedButton, channelButton] : [],
    createElementNS: (_namespace, tagName) => {
      const element = {
        tagName,
        attributes: {},
        dataset: {},
        children: [],
        setAttribute(name, value) { this.attributes[name] = value },
        append(child) { this.children.push(child) },
      }
      created.push(element)
      return element
    },
  }
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() { disconnected = true }
  }

  try {
    const dispose = installChannelNavIcon()
    assert.equal(replacement, created[0])
    assert.equal(replacement.dataset.clawclawChannelIcon, 'true')
    assert.equal(replacement.attributes.class, 'settings-nav-icon')
    assert.equal(replacement.attributes.viewBox, '0 0 16 16')
    assert.equal(replacement.children[0].attributes.fill, 'currentColor')
    dispose()
    assert.equal(disconnected, true)
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
  }
})
