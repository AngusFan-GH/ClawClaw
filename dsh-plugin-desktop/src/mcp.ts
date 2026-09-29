/** Desktop-owned MCP configuration and runtime management. */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-tools'
import { registerDesktopJsonApi } from './desktop-json-api.ts'
import {
  DESKTOP_MCP_ACTION_PATH, DESKTOP_MCP_PATH,
  type DesktopMcpServerConfig, type DesktopMcpServerView, type DesktopMcpView,
} from './mcp-contract.ts'

export * from './mcp-contract.ts'
export const name = 'desktop-mcp'
export const inject = ['settings', 'tools', 'webServer', 'connection', 'credentials']
export const DESKTOP_MCP_SETTINGS_NAMESPACE = 'dsh-desktop-mcp'

const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/u
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u
const HTTP_HEADER = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,256}$/u
const DEFAULT_RECONNECT = { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 } as const
export interface DesktopMcpSettings { readonly mcpServers: readonly DesktopMcpServerConfig[] }

const StdioServerSchema = z.object({
  serverName: z.string().required().pattern(SERVER_NAME), transport: z.const('stdio'),
  command: z.string().required().max(2_048), args: z.array(z.string().max(4_096)).max(128).default([]),
  cwd: z.string().max(8_192).default(''), env: z.dict(z.string().max(256)).default({}), timeoutMs: z.number().min(1_000).max(600_000).default(60_000),
  reconnect: z.object({ enabled: z.boolean().default(true), initialDelayMs: z.number().min(100).max(60_000).default(500), maxDelayMs: z.number().min(100).max(300_000).default(30_000), maxAttempts: z.number().min(0).max(100).default(10) }).default(DEFAULT_RECONNECT),
  enabled: z.boolean().default(true),
})
const HttpServerSchema = z.object({
  serverName: z.string().required().pattern(SERVER_NAME), transport: z.const('streamable-http'),
  url: z.string().required().max(4_096), headers: z.dict(z.string().max(256)).default({}), timeoutMs: z.number().min(1_000).max(600_000).default(60_000),
  reconnect: z.object({ enabled: z.boolean().default(true), initialDelayMs: z.number().min(100).max(60_000).default(500), maxDelayMs: z.number().min(100).max(300_000).default(30_000), maxAttempts: z.number().min(0).max(100).default(10) }).default(DEFAULT_RECONNECT), enabled: z.boolean().default(true),
})
const McpServerSchema = z.union([StdioServerSchema, HttpServerSchema])
export const DesktopMcpSettingsSchema: z<DesktopMcpSettings> = z.object({
  mcpServers: z.array(McpServerSchema).max(64).default([]),
}) as z<DesktopMcpSettings>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function assertHttpUrl(value: string): void {
  let url: URL
  try { url = new URL(value) } catch { throw new TypeError('MCP URL must be an absolute HTTP or HTTPS URL') }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') {
    throw new TypeError('MCP URL must be an HTTP or HTTPS URL without embedded credentials')
  }
}
export function parseDesktopMcpServer(value: unknown): DesktopMcpServerConfig {
  const parsed = McpServerSchema(value as never) as DesktopMcpServerConfig
  if (parsed.transport === 'streamable-http') assertHttpUrl(parsed.url)
  else if (parsed.command.trim() === '') throw new TypeError('MCP command is required')
  const references = parsed.transport === 'stdio' ? parsed.env : parsed.headers
  for (const [key, ref] of Object.entries(references)) {
    if (!(parsed.transport === 'stdio' ? ENV_NAME : HTTP_HEADER).test(key) || !isCredentialRefName(ref)) {
      throw new TypeError(`Invalid ${parsed.transport === 'stdio' ? 'environment variable' : 'HTTP header'} credential reference`)
    }
  }
  if (parsed.reconnect.maxDelayMs < parsed.reconnect.initialDelayMs) throw new TypeError('MCP reconnect max delay must not be less than its initial delay')
  return Object.freeze(parsed.transport === 'stdio'
    ? { serverName: parsed.serverName, transport: parsed.transport, command: parsed.command.trim(),
        args: Object.freeze([...parsed.args]), cwd: parsed.cwd, env: Object.freeze({ ...parsed.env }), timeoutMs: parsed.timeoutMs,
        reconnect: Object.freeze({ ...parsed.reconnect }), enabled: parsed.enabled }
    : { serverName: parsed.serverName, transport: parsed.transport, url: parsed.url, headers: Object.freeze({ ...parsed.headers }), timeoutMs: parsed.timeoutMs,
        reconnect: Object.freeze({ ...parsed.reconnect }), enabled: parsed.enabled })
}
function validateSettings(settings: DesktopMcpSettings): void {
  const names = new Set<string>()
  for (const raw of settings.mcpServers) {
    const server = parseDesktopMcpServer(raw)
    if (names.has(server.serverName)) throw new Error(`duplicate MCP server name: ${server.serverName}`)
    names.add(server.serverName)
  }
}

