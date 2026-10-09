/** Desktop-owned MCP configuration and runtime management. */

import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-tools'
import { registerDesktopJsonApi } from './desktop-json-api.ts'
import {
  DESKTOP_MCP_ACTION_PATH, DESKTOP_MCP_OAUTH_CALLBACK_PATH, DESKTOP_MCP_PATH,
  type DesktopMcpServerConfig, type DesktopMcpServerView, type DesktopMcpView,
} from './mcp-contract.ts'
import { DESKTOP_MCP_CATALOG, type DesktopMcpCatalogDefinition } from './mcp-catalog.ts'
import { deriveMcpDiagnostic } from './mcp-diagnostics.ts'
import {
  assertSecureOAuthUrl, buildMcpAuthorizationUrl, createMcpPkce, discoverMcpOAuthIssuer, discoverMcpOAuthMetadata,
  exchangeMcpAuthorizationCode, isTransientMcpOAuthError, parseMcpOAuthGrant, refreshMcpOAuthGrant, registerMcpOAuthClient,
  revokeMcpOAuthGrant, type McpOAuthClientRegistration, type McpOAuthMetadata,
} from './mcp-oauth.ts'

export * from './mcp-contract.ts'
export const name = 'desktop-mcp'
export const inject = ['settings', 'tools', 'webServer', 'connection', 'credentials']
export const DESKTOP_MCP_SETTINGS_NAMESPACE = 'dsh-desktop-mcp'

const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/u
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u
const HTTP_HEADER = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,256}$/u
const CONNECTOR_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u
const CAPABILITY_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u
const DEFAULT_RECONNECT = { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 } as const
export interface DesktopMcpSettings { readonly mcpServers: readonly DesktopMcpServerConfig[] }

