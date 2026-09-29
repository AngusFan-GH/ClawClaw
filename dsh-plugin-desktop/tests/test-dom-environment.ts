/** Initial resize delivery from jsdom's modeled offsets. */
import { afterAll, beforeEach } from 'vitest'

const original = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')
const originalGetAnimations = typeof Element === 'undefined'
  ? undefined
  : Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations')
let installed = false

class TestResizeObserver implements ResizeObserver {
  private readonly targets = new Set<Element>()

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    if (this.targets.has(target)) return
    this.targets.add(target)
    const width = target instanceof HTMLElement ? target.offsetWidth : 0
    const height = target instanceof HTMLElement ? target.offsetHeight : 0
    const size = [{ inlineSize: width, blockSize: height }]
    this.callback([{
      target,
      contentRect: new DOMRectReadOnly(0, 0, width, height),
      borderBoxSize: size,
      contentBoxSize: size,
      devicePixelContentBoxSize: size,
    }], this)
  }

  unobserve(target: Element): void { this.targets.delete(target) }
  disconnect(): void { this.targets.clear() }
}

beforeEach(() => {
  if (typeof document !== 'undefined' && typeof ResizeObserver === 'undefined') {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: TestResizeObserver,
    })
    installed = true
  }
  if (typeof Element !== 'undefined' && typeof Element.prototype.getAnimations !== 'function') {
    Object.defineProperty(Element.prototype, 'getAnimations', {
      configurable: true,
      writable: true,
      value: () => [],
    })
  }
})

afterAll(() => {
  if (!installed) return
  if (original === undefined) Reflect.deleteProperty(globalThis, 'ResizeObserver')
  else Object.defineProperty(globalThis, 'ResizeObserver', original)
  if (typeof Element !== 'undefined') {
    if (originalGetAnimations === undefined) Reflect.deleteProperty(Element.prototype, 'getAnimations')
    else Object.defineProperty(Element.prototype, 'getAnimations', originalGetAnimations)
  }
})