export function mcpCredentialReference(serverName: string, key: string): string {
  const normalized = `MCP_${serverName}_${key}`.replaceAll(/[^A-Za-z0-9_]/gu, '_').toUpperCase()
  const suffix = createHash('sha256').update(serverName).update('\0').update(key).digest('hex').slice(0, 12).toUpperCase()
  return `${normalized}_${suffix}`
}

/** Convert the widely-used `mcpServers` JSON document into reference-only Desktop records. */
export function importMcpServersDocument(value: unknown): readonly { server: DesktopMcpServerConfig, secrets: Readonly<Record<string, string>> }[] {
  if (!isRecord(value) || !isRecord(value.mcpServers)) throw new TypeError('MCP import must contain an mcpServers object')
  const imported: Array<{ server: DesktopMcpServerConfig, secrets: Readonly<Record<string, string>> }> = []
  for (const [serverName, raw] of Object.entries(value.mcpServers)) {
    if (!isRecord(raw) || !SERVER_NAME.test(serverName)) throw new TypeError('Invalid MCP import server name')
    const stdio = typeof raw.command === 'string'
    const rawValues = stdio ? raw.env : raw.headers
    if (rawValues !== undefined && !isRecord(rawValues)) throw new TypeError('MCP import credentials must be an object')
    const references: Record<string, string> = {}
    const secrets: Record<string, string> = {}
    for (const [key, secret] of Object.entries(rawValues ?? {})) {
      if (typeof secret !== 'string' || secret.length === 0 || secret.length > 16_384) throw new TypeError('MCP import credential values must be non-empty strings')
      const ref = mcpCredentialReference(serverName, key)
      references[key] = ref; secrets[ref] = secret
    }
    const input = stdio
      ? { serverName, transport: 'stdio' as const, command: raw.command, args: Array.isArray(raw.args) ? raw.args : [], cwd: typeof raw.cwd === 'string' ? raw.cwd : '', env: references, enabled: true }
      : { serverName, transport: 'streamable-http' as const, url: raw.url, headers: references, enabled: true }
    imported.push({ server: parseDesktopMcpServer(input), secrets: Object.freeze(secrets) })
  }
  return Object.freeze(imported)
}

interface McpRuntime { readonly fingerprint: string, readonly dispose: () => void | Promise<void> }
interface McpStatus { state: DesktopMcpServerView['state'], error?: string, credentialsReady?: boolean }

export class DesktopMcpController {
  private readonly runtime = new Map<string, McpRuntime>()
  private readonly status = new Map<string, McpStatus>()
  private reconcileTail: Promise<void> = Promise.resolve()
  private disposed = false
  private stopWatching: (() => void) | undefined

