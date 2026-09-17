import { describe, expect, it } from 'vitest'
import { importMcpServersDocument, parseDesktopMcpServer } from '../src/mcp.ts'

describe('Desktop MCP', () => {
  it('accepts bounded credential-free configurations', () => {
    expect(parseDesktopMcpServer({
      serverName: 'local_files', transport: 'stdio', command: 'node', args: ['server.js'], enabled: true,
    })).toEqual(expect.objectContaining({ serverName: 'local_files', transport: 'stdio', command: 'node', args: ['server.js'], cwd: '', env: {}, timeoutMs: 60_000, enabled: true }))
    expect(parseDesktopMcpServer({
      serverName: 'remote', transport: 'streamable-http', url: 'https://example.com/mcp', enabled: false,
    })).toEqual(expect.objectContaining({ serverName: 'remote', transport: 'streamable-http', url: 'https://example.com/mcp', headers: {}, timeoutMs: 60_000, enabled: false }))
  })

  it('rejects embedded HTTP credentials and invalid namespaces', () => {
    expect(() => parseDesktopMcpServer({
      serverName: 'bad name', transport: 'stdio', command: 'node', args: [], enabled: true,
    })).toThrow()
    expect(() => parseDesktopMcpServer({
      serverName: 'remote', transport: 'streamable-http', url: 'https://user:secret@example.com/mcp', enabled: true,
    })).toThrow(/without embedded credentials/)
  })

  it('imports standard mcpServers JSON without persisting credential values in configuration', () => {
    const imported = importMcpServersDocument({ mcpServers: { github: {
      command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'ghp_example' },
    } } })
    expect(imported).toEqual([expect.objectContaining({
      server: expect.objectContaining({ serverName: 'github', env: { GITHUB_TOKEN: 'MCP_GITHUB_GITHUB_TOKEN' } }),
      secrets: { MCP_GITHUB_GITHUB_TOKEN: 'ghp_example' },
    })])
    expect(JSON.stringify(imported[0]?.server)).not.toContain('ghp_example')
  })
})
