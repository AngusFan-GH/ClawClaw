import { randomUUID } from 'node:crypto';
const write = process.stdout.write.bind(process.stdout);
export function send(message: unknown): void { write(`${JSON.stringify(message)}\n`); }
const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
export function nativeRequest<T = any>(command: string, payload: unknown = null): Promise<T> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Desktop request timed out: ${command}`)); }, 300_000);
    pending.set(id, { resolve, reject, timer });
    send({ type: 'native', id, command, payload });
  });
}
export function completeNative(message: { id: string; error?: string; data?: unknown }): void {
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id); clearTimeout(request.timer);
  if (message.error) request.reject(new Error(message.error)); else request.resolve(message.data);
}
export function emitDesktop(channel: string, ...args: unknown[]): void { send({ type: 'event', channel, args }); }
type Handler = (event: undefined, ...args: any[]) => unknown;
const handlers = new Map<string, Handler>();
export const requestHandlers = {
  handle(channel: string, handler: Handler) {
    if (handlers.has(channel)) throw new Error(`Duplicate host handler: ${channel}`);
    handlers.set(channel, handler);
  },
  removeHandler(channel: string) { handlers.delete(channel); },
};
export async function dispatch(channel: string, args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`Unsupported host operation: ${channel}`);
  return await handler(undefined, ...args);
}