  constructor(private readonly ctx: Context, private readonly settings: SettingsScope<DesktopMcpSettings>) {}
  start(): void {
    this.stopWatching = this.settings.watch(() => { void this.reconcile().catch(cause => this.ctx.logger.error(cause)) })
    void this.reconcile().catch(cause => this.ctx.logger.error(cause))
  }
  async dispose(): Promise<void> {
    this.disposed = true; this.stopWatching?.(); this.stopWatching = undefined
    await this.reconcileTail
    await Promise.allSettled([...this.runtime.values()].map(async runtime => { await runtime.dispose() }))
    this.runtime.clear()
  }
  async read(): Promise<DesktopMcpView> {
    return Object.freeze({ mcpServers: Object.freeze(this.settings.get().mcpServers.map(server => this.projectServer(server))) })
  }
  async save(input: unknown, previousName?: string, secrets: Readonly<Record<string, string>> = {}): Promise<DesktopMcpView> {
    const server = parseDesktopMcpServer(input)
    const current = this.settings.get().mcpServers
    const replacing = previousName ?? server.serverName
    const index = current.findIndex(item => item.serverName === replacing)
    if (previousName !== undefined && index < 0) throw new Error(`MCP server not found: ${previousName}`)
    if (current.some((item, itemIndex) => item.serverName === server.serverName && itemIndex !== index)) {
      throw new Error(`MCP server already exists: ${server.serverName}`)
    }
    const next = index < 0 ? [...current, server] : current.map((item, itemIndex) => itemIndex === index ? server : item)
    const referenced = new Set(Object.values(server.transport === 'stdio' ? server.env : server.headers))
    const writes = this.validateCredentialWrites(secrets, referenced)
    await this.commitCredentials(writes, async () => { await this.settings.update({ mcpServers: next }) })
    await this.reconcile()
    return await this.read()
  }
  async remove(serverName: string): Promise<DesktopMcpView> {
    const current = this.settings.get().mcpServers
    if (!current.some(server => server.serverName === serverName)) throw new Error(`MCP server not found: ${serverName}`)
    await this.settings.update({ mcpServers: current.filter(server => server.serverName !== serverName) }); await this.reconcile()
    return await this.read()
  }
  async import(value: unknown): Promise<DesktopMcpView> {
    const imported = importMcpServersDocument(value)
    const current = this.settings.get().mcpServers
    const names = new Set(current.map(server => server.serverName))
    for (const { server } of imported) if (names.has(server.serverName)) throw new Error(`MCP server already exists: ${server.serverName}`)
    const mergedSecrets = new Map<string, string>()
    for (const { server, secrets } of imported) {
      const referenced = new Set(Object.values(server.transport === 'stdio' ? server.env : server.headers))
      for (const [ref, secret] of this.validateCredentialWrites(secrets, referenced)) {
        if (mergedSecrets.has(ref)) throw new Error(`MCP credential reference collision: ${ref}`)
        mergedSecrets.set(ref, secret)
      }
      names.add(server.serverName)
    }
    await this.commitCredentials([...mergedSecrets], async () => {
      await this.settings.update({ mcpServers: [...current, ...imported.map(item => item.server)] })
    })
    await this.reconcile()
    return await this.read()
  }
  async toggle(serverName: string, enabled: boolean): Promise<DesktopMcpView> {
    const current = this.settings.get().mcpServers
    if (!current.some(server => server.serverName === serverName)) throw new Error(`MCP server not found: ${serverName}`)
    await this.settings.update({ mcpServers: current.map(server => server.serverName === serverName ? { ...server, enabled } : server) })
    await this.reconcile()
    return await this.read()
  }
  async test(serverName: string): Promise<DesktopMcpView> {
    const server = this.settings.get().mcpServers.find(item => item.serverName === serverName)
    if (server === undefined) throw new Error(`MCP server not found: ${serverName}`)
    await this.stop(serverName); await this.startServer(server)
    if (!server.enabled) await this.stop(serverName)
    return await this.read()
  }
  private reconcile(): Promise<void> {
    const run = this.reconcileTail.then(async () => { await this.reconcileNow() })
    this.reconcileTail = run.catch(() => {})
    return run
  }
  private async reconcileNow(): Promise<void> {
    if (this.disposed) return
    const servers = this.settings.get().mcpServers
    const desired = new Map(servers.map(server => [server.serverName, server]))
    for (const serverName of [...this.runtime.keys()]) {
      const server = desired.get(serverName)
      if (server === undefined || !server.enabled || this.runtime.get(serverName)?.fingerprint !== JSON.stringify(server)) {
        await this.stop(serverName)
      }
    }
    for (const server of servers) {
      if (server.enabled && !this.runtime.has(server.serverName)) await this.startServer(server)
      if (!server.enabled) this.status.set(server.serverName, { state: 'disabled' })
    }
    for (const serverName of [...this.status.keys()]) if (!desired.has(serverName)) this.status.delete(serverName)
  }
  private async resolveCredentials(values: Readonly<Record<string, string>>): Promise<{ values: Record<string, string>, ready: boolean }> {
    const entries = await Promise.all(Object.entries(values).map(async ([key, ref]) => [key, await this.ctx.credentials.resolve(credentialRef(ref))] as const))
    const missing = entries.find(([, credential]) => credential === undefined)
    if (missing !== undefined) return { values: {}, ready: false }
    return { values: Object.fromEntries(entries.map(([key, credential]) => [key, credential?.value ?? ''])), ready: true }
  }
  private async startServer(server: DesktopMcpServerConfig): Promise<void> {
    this.status.set(server.serverName, { state: 'starting' })
    try {
      const credentials = await this.resolveCredentials(server.transport === 'stdio' ? server.env : server.headers)
      this.status.set(server.serverName, { state: 'starting', credentialsReady: credentials.ready })
      if (!credentials.ready) throw new Error('One or more credential references are not configured')
      const config: McpClient.Config = server.transport === 'stdio'
        ? { transport: 'stdio', serverName: server.serverName, command: server.command, args: [...server.args],
            env: credentials.values, cwd: server.cwd, toolCallTimeoutMs: server.timeoutMs, reconnect: server.reconnect, failOnStartupError: true }
        : { transport: 'streamable-http', serverName: server.serverName, url: server.url,
            headers: credentials.values, toolCallTimeoutMs: server.timeoutMs, reconnect: server.reconnect, failOnStartupError: true }
      const fiber = this.ctx.plugin(McpClient, config)
      await fiber
      if (this.disposed) { await fiber.dispose(); return }
      this.runtime.set(server.serverName, { fingerprint: JSON.stringify(server), dispose: () => fiber.dispose() })
      this.status.set(server.serverName, { state: 'running', credentialsReady: true })
    } catch (cause) {
      this.status.set(server.serverName, { state: 'error', error: cause instanceof Error ? cause.message : String(cause), credentialsReady: !String(cause).includes('credential references') })
    }
  }
  private async stop(serverName: string): Promise<void> {
    const runtime = this.runtime.get(serverName)
    if (runtime === undefined) return
    this.runtime.delete(serverName); await runtime.dispose()
  }
  private projectServer(server: DesktopMcpServerConfig): DesktopMcpServerView {
    const status = this.status.get(server.serverName) ?? { state: server.enabled ? 'starting' : 'disabled' }
    const credentialsReady = status.credentialsReady ?? true
    return Object.freeze({ ...server, state: status.state, tools: this.liveTools(server.serverName), credentialsReady,
      ...(status.error === undefined ? {} : { error: status.error }) })
  }
  private liveTools(serverName: string): readonly { name: string; description: string }[] {
    const prefix = `mcp__${serverName}__`
    return Object.freeze(this.ctx.tools.schemas().filter(tool => tool.name.startsWith(prefix))
      .map(tool => Object.freeze({ name: tool.name, description: tool.description ?? '' })))
  }
  private validateCredentialWrites(secrets: Readonly<Record<string, string>>, referenced: ReadonlySet<string>): readonly (readonly [string, string])[] {
    return Object.entries(secrets).map(([ref, secret]) => {
      if (!isCredentialRefName(ref) || typeof secret !== 'string' || secret.length === 0 || secret.length > 16_384) {
        throw new TypeError('Invalid MCP credential value')
      }
      if (!referenced.has(ref)) throw new TypeError(`MCP credential is not referenced by this server: ${ref}`)
      return [ref, secret] as const
    })
  }
  private async commitCredentials(writes: readonly (readonly [string, string])[], commit: () => Promise<void>): Promise<void> {
    const previous = new Map<string, string | undefined>()
    const written: string[] = []
    try {
      for (const [ref, secret] of writes) {
        const branded = credentialRef(ref)
        previous.set(ref, (await this.ctx.credentials.resolve(branded))?.value)
        await this.ctx.credentials.set(branded, secret)
        written.push(ref)
      }
      await commit()
    } catch (cause) {
      const rollbackErrors: unknown[] = []
      for (const ref of written.reverse()) {
        try {
          const value = previous.get(ref)
          if (value === undefined) await this.ctx.credentials.unset(credentialRef(ref))
          else await this.ctx.credentials.set(credentialRef(ref), value)
        } catch (rollbackCause) { rollbackErrors.push(rollbackCause) }
      }
      if (rollbackErrors.length > 0) throw new AggregateError([cause, ...rollbackErrors], 'MCP credential transaction and rollback failed')
      throw cause
    }
  }
}

