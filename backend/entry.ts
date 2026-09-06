import { createInterface } from 'node:readline';
import { format } from 'node:util';
import { completeNative, dispatch, send } from './host/transport';
// stdout is exclusively the framed protocol; all application logs use stderr.
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  console[level] = (...args: unknown[]) => { process.stderr.write(`${format(...args)}\n`); };
}
const { initialize, shutdown } = await import('./core/main');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 15_000);
  await shutdown(); clearTimeout(deadline); process.exit(0);
}
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {
  if (line.length > 32 * 1024 * 1024) return;
  void (async () => {
    const message = JSON.parse(line);
    if (message.type === 'native_result') { completeNative(message); return; }
    if (message.type === 'shutdown') { await stop(); return; }
    if (message.type !== 'request' || typeof message.id !== 'string' || !Array.isArray(message.args)) return;
    try { send({ type: 'response', id: message.id, data: await dispatch(message.channel, message.args) ?? null }); }
    catch (error) { send({ type: 'response', id: message.id, error: error instanceof Error ? error.message : String(error) }); }
  })().catch(error => console.error('Invalid host message:', error));
}).on('close', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
await initialize();
