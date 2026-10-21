/** Local, credential-free MCP protocol fixture. stdout is JSON-RPC only. */
import { createInterface } from 'node:readline'

const lines = createInterface({ input: process.stdin })
lines.on('line', line => {
  const request = JSON.parse(line)
  if (!Object.hasOwn(request, 'id')) return
  let result
  switch (request.method) {
    case 'initialize':
      result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'team-arithmetic', version: '1.0.0' } }
      break
    case 'ping': result = {}; break
    case 'tools/list':
      result = { tools: [{ name: 'sum', description: 'Sum the provided numbers.', inputSchema: { type: 'object', properties: { values: { type: 'array', items: { type: 'number' } } }, required: ['values'], additionalProperties: false } }] }
      break
    case 'tools/call':
      result = { content: [{ type: 'text', text: String(request.params.arguments.values.reduce((sum, value) => sum + value, 0)) }] }
      break
    default:
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } }) + '\n')
      return
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n')
})
