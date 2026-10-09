import { createHash, randomBytes } from 'node:crypto'

export type OAuthTokenEndpointAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic'
export type OAuthFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface McpOAuthMetadata {
  readonly issuer: string
  readonly authorizationEndpoint: string
  readonly tokenEndpoint: string
  readonly registrationEndpoint: string
  readonly revocationEndpoint?: string
  readonly codeChallengeMethodsSupported: readonly string[]
  readonly tokenEndpointAuthMethodsSupported: readonly string[]
}
export interface McpOAuthClientRegistration {
  readonly clientId: string
  readonly clientSecret?: string
  readonly tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod
}
export interface McpOAuthTokenGrant extends McpOAuthClientRegistration {
  readonly issuer: string
  readonly tokenEndpoint: string
  readonly revocationEndpoint?: string
  readonly accessToken: string
  readonly refreshToken?: string
  readonly expiresAt?: number
  readonly scope?: string
  readonly resource?: string
}
export interface McpOAuthProtectedResourceMetadata {
  readonly resource: string
  readonly authorizationServers: readonly string[]
  readonly scopesSupported: readonly string[]
}
export class McpOAuthRequestError extends Error {
  constructor(message: string, readonly transient: boolean, readonly status?: number, readonly oauthError?: string,
    readonly retryAfterMs?: number) {
    super(message)
    this.name = 'McpOAuthRequestError'
  }
}

const MAX_RESPONSE_BYTES = 256 * 1024
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RETRY_AFTER_MS = 5 * 60_000

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function requiredText(value: unknown, field: string, max = 4_096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new Error(`OAuth response missing ${field}`)
  return value
}
export function assertSecureOAuthUrl(value: string, field = 'OAuth URL'): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new TypeError(`${field} must be an absolute HTTPS URL`) }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new TypeError(`${field} must be an HTTPS URL without credentials or fragments`)
  }
  return url
}
function metadataUrls(issuer: string): readonly string[] {
  const url = assertSecureOAuthUrl(issuer, 'OAuth issuer')
  if (url.search !== '') throw new TypeError('OAuth issuer must not contain a query')
  const path = url.pathname.replace(/\/+$/u, '')
  return Object.freeze([...new Set([
    `${url.origin}/.well-known/oauth-authorization-server${path}`,
    `${url.origin}${path}/.well-known/oauth-authorization-server`,
  ])])
}
function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (value === null) return undefined
  const seconds = Number(value)
  const duration = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : Date.parse(value) - now
  return Number.isFinite(duration) && duration >= 0 ? Math.min(duration, MAX_RETRY_AFTER_MS) : undefined
}
function transientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}
async function fetchJson(fetcher: OAuthFetch, url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  assertSecureOAuthUrl(url)
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    let response: Response
    try {
      response = await fetcher(url, { ...init, redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...init.headers } })
    } catch (cause) {
      if (cause instanceof McpOAuthRequestError) throw cause
      throw new McpOAuthRequestError(cause instanceof Error ? cause.message : 'OAuth request failed', true)
    }
    const text = await response.text()
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('OAuth response is too large')
    let body: unknown
    try { body = text === '' ? {} : JSON.parse(text) as unknown } catch {
      if (!response.ok) throw new McpOAuthRequestError(`OAuth request failed: HTTP ${String(response.status)}`,
        transientStatus(response.status), response.status, undefined, retryAfterMs(response.headers.get('retry-after')))
      throw new Error('OAuth response was not JSON')
    }
    if (!response.ok) {
      const oauthError = record(body) && typeof body.error === 'string' ? body.error : undefined
      const detail = oauthError ?? `HTTP ${String(response.status)}`
      throw new McpOAuthRequestError(`OAuth request failed: ${detail}`, transientStatus(response.status), response.status,
        oauthError, retryAfterMs(response.headers.get('retry-after')))
    }
    return body
  } finally { clearTimeout(timer) }
}

export function isTransientMcpOAuthError(cause: unknown): cause is McpOAuthRequestError {
  return cause instanceof McpOAuthRequestError && cause.transient
}

