/** Shared across the three features; abort alone does not release physical work. */
const busy = new WeakSet<object>()
export async function exclusiveInputCall<T>(owner: object, signal: AbortSignal, work: () => Promise<T>): Promise<T | undefined> {
  signal.throwIfAborted()
  if (busy.has(owner)) return undefined
  busy.add(owner)
  try { return await work() }
  finally { busy.delete(owner) }
}