async function handleAction(controller: DesktopMcpController, value: unknown): Promise<DesktopMcpView> {
  if (!isRecord(value) || typeof value.action !== 'string') throw new TypeError('invalid MCP action')
  if (value.action === 'save' && (value.previousName === undefined || typeof value.previousName === 'string')
    && (value.secrets === undefined || isRecord(value.secrets))) {
    return await controller.save(value.server, value.previousName, value.secrets as Record<string, string> | undefined)
  }
  if (value.action === 'remove' && typeof value.serverName === 'string') return await controller.remove(value.serverName)
  if (value.action === 'toggle' && typeof value.serverName === 'string' && typeof value.enabled === 'boolean') {
    return await controller.toggle(value.serverName, value.enabled)
  }
  if (value.action === 'test' && typeof value.serverName === 'string') return await controller.test(value.serverName)
  if (value.action === 'import') return await controller.import(value.document)
  throw new TypeError('invalid MCP action')
}

export function apply(ctx: Context): void {
  const settings = ctx.settings.register(DESKTOP_MCP_SETTINGS_NAMESPACE, DesktopMcpSettingsSchema,
    { applies: 'live', validate: validateSettings })
  const controller = new DesktopMcpController(ctx, settings)
  controller.start()
  ctx.effect(() => () => controller.dispose(), 'dsh-plugin-desktop: MCP runtimes')
  registerDesktopJsonApi(ctx, { label: 'MCP', readPath: DESKTOP_MCP_PATH, actionPath: DESKTOP_MCP_ACTION_PATH,
    read: () => controller.read(), action: value => handleAction(controller, value) })
}