function unquoteChallengeValue(value: string): string {
  return value.replace(/\\(.)/gu, '$1')
}
export function parseMcpOAuthChallenge(header: string | null): { readonly resourceMetadata?: string, readonly authorizationUri?: string } {
  if (header === null || !/(?:^|,)\s*Bearer(?:\s|,)/iu.test(header)) return Object.freeze({})
  const parameter = (name: string): string | undefined => {
    const match = new RegExp(`(?:^|[,\\s])${name}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'iu').exec(header)
    return match?.[1] === undefined ? undefined : unquoteChallengeValue(match[1])
  }
  const resourceMetadata = parameter('resource_metadata')
  const authorizationUri = parameter('authorization_uri')
  return Object.freeze({ ...(resourceMetadata === undefined ? {} : { resourceMetadata }),
    ...(authorizationUri === undefined ? {} : { authorizationUri }) })
}

function protectedResourceMetadataUrls(resourceUrl: string, advertised?: string): readonly string[] {
  if (advertised !== undefined) return Object.freeze([assertSecureOAuthUrl(advertised, 'OAuth resource metadata URL').href])
  const resource = assertSecureOAuthUrl(resourceUrl, 'MCP OAuth resource URL')
  if (resource.search !== '') throw new TypeError('MCP OAuth resource URL must not contain a query')
  const path = resource.pathname.replace(/\/+$/u, '')
  return Object.freeze([...new Set([
    `${resource.origin}/.well-known/oauth-protected-resource${path}`,
    `${resource.origin}/.well-known/oauth-protected-resource`,
  ])])
}

export async function discoverMcpOAuthIssuer(resourceUrl: string, fetcher: OAuthFetch = globalThis.fetch): Promise<{
  readonly issuer: string
  readonly metadata: McpOAuthProtectedResourceMetadata
}> {
  const resource = assertSecureOAuthUrl(resourceUrl, 'MCP OAuth resource URL')
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, DEFAULT_TIMEOUT_MS)
  let challenge: ReturnType<typeof parseMcpOAuthChallenge> = {}
  try {
    try {
      const response = await fetcher(resource.href, { method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json, text/event-stream' } })
      challenge = parseMcpOAuthChallenge(response.headers.get('www-authenticate'))
      await response.body?.cancel()
    } catch { /* Standard well-known discovery remains available when the probe cannot complete. */ }
  } finally { clearTimeout(timer) }
  if (challenge.authorizationUri !== undefined && challenge.resourceMetadata === undefined) {
    assertSecureOAuthUrl(challenge.authorizationUri, 'OAuth authorization server')
    const issuer = challenge.authorizationUri
    return Object.freeze({ issuer, metadata: Object.freeze({ resource: resource.href,
      authorizationServers: Object.freeze([issuer]), scopesSupported: Object.freeze([]) }) })
  }
  let lastError: unknown
  for (const url of protectedResourceMetadataUrls(resource.href, challenge.resourceMetadata)) {
    try {
      const body = await fetchJson(fetcher, url)
      if (!record(body)) throw new Error('OAuth protected resource metadata is invalid')
      const metadataResource = requiredText(body.resource, 'resource')
      const parsedResource = assertSecureOAuthUrl(metadataResource, 'OAuth protected resource')
      if (parsedResource.origin !== resource.origin) throw new Error('OAuth protected resource metadata does not match the MCP server')
      const authorizationServers = Array.isArray(body.authorization_servers)
        ? body.authorization_servers.filter((item): item is string => typeof item === 'string').slice(0, 16)
          .map(item => { assertSecureOAuthUrl(item, 'OAuth authorization server'); return item }) : []
      if (authorizationServers.length === 0) throw new Error('OAuth protected resource metadata has no authorization server')
      const scopesSupported = Array.isArray(body.scopes_supported)
        ? body.scopes_supported.filter((item): item is string => typeof item === 'string').slice(0, 128) : []
      const metadata = Object.freeze({ resource: parsedResource.href, authorizationServers: Object.freeze(authorizationServers),
        scopesSupported: Object.freeze(scopesSupported) })
      return Object.freeze({ issuer: authorizationServers[0]!, metadata })
    } catch (cause) { lastError = cause }
  }
  throw lastError instanceof Error ? lastError : new Error('OAuth protected resource metadata discovery failed')
}

export async function discoverMcpOAuthMetadata(issuer: string, fetcher: OAuthFetch = globalThis.fetch): Promise<McpOAuthMetadata> {
  let lastError: unknown
  for (const url of metadataUrls(issuer)) {
    try {
      const body = await fetchJson(fetcher, url)
      if (!record(body) || body.issuer !== issuer) throw new Error('OAuth metadata issuer mismatch')
      const authorizationEndpoint = requiredText(body.authorization_endpoint, 'authorization_endpoint')
      const tokenEndpoint = requiredText(body.token_endpoint, 'token_endpoint')
      const registrationEndpoint = requiredText(body.registration_endpoint, 'registration_endpoint')
      assertSecureOAuthUrl(authorizationEndpoint, 'OAuth authorization endpoint')
      assertSecureOAuthUrl(tokenEndpoint, 'OAuth token endpoint')
      assertSecureOAuthUrl(registrationEndpoint, 'OAuth registration endpoint')
      const revocationEndpoint = typeof body.revocation_endpoint === 'string' && body.revocation_endpoint !== '' ? body.revocation_endpoint : undefined
      if (revocationEndpoint !== undefined) assertSecureOAuthUrl(revocationEndpoint, 'OAuth revocation endpoint')
      const strings = (value: unknown): readonly string[] => Array.isArray(value)
        ? Object.freeze(value.filter((item): item is string => typeof item === 'string').slice(0, 64)) : Object.freeze([])
      return Object.freeze({ issuer, authorizationEndpoint, tokenEndpoint, registrationEndpoint,
        ...(revocationEndpoint === undefined ? {} : { revocationEndpoint }),
        codeChallengeMethodsSupported: strings(body.code_challenge_methods_supported),
        tokenEndpointAuthMethodsSupported: strings(body.token_endpoint_auth_methods_supported) })
    } catch (cause) { lastError = cause }
  }
  throw lastError instanceof Error ? lastError : new Error('OAuth metadata discovery failed')
}

export function createMcpPkce(): { readonly verifier: string, readonly challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url')
  return Object.freeze({ verifier, challenge })
}

export async function registerMcpOAuthClient(
  metadata: McpOAuthMetadata,
  redirectUri: string,
  clientName: string,
  scope: string,
  fetcher: OAuthFetch = globalThis.fetch,
): Promise<McpOAuthClientRegistration> {
  const supported = new Set(metadata.tokenEndpointAuthMethodsSupported)
  const tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod = supported.has('none') || supported.size === 0
    ? 'none' : supported.has('client_secret_post') ? 'client_secret_post' : supported.has('client_secret_basic') ? 'client_secret_basic'
      : (() => { throw new Error('OAuth server has no supported token endpoint authentication method') })()
  const body = await fetchJson(fetcher, metadata.registrationEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: clientName, redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], token_endpoint_auth_method: tokenEndpointAuthMethod, scope }) })
  if (!record(body)) throw new Error('OAuth client registration response is invalid')
  const clientId = requiredText(body.client_id, 'client_id', 2_048)
  const resolvedMethod = (body.token_endpoint_auth_method ?? tokenEndpointAuthMethod) as OAuthTokenEndpointAuthMethod
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(resolvedMethod)) throw new Error('OAuth client registration returned an unsupported authentication method')
  const clientSecret = typeof body.client_secret === 'string' && body.client_secret !== '' ? body.client_secret : undefined
  if (resolvedMethod !== 'none' && clientSecret === undefined) throw new Error('OAuth client registration did not return a client secret')
  return Object.freeze({ clientId, tokenEndpointAuthMethod: resolvedMethod, ...(clientSecret === undefined ? {} : { clientSecret }) })
}

export function buildMcpAuthorizationUrl(input: {
  readonly metadata: McpOAuthMetadata
  readonly clientId: string
  readonly redirectUri: string
  readonly scope: string
  readonly state: string
  readonly challenge: string
  readonly resource?: string
}): string {
  const url = new URL(input.metadata.authorizationEndpoint)
  url.searchParams.set('response_type', 'code'); url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri); url.searchParams.set('scope', input.scope)
  url.searchParams.set('state', input.state); url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (input.resource !== undefined) url.searchParams.set('resource', input.resource)
  return url.href
}

function clientAuthentication(registration: McpOAuthClientRegistration, params: URLSearchParams, headers: Record<string, string>): void {
  if (registration.tokenEndpointAuthMethod === 'client_secret_basic') {
    headers.Authorization = `Basic ${Buffer.from(`${registration.clientId}:${registration.clientSecret ?? ''}`).toString('base64')}`
  } else {
    params.set('client_id', registration.clientId)
    if (registration.tokenEndpointAuthMethod === 'client_secret_post') params.set('client_secret', registration.clientSecret ?? '')
  }
}
async function requestToken(
  metadata: Pick<McpOAuthMetadata, 'issuer' | 'tokenEndpoint' | 'revocationEndpoint'>,
  registration: McpOAuthClientRegistration,
  params: URLSearchParams,
  fetcher: OAuthFetch,
  previous?: McpOAuthTokenGrant,
): Promise<McpOAuthTokenGrant> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
  clientAuthentication(registration, params, headers)
  const body = await fetchJson(fetcher, metadata.tokenEndpoint, { method: 'POST', headers, body: params.toString() })
  if (!record(body)) throw new Error('OAuth token response is invalid')
  const accessToken = requiredText(body.access_token, 'access_token', 32_768)
  if (body.token_type !== undefined && String(body.token_type).toLocaleLowerCase() !== 'bearer') throw new Error('OAuth token type must be Bearer')
  const expiresIn = Number(body.expires_in)
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1_000 : undefined
  const refreshToken = typeof body.refresh_token === 'string' && body.refresh_token !== '' ? body.refresh_token : previous?.refreshToken
  const scope = typeof body.scope === 'string' ? body.scope : previous?.scope
  return Object.freeze({ ...registration, issuer: metadata.issuer, tokenEndpoint: metadata.tokenEndpoint,
    ...(metadata.revocationEndpoint === undefined ? {} : { revocationEndpoint: metadata.revocationEndpoint }), accessToken,
    ...(refreshToken === undefined ? {} : { refreshToken }), ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(scope === undefined ? {} : { scope }), ...(previous?.resource === undefined ? {} : { resource: previous.resource }) })
}

export function exchangeMcpAuthorizationCode(input: {
  readonly metadata: McpOAuthMetadata
  readonly registration: McpOAuthClientRegistration
  readonly code: string
  readonly verifier: string
  readonly redirectUri: string
  readonly scope: string
  readonly resource?: string
  readonly fetcher?: OAuthFetch
}): Promise<McpOAuthTokenGrant> {
  const params = new URLSearchParams({ grant_type: 'authorization_code', code: input.code, code_verifier: input.verifier,
    redirect_uri: input.redirectUri })
  if (input.resource !== undefined) params.set('resource', input.resource)
  return requestToken(input.metadata, input.registration, params, input.fetcher ?? globalThis.fetch,
    { ...input.registration, issuer: input.metadata.issuer, tokenEndpoint: input.metadata.tokenEndpoint, accessToken: '', scope: input.scope,
      ...(input.resource === undefined ? {} : { resource: input.resource }) })
}

export function refreshMcpOAuthGrant(grant: McpOAuthTokenGrant, fetcher: OAuthFetch = globalThis.fetch): Promise<McpOAuthTokenGrant> {
  if (grant.refreshToken === undefined) throw new Error('OAuth authorization must be renewed')
  const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: grant.refreshToken })
  if (grant.scope !== undefined) params.set('scope', grant.scope)
  if (grant.resource !== undefined) params.set('resource', grant.resource)
  return requestToken(grant, grant, params, fetcher, grant)
}

export async function revokeMcpOAuthGrant(grant: McpOAuthTokenGrant, fetcher: OAuthFetch = globalThis.fetch): Promise<boolean> {
  if (grant.revocationEndpoint === undefined) return false
  const token = grant.refreshToken ?? grant.accessToken
  const params = new URLSearchParams({ token, token_type_hint: grant.refreshToken === undefined ? 'access_token' : 'refresh_token' })
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
  clientAuthentication(grant, params, headers)
  await fetchJson(fetcher, grant.revocationEndpoint, { method: 'POST', headers, body: params.toString() })
  return true
}

export function parseMcpOAuthGrant(value: string): McpOAuthTokenGrant {
  let parsed: unknown
  try { parsed = JSON.parse(value) as unknown } catch { throw new Error('Stored OAuth authorization is invalid') }
  if (!record(parsed)) throw new Error('Stored OAuth authorization is invalid')
  const method = parsed.tokenEndpointAuthMethod
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(String(method))) throw new Error('Stored OAuth authorization method is invalid')
  const grant = { clientId: requiredText(parsed.clientId, 'clientId', 2_048), tokenEndpointAuthMethod: method as OAuthTokenEndpointAuthMethod,
    issuer: requiredText(parsed.issuer, 'issuer'), tokenEndpoint: requiredText(parsed.tokenEndpoint, 'tokenEndpoint'),
    accessToken: requiredText(parsed.accessToken, 'accessToken', 32_768),
    ...(typeof parsed.clientSecret === 'string' ? { clientSecret: parsed.clientSecret } : {}),
    ...(typeof parsed.revocationEndpoint === 'string' ? { revocationEndpoint: parsed.revocationEndpoint } : {}),
    ...(typeof parsed.refreshToken === 'string' ? { refreshToken: parsed.refreshToken } : {}),
    ...(Number.isFinite(parsed.expiresAt) ? { expiresAt: parsed.expiresAt as number } : {}),
    ...(typeof parsed.scope === 'string' ? { scope: parsed.scope } : {}), ...(typeof parsed.resource === 'string' ? { resource: parsed.resource } : {}) }
  assertSecureOAuthUrl(grant.issuer, 'Stored OAuth issuer'); assertSecureOAuthUrl(grant.tokenEndpoint, 'Stored OAuth token endpoint')
  if (grant.revocationEndpoint !== undefined) assertSecureOAuthUrl(grant.revocationEndpoint, 'Stored OAuth revocation endpoint')
  return Object.freeze(grant)
}