const StdioServerSchema = z.object({
  serverName: z.string().required().pattern(SERVER_NAME), transport: z.const('stdio'),
  command: z.string().required().max(2_048), args: z.array(z.string().max(4_096)).max(128).default([]),
  cwd: z.string().max(8_192).default(''), env: z.dict(z.string().max(256)).default({}), timeoutMs: z.number().min(1_000).max(600_000).default(60_000),
  reconnect: z.object({ enabled: z.boolean().default(true), initialDelayMs: z.number().min(100).max(60_000).default(500), maxDelayMs: z.number().min(100).max(300_000).default(30_000), maxAttempts: z.number().min(0).max(100).default(10) }).default(DEFAULT_RECONNECT),
  enabled: z.boolean().default(true),
  connectorId: z.string().max(128).pattern(CONNECTOR_ID), capabilities: z.array(z.string().max(128).pattern(CAPABILITY_ID)).max(32).default([]),
})
const HttpServerSchema = z.object({
  serverName: z.string().required().pattern(SERVER_NAME), transport: z.const('streamable-http'),
  url: z.string().required().max(4_096), headers: z.dict(z.string().max(256)).default({}), timeoutMs: z.number().min(1_000).max(600_000).default(60_000),
  reconnect: z.object({ enabled: z.boolean().default(true), initialDelayMs: z.number().min(100).max(60_000).default(500), maxDelayMs: z.number().min(100).max(300_000).default(30_000), maxAttempts: z.number().min(0).max(100).default(10) }).default(DEFAULT_RECONNECT), enabled: z.boolean().default(true),
  connectorId: z.string().max(128).pattern(CONNECTOR_ID), capabilities: z.array(z.string().max(128).pattern(CAPABILITY_ID)).max(32).default([]), oauth: z.any(),
})
const McpServerSchema = z.union([StdioServerSchema, HttpServerSchema])
export const DesktopMcpSettingsSchema: z<DesktopMcpSettings> = z.object({
  mcpServers: z.array(McpServerSchema).max(64).default([]),
}) as z<DesktopMcpSettings>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function mutableSchemaInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mutableSchemaInput)
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mutableSchemaInput(entry)]))
  return value
}
function assertHttpUrl(value: string): void {
  let url: URL
  try { url = new URL(value) } catch { throw new TypeError('MCP URL must be an absolute HTTP or HTTPS URL') }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') {
    throw new TypeError('MCP URL must be an HTTP or HTTPS URL without embedded credentials')
  }
}
export function parseDesktopMcpServer(value: unknown): DesktopMcpServerConfig {
  const parsed = McpServerSchema(mutableSchemaInput(value) as never) as DesktopMcpServerConfig
  if (parsed.transport === 'streamable-http') {
    assertHttpUrl(parsed.url)
    if (parsed.oauth !== undefined) {
      if (!isRecord(parsed.oauth) || (parsed.oauth.issuer !== undefined && (typeof parsed.oauth.issuer !== 'string' || parsed.oauth.issuer.length > 4_096))
        || typeof parsed.oauth.scope !== 'string' || parsed.oauth.scope.length > 2_048
        || (parsed.oauth.resource !== undefined && (typeof parsed.oauth.resource !== 'string' || parsed.oauth.resource.length > 4_096))) {
        throw new TypeError('Invalid OAuth configuration')
      }
      if (typeof parsed.oauth.issuer === 'string' && parsed.oauth.issuer !== '') assertSecureOAuthUrl(parsed.oauth.issuer, 'OAuth issuer')
      if (parsed.oauth.scope.trim() === '') throw new TypeError('OAuth scope is required')
      if (parsed.oauth.resource !== undefined) assertSecureOAuthUrl(parsed.oauth.resource, 'OAuth resource')
      if (Object.keys(parsed.headers).some(key => key.toLocaleLowerCase() === 'authorization')) {
        throw new TypeError('OAuth servers must not also configure an Authorization header')
      }
    }
  }
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
        reconnect: Object.freeze({ ...parsed.reconnect }), enabled: parsed.enabled,
        ...(parsed.connectorId === undefined ? {} : { connectorId: parsed.connectorId }), capabilities: Object.freeze([...new Set(parsed.capabilities)]) }
    : { serverName: parsed.serverName, transport: parsed.transport, url: parsed.url, headers: Object.freeze({ ...parsed.headers }), timeoutMs: parsed.timeoutMs,
        reconnect: Object.freeze({ ...parsed.reconnect }), enabled: parsed.enabled,
        ...(parsed.connectorId === undefined ? {} : { connectorId: parsed.connectorId }), capabilities: Object.freeze([...new Set(parsed.capabilities)]),
        ...(parsed.oauth === undefined ? {} : { oauth: Object.freeze({
          ...(typeof parsed.oauth.issuer !== 'string' || parsed.oauth.issuer.trim() === '' ? {} : { issuer: parsed.oauth.issuer }), scope: parsed.oauth.scope.trim(),
          ...(parsed.oauth.resource === undefined ? {} : { resource: parsed.oauth.resource }) }) }) })
}
function mutableMcpSettings(servers: readonly DesktopMcpServerConfig[]): DesktopMcpSettings {
  return { mcpServers: servers.map(server => server.transport === 'stdio'
    ? {
        serverName: server.serverName, transport: server.transport, command: server.command, args: [...server.args], cwd: server.cwd,
        env: { ...server.env }, timeoutMs: server.timeoutMs, reconnect: { ...server.reconnect }, enabled: server.enabled,
        ...(server.connectorId === undefined ? {} : { connectorId: server.connectorId }),
        ...(server.capabilities === undefined ? {} : { capabilities: [...server.capabilities] }),
      }
    : {
        serverName: server.serverName, transport: server.transport, url: server.url, headers: { ...server.headers },
        timeoutMs: server.timeoutMs, reconnect: { ...server.reconnect }, enabled: server.enabled,
        ...(server.connectorId === undefined ? {} : { connectorId: server.connectorId }),
        ...(server.capabilities === undefined ? {} : { capabilities: [...server.capabilities] }),
        ...(server.oauth === undefined ? {} : { oauth: {
          ...(server.oauth.issuer === undefined ? {} : { issuer: server.oauth.issuer }), scope: server.oauth.scope,
          ...(server.oauth.resource === undefined ? {} : { resource: server.oauth.resource }),
        } }),
      }) }
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

export function materializeCatalogConnector(
  definition: DesktopMcpCatalogDefinition,
  values: Readonly<Record<string, string>>,
): { readonly server: DesktopMcpServerConfig; readonly secrets: Readonly<Record<string, string>> } {
  const expected = new Set(definition.credentials.map(field => field.id))
  if (Object.keys(values).some(key => !expected.has(key))) throw new TypeError('Unexpected MCP connector credential')
  const references: Record<string, string> = {}
  const secrets: Record<string, string> = {}
  for (const field of definition.credentials) {
    const value = values[field.id]?.trim() ?? ''
    if (field.required && value === '') throw new TypeError(`MCP connector credential is required: ${field.id}`)
    if (value === '') continue
    if (value.length > 16_384) throw new TypeError('MCP connector credential is too long')
    const ref = mcpCredentialReference(definition.server.serverName, field.targetName)
    references[field.targetName] = ref
    secrets[ref] = `${definition.credentialPrefix?.[field.id] ?? ''}${value}`
  }
  const raw = definition.server.transport === 'stdio'
    ? { ...definition.server, env: { ...definition.server.env, ...references } }
    : { ...definition.server, headers: { ...definition.server.headers, ...references } }
  return Object.freeze({ server: parseDesktopMcpServer(raw), secrets: Object.freeze(secrets) })
}

interface McpRuntime { readonly fingerprint: string, readonly dispose: () => void | Promise<void> }
interface McpStatus {
  state: DesktopMcpServerView['state']
  error?: string
  credentialsReady?: boolean
  authorizationRequired?: boolean
  checkedAt?: number
  lastSuccessfulAt?: number
}
interface PendingOAuthFlow {
  readonly serverName: string
  readonly verifier: string
  readonly redirectUri: string
  readonly metadata: McpOAuthMetadata
  readonly registration: McpOAuthClientRegistration
  readonly scope: string
  readonly resource?: string
  readonly expiresAt: number
}
class McpAuthorizationRequiredError extends Error {}
class McpOAuthRefreshTemporaryError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) { super(message) }
}
interface McpOAuthRefreshRetry {
  readonly attempt: number
  readonly nextAt: number
  readonly timer?: ReturnType<typeof setTimeout>
}
const OAUTH_REFRESH_RETRY_INITIAL_MS = 1_000
const OAUTH_REFRESH_RETRY_MAX_MS = 60_000

