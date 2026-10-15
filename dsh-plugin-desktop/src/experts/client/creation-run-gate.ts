export interface RunningSessionSnapshot {
  readonly running: boolean
}

export interface RunningSessionSource {
  getSnapshot(): RunningSessionSnapshot
  subscribe(listener: () => void): () => void
}

/**
 * Creation may write its package before the assistant finishes replying. Keep
 * the detected result private until this conversation has actually run and
 * returned to idle.
 */
export class CreationRunGate<T> {
  private observedRunning = false
  private finished = false
  private result: T | undefined

  observe(running: boolean): T | undefined {
    if (running) this.observedRunning = true
    else if (this.observedRunning) this.finished = true
    return this.takeReady()
  }

  detect(result: T): T | undefined {
    this.result = result
    return this.takeReady()
  }

  private takeReady(): T | undefined {
    if (!this.finished || this.result === undefined) return undefined
    const ready = this.result
    this.result = undefined
    return ready
  }
}

/** Subscribe immediately and include the current snapshot in the lifecycle. */
export function observeCreationRun<T>(
  source: RunningSessionSource,
  gate: CreationRunGate<T>,
  ready: (result: T) => void,
): () => void {
  const observe = (): void => {
    const result = gate.observe(source.getSnapshot().running)
    if (result !== undefined) ready(result)
  }
  observe()
  return source.subscribe(observe)
}
