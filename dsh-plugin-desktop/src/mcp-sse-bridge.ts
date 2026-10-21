/** Desktop-owned legacy HTTP+SSE transport. stdout carries JSON-RPC only.
 * The upstream stdio supervisor owns process lifetime and reconnect policy.
 */
import { ReadBuffer, SSEClientTransport, serializeMessage } from '@modelcontextprotocol/client'

async function main(): Promise<void> {
  const url = process.env.CLAWCLAW_MCP_SSE_URL
  const headers = JSON.parse(process.env.CLAWCLAW_MCP_SSE_HEADERS ?? '{}') as Record<string, string>
  delete process.env.CLAWCLAW_MCP_SSE_HEADERS
  delete process.env.CLAWCLAW_MCP_SSE_URL
  if (url === undefined) throw new Error('SSE endpoint is required')
  const origin = new URL(url).origin
  // Both GET and POST use the same headers. Redirects must not leak custom
  // credentials; the SDK also rejects cross-origin endpoint events.
  const transport = new SSEClientTransport(new URL(url), {
    requestInit: { headers },
    fetch: async (input, init) => {
      if (new URL(input instanceof Request ? input.url : String(input)).origin !== origin) {
        throw new Error('SSE request origin changed')
      }
      return fetch(input, { ...init, redirect: 'error' })
    },
  })
  let stopping = false
  const stop = async (code: number): Promise<void> => {
    if (stopping) return
    stopping = true
    await transport.close()
    process.exit(code)
  }
  process.once('SIGTERM', () => { void stop(0) })
  process.once('SIGINT', () => { void stop(0) })
  process.stdin.once('end', () => { void stop(0) })
  process.stdout.once('error', () => { void stop(1) })
  // End the generation on SSE errors, so EventSource's internal retry loop
  // cannot bypass the upstream supervisor's bounded reconnect policy.
  transport.onerror = () => { void stop(1) }
  transport.onclose = () => { if (!stopping) void stop(1) }
  transport.onmessage = message => { process.stdout.write(serializeMessage(message)) }
  await transport.start()
  const buffer = new ReadBuffer()
  for await (const chunk of process.stdin) {
    buffer.append(chunk as Buffer)
    let message
    while ((message = buffer.readMessage()) !== null) await transport.send(message)
  }
  await stop(0)
}

// Do not echo SDK/network errors: they can contain server URLs or credentials.
void main().catch(() => { process.stderr.write('MCP SSE bridge connection failed\n'); process.exit(1) })