export class DesktopMcpController {
  private readonly runtime = new Map<string, McpRuntime>()
  private readonly status = new Map<string, McpStatus>()
  private readonly pendingOAuth = new Map<string, PendingOAuthFlow>()
  private readonly pendingOAuthTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly oauthRefreshRetries = new Map<string, McpOAuthRefreshRetry>()
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
    this.pendingOAuth.clear()
    for (const timer of this.pendingOAuthTimers.values()) clearTimeout(timer)
    this.pendingOAuthTimers.clear()
    for (const retry of this.oauthRefreshRetries.values()) if (retry.timer !== undefined) clearTimeout(retry.timer)
    this.oauthRefreshRetries.clear()
  }
  async read(): Promise<DesktopMcpView> {
    const configured = this.settings.get().mcpServers
    return Object.freeze({
      mcpServers: Object.freeze(configured.map(server => this.projectServer(server))),
      catalog: Object.freeze(DESKTOP_MCP_CATALOG.map(entry => {
        const installed = configured.find(server => server.connectorId === entry.id)
        return Object.freeze({ ...entry, ...(installed === undefined ? {} : { installedServerName: installed.serverName }) })
      })),
    })
  }
  async save(input: unknown, previousName?: string, secrets: Readonly<Record<string, string>> = {}): Promise<DesktopMcpView> {
    const server = parseDesktopMcpServer(input)
    const current = this.settings.get().mcpServers
    const replacing = previousName ?? server.serverName
    const index = current.findIndex(item => item.serverName === replacing)
    const previous = index < 0 ? undefined : current[index]
    if (previousName !== undefined && index < 0) throw new Error(`MCP server not found: ${previousName}`)
    if (current.some((item, itemIndex) => item.serverName === server.serverName && itemIndex !== index)) {
      throw new Error(`MCP server already exists: ${server.serverName}`)
    }
    const next = index < 0 ? [...current, server] : current.map((item, itemIndex) => itemIndex === index ? server : item)
    const referenced = new Set(Object.values(server.transport === 'stdio' ? server.env : server.headers))
    const writes = this.validateCredentialWrites(secrets, referenced)
    await this.commitCredentials(writes, async () => { await this.settings.update(mutableMcpSettings(next)) })
    if (previous?.transport === 'streamable-http' && previous.oauth !== undefined
      && (server.transport !== 'streamable-http' || server.serverName !== previous.serverName
        || JSON.stringify(server.oauth) !== JSON.stringify(previous.oauth))) {
      await this.stop(previous.serverName)
      await this.disconnectOAuth(previous.serverName)
    }
    await this.reconcile()
    return await this.read()
  }
  async remove(serverName: string): Promise<DesktopMcpView> {
    const current = this.settings.get().mcpServers
    const removed = current.find(server => server.serverName === serverName)
    if (removed === undefined) throw new Error(`MCP server not found: ${serverName}`)
    await this.settings.update(mutableMcpSettings(current.filter(server => server.serverName !== serverName))); await this.reconcile()
    if (removed.transport === 'streamable-http' && removed.oauth !== undefined) await this.disconnectOAuth(serverName)
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
      await this.settings.update(mutableMcpSettings([...current, ...imported.map(item => item.server)]))
    })
    await this.reconcile()
    return await this.read()
  }
  async install(connectorId: string, values: Readonly<Record<string, string>>): Promise<DesktopMcpView> {
    const definition = DESKTOP_MCP_CATALOG.find(item => item.id === connectorId)
    if (definition === undefined) throw new Error(`MCP connector not found: ${connectorId}`)
    if (this.settings.get().mcpServers.some(server => server.connectorId === connectorId)) {
      throw new Error(`MCP connector is already installed: ${connectorId}`)
    }
    const materialized = materializeCatalogConnector(definition, values)
    return await this.save(materialized.server, undefined, materialized.secrets)
  }
  async beginOAuth(serverName: string, redirectUri: string): Promise<{ readonly authorizationUrl: string }> {
    const server = this.settings.get().mcpServers.find(item => item.serverName === serverName)
    if (server?.transport !== 'streamable-http' || server.oauth === undefined) throw new Error(`OAuth MCP server not found: ${serverName}`)
    const discovered = server.oauth.issuer === undefined ? await discoverMcpOAuthIssuer(server.url) : undefined
    const issuer = server.oauth.issuer ?? discovered?.issuer
    if (issuer === undefined) throw new Error('OAuth issuer discovery failed')
    const metadata = await discoverMcpOAuthMetadata(issuer)
    if (metadata.codeChallengeMethodsSupported.length > 0 && !metadata.codeChallengeMethodsSupported.includes('S256')) {
      throw new Error('OAuth server does not support PKCE S256')
    }
    const registration = await registerMcpOAuthClient(metadata, redirectUri, 'ClawClaw Desktop', server.oauth.scope)
    const { verifier, challenge } = createMcpPkce()
    const state = randomBytes(32).toString('base64url')
    for (const [key, flow] of this.pendingOAuth) if (flow.serverName === serverName || flow.expiresAt <= Date.now()) this.deletePendingOAuth(key)
    const resource = server.oauth.resource ?? discovered?.metadata.resource
    this.pendingOAuth.set(state, { serverName, verifier, redirectUri, metadata, registration, scope: server.oauth.scope,
      ...(resource === undefined ? {} : { resource }), expiresAt: Date.now() + 5 * 60_000 })
    const timer = setTimeout(() => { this.deletePendingOAuth(state) }, 5 * 60_000)
    timer.unref?.()
    this.pendingOAuthTimers.set(state, timer)
    return Object.freeze({ authorizationUrl: buildMcpAuthorizationUrl({ metadata, clientId: registration.clientId, redirectUri,
      scope: server.oauth.scope, state, challenge, ...(resource === undefined ? {} : { resource }) }) })
  }
  async completeOAuth(state: string, code: string): Promise<void> {
    const flow = this.pendingOAuth.get(state)
    this.deletePendingOAuth(state)
    if (flow === undefined || flow.expiresAt <= Date.now()) throw new Error('OAuth callback is invalid or expired')
    const grant = await exchangeMcpAuthorizationCode({ metadata: flow.metadata, registration: flow.registration, code,
      verifier: flow.verifier, redirectUri: flow.redirectUri, scope: flow.scope,
      ...(flow.resource === undefined ? {} : { resource: flow.resource }) })
    await this.ctx.credentials.set(credentialRef(mcpCredentialReference(flow.serverName, 'OAUTH_GRANT')), JSON.stringify(grant))
    await this.stop(flow.serverName)
    await this.reconcile()
  }
  private deletePendingOAuth(state: string): void {
    this.pendingOAuth.delete(state)
    const timer = this.pendingOAuthTimers.get(state)
    if (timer !== undefined) clearTimeout(timer)
    this.pendingOAuthTimers.delete(state)
  }
  async toggle(serverName: string, enabled: boolean): Promise<DesktopMcpView> {
    const current = this.settings.get().mcpServers
    const target = current.find(server => server.serverName === serverName)
    if (target === undefined) throw new Error(`MCP server not found: ${serverName}`)
    await this.settings.update(mutableMcpSettings(current.map(server => server.serverName === serverName ? { ...server, enabled } : server)))
    await this.reconcile()
    if (!enabled && target.transport === 'streamable-http' && target.oauth !== undefined) await this.disconnectOAuth(serverName)
    return await this.read()
  }
  async test(serverName: string): Promise<DesktopMcpView> {
    const server = this.settings.get().mcpServers.find(item => item.serverName === serverName)
    if (server === undefined) throw new Error(`MCP server not found: ${serverName}`)
    await this.stop(serverName); this.clearOAuthRefreshRetry(serverName); await this.startServer(server)
    if (!server.enabled && this.status.get(serverName)?.state === 'running') {
      await this.stop(serverName)
      const tested = this.status.get(serverName)
      this.status.set(serverName, { ...tested, state: 'disabled' })
    }
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
      if (!server.enabled) {
        this.clearOAuthRefreshRetry(server.serverName)
        const previous = this.status.get(server.serverName)
        this.status.set(server.serverName, {
          state: 'disabled',
          ...(previous?.credentialsReady === undefined ? {} : { credentialsReady: previous.credentialsReady }),
          ...(previous?.checkedAt === undefined ? {} : { checkedAt: previous.checkedAt }),
          ...(previous?.lastSuccessfulAt === undefined ? {} : { lastSuccessfulAt: previous.lastSuccessfulAt }),
        })
      }
    }
    for (const serverName of [...this.status.keys()]) if (!desired.has(serverName)) {
      this.status.delete(serverName); this.clearOAuthRefreshRetry(serverName)
    }
  }
  private async resolveCredentials(values: Readonly<Record<string, string>>): Promise<{ values: Record<string, string>, ready: boolean }> {
    const entries = await Promise.all(Object.entries(values).map(async ([key, ref]) => [key, await this.ctx.credentials.resolve(credentialRef(ref))] as const))
    const missing = entries.find(([, credential]) => credential === undefined)
    if (missing !== undefined) return { values: {}, ready: false }
    return { values: Object.fromEntries(entries.map(([key, credential]) => [key, credential?.value ?? ''])), ready: true }
  }
  private async startServer(server: DesktopMcpServerConfig): Promise<void> {
    const previous = this.status.get(server.serverName)
    const checkedAt = Date.now()
    this.status.set(server.serverName, { state: 'starting', checkedAt,
      ...(previous?.lastSuccessfulAt === undefined ? {} : { lastSuccessfulAt: previous.lastSuccessfulAt }) })
    try {
      const credentials = await this.resolveCredentials(server.transport === 'stdio' ? server.env : server.headers)
      this.status.set(server.serverName, { state: 'starting', credentialsReady: credentials.ready, checkedAt,
        ...(previous?.lastSuccessfulAt === undefined ? {} : { lastSuccessfulAt: previous.lastSuccessfulAt }) })
      if (!credentials.ready) throw new Error('One or more credential references are not configured')
      const oauthHeaders = server.transport === 'streamable-http' && server.oauth !== undefined
        ? await this.resolveOAuthHeaders(server.serverName, server.oauth.issuer) : {}
      const config: McpClient.Config = server.transport === 'stdio'
        ? { transport: 'stdio', serverName: server.serverName, command: server.command, args: [...server.args],
            env: credentials.values, cwd: server.cwd, toolCallTimeoutMs: server.timeoutMs, reconnect: server.reconnect, failOnStartupError: true }
        : { transport: 'streamable-http', serverName: server.serverName, url: server.url,
            headers: { ...credentials.values, ...oauthHeaders }, toolCallTimeoutMs: server.timeoutMs, reconnect: server.reconnect, failOnStartupError: true }
      const fiber = this.ctx.plugin(McpClient, config)
      await fiber
      if (this.disposed) { await fiber.dispose(); return }
      this.runtime.set(server.serverName, { fingerprint: JSON.stringify(server), dispose: () => fiber.dispose() })
      this.clearOAuthRefreshRetry(server.serverName)
      this.status.set(server.serverName, { state: 'running', credentialsReady: true, checkedAt, lastSuccessfulAt: Date.now() })
    } catch (cause) {
      const authorizationRequired = cause instanceof McpAuthorizationRequiredError
      const refreshTemporary = cause instanceof McpOAuthRefreshTemporaryError
      this.status.set(server.serverName, { state: 'error', error: cause instanceof Error ? cause.message : String(cause),
        credentialsReady: !authorizationRequired && !String(cause).includes('credential references'), authorizationRequired, checkedAt,
        ...(previous?.lastSuccessfulAt === undefined ? {} : { lastSuccessfulAt: previous.lastSuccessfulAt }) })
      if (refreshTemporary) this.scheduleOAuthRefreshRetry(server.serverName, cause.retryAfterMs)
      else this.clearOAuthRefreshRetry(server.serverName)
    }
  }
  private async resolveOAuthHeaders(serverName: string, issuer?: string): Promise<Readonly<Record<string, string>>> {
    const ref = credentialRef(mcpCredentialReference(serverName, 'OAUTH_GRANT'))
    const stored = await this.ctx.credentials.resolve(ref)
    if (stored === undefined) throw new McpAuthorizationRequiredError('OAuth authorization is required')
    let grant
    try { grant = parseMcpOAuthGrant(stored.value) } catch { throw new McpAuthorizationRequiredError('OAuth authorization must be renewed') }
    if (issuer !== undefined && grant.issuer !== issuer) throw new McpAuthorizationRequiredError('OAuth authorization does not match this server')
    if (grant.expiresAt !== undefined && grant.expiresAt <= Date.now() + 60_000) {
      const retry = this.oauthRefreshRetries.get(serverName)
      if (retry !== undefined && retry.nextAt > Date.now()) {
        throw new McpOAuthRefreshTemporaryError('OAuth token refresh is temporarily unavailable', retry.nextAt - Date.now())
      }
      try {
        grant = await refreshMcpOAuthGrant(grant)
        await this.ctx.credentials.set(ref, JSON.stringify(grant))
      } catch (cause) {
        if (isTransientMcpOAuthError(cause)) {
          throw new McpOAuthRefreshTemporaryError('OAuth token refresh is temporarily unavailable', cause.retryAfterMs)
        }
        throw new McpAuthorizationRequiredError(cause instanceof Error ? cause.message : 'OAuth authorization must be renewed')
      }
    }
    return Object.freeze({ Authorization: `Bearer ${grant.accessToken}` })
  }
  private async stop(serverName: string): Promise<void> {
    const runtime = this.runtime.get(serverName)
    if (runtime === undefined) return
    this.runtime.delete(serverName); await runtime.dispose()
  }
  private scheduleOAuthRefreshRetry(serverName: string, requestedDelay?: number): void {
    const previous = this.oauthRefreshRetries.get(serverName)
    if (previous?.timer !== undefined && previous.nextAt > Date.now()) return
    const attempt = (previous?.attempt ?? 0) + 1
    const exponential = Math.min(OAUTH_REFRESH_RETRY_INITIAL_MS * 2 ** Math.min(attempt - 1, 16), OAUTH_REFRESH_RETRY_MAX_MS)
    const delay = Math.max(exponential, requestedDelay ?? 0)
    const nextAt = Date.now() + delay
    const timer = setTimeout(() => {
      const current = this.oauthRefreshRetries.get(serverName)
      if (current?.timer !== timer) return
      this.oauthRefreshRetries.set(serverName, { attempt: current.attempt, nextAt: Date.now() })
      void this.reconcile().catch(cause => this.ctx.logger.error(cause))
    }, delay)
    timer.unref?.()
    this.oauthRefreshRetries.set(serverName, { attempt, nextAt, timer })
  }
  private clearOAuthRefreshRetry(serverName: string): void {
    const retry = this.oauthRefreshRetries.get(serverName)
    if (retry?.timer !== undefined) clearTimeout(retry.timer)
    this.oauthRefreshRetries.delete(serverName)
  }
  private async disconnectOAuth(serverName: string): Promise<void> {
    this.clearOAuthRefreshRetry(serverName)
    const ref = credentialRef(mcpCredentialReference(serverName, 'OAUTH_GRANT'))
    const stored = await this.ctx.credentials.resolve(ref)
    if (stored === undefined) return
    try {
      await revokeMcpOAuthGrant(parseMcpOAuthGrant(stored.value))
    } catch (cause) {
      this.ctx.logger.error(cause)
    } finally {
      await this.ctx.credentials.unset(ref)
    }
  }
  private projectServer(server: DesktopMcpServerConfig): DesktopMcpServerView {
    const status = this.status.get(server.serverName) ?? { state: server.enabled ? 'starting' : 'disabled' }
    const credentialsReady = status.credentialsReady ?? true
    const tools = this.liveTools(server.serverName)
    const diagnostic = deriveMcpDiagnostic({ enabled: server.enabled, state: status.state, credentialsReady, toolCount: tools.length,
      ...(status.authorizationRequired === undefined ? {} : { authorizationRequired: status.authorizationRequired }),
      ...(status.checkedAt === undefined ? {} : { checkedAt: status.checkedAt }),
      ...(status.lastSuccessfulAt === undefined ? {} : { lastSuccessfulAt: status.lastSuccessfulAt }) })
    return Object.freeze({ ...server, state: status.state, tools, credentialsReady, diagnostic,
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

async function handleAction(controller: DesktopMcpController, value: unknown, rendererOrigin: string): Promise<object> {
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
  if (value.action === 'install' && typeof value.connectorId === 'string' && isRecord(value.values)
    && Object.values(value.values).every(item => typeof item === 'string')) {
    return await controller.install(value.connectorId, value.values as Record<string, string>)
  }
  if (value.action === 'oauth-start' && typeof value.serverName === 'string') {
    return await controller.beginOAuth(value.serverName, `${rendererOrigin}${DESKTOP_MCP_OAUTH_CALLBACK_PATH}`)
  }
  throw new TypeError('invalid MCP action')
}

function finishOAuthCallback(res: ServerResponse, status: number, title: string, detail: string): void {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font:15px system-ui;margin:48px;color:#202124}p{color:#5f6368}</style><h1>${title}</h1><p>${detail}</p>`)
}
export async function handleMcpOAuthCallback(
  controller: DesktopMcpController,
  req: IncomingMessage,
  res: ServerResponse,
  expectedHost: string,
): Promise<void> {
  const address = req.socket.remoteAddress
  const loopback = address === '::1' || address?.startsWith('127.') === true || address?.startsWith('::ffff:127.') === true
  if (!loopback || req.headers.host?.toLocaleLowerCase() !== expectedHost.toLocaleLowerCase() || req.method !== 'GET') {
    return finishOAuthCallback(res, 403, 'Authorization rejected', 'Return to ClawClaw and try again.')
  }
  const url = new URL(req.url ?? DESKTOP_MCP_OAUTH_CALLBACK_PATH, `http://${expectedHost}`)
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  if (state === null || code === null || error !== null) {
    return finishOAuthCallback(res, 400, 'Authorization was not completed', 'Return to ClawClaw and try again.')
  }
  try {
    await controller.completeOAuth(state, code)
    finishOAuthCallback(res, 200, 'Authorization complete', 'You can close this window and return to ClawClaw.')
  } catch {
    finishOAuthCallback(res, 400, 'Authorization failed', 'The callback was invalid or expired. Return to ClawClaw and try again.')
  }
}

export function apply(ctx: Context): void {
  const settings = ctx.settings.register(DESKTOP_MCP_SETTINGS_NAMESPACE, DesktopMcpSettingsSchema,
    { applies: 'live', validate: validateSettings })
  const controller = new DesktopMcpController(ctx, settings)
  controller.start()
  ctx.effect(() => () => controller.dispose(), 'dsh-plugin-desktop: MCP runtimes')
  const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  registerDesktopJsonApi(ctx, { label: 'MCP', readPath: DESKTOP_MCP_PATH, actionPath: DESKTOP_MCP_ACTION_PATH,
    read: () => controller.read(), action: value => handleAction(controller, value, rendererOrigin) })
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: DESKTOP_MCP_OAUTH_CALLBACK_PATH,
    handler: (req, res) => handleMcpOAuthCallback(controller, req, res, new URL(rendererOrigin).host) }),
  'dsh-plugin-desktop: MCP OAuth callback route')
}
