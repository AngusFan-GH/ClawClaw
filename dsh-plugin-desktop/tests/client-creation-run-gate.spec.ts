import { describe, expect, it, vi } from 'vitest'
import { CreationRunGate, observeCreationRun } from '../src/experts/client/creation-run-gate.ts'

describe('creation conversation run gate', () => {
  it('does not reveal a detected capability before the conversation runs', () => {
    const gate = new CreationRunGate<string>()
    expect(gate.observe(false)).toBeUndefined()
    expect(gate.detect('created-expert')).toBeUndefined()
    expect(gate.observe(false)).toBeUndefined()
  })

  it('reveals a detected capability only after running returns to idle', () => {
    const gate = new CreationRunGate<string>()
    expect(gate.observe(true)).toBeUndefined()
    expect(gate.detect('created-team')).toBeUndefined()
    expect(gate.observe(true)).toBeUndefined()
    expect(gate.observe(false)).toBe('created-team')
  })

  it('waits for a late package when the conversation has already finished', () => {
    const gate = new CreationRunGate<string>()
    expect(gate.observe(true)).toBeUndefined()
    expect(gate.observe(false)).toBeUndefined()
    expect(gate.detect('created-expert')).toBe('created-expert')
  })

  it('subscribes to the session snapshot lifecycle', () => {
    let running = false
    let listener: () => void = () => undefined
    const ready = vi.fn()
    const dispose = vi.fn()
    const gate = new CreationRunGate<string>()
    observeCreationRun({
      getSnapshot: () => ({ running }),
      subscribe: next => { listener = next; return dispose },
    }, gate, ready)
    gate.detect('created-team')

    running = true
    listener()
    expect(ready).not.toHaveBeenCalled()
    running = false
    listener()
    expect(ready).toHaveBeenCalledExactlyOnceWith('created-team')
  })
})
