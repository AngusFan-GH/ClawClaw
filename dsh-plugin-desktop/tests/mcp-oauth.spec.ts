import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  buildMcpAuthorizationUrl, createMcpPkce, discoverMcpOAuthIssuer, discoverMcpOAuthMetadata, exchangeMcpAuthorizationCode,
  isTransientMcpOAuthError, parseMcpOAuthChallenge, parseMcpOAuthGrant, refreshMcpOAuthGrant, registerMcpOAuthClient,
  revokeMcpOAuthGrant, type OAuthFetch,
} from '../src/mcp-oauth.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('MCP OAuth', () => {
  it('creates an RFC 7636 S256 verifier and challenge', () => {
    const pair = createMcpPkce()
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43)
    expect(pair.challenge).toBe(createHash('sha256').update(pair.verifier, 'ascii').digest('base64url'))
  })

  it('discovers exact-issuer metadata with secure endpoints', async () => {
    const fetcher = vi.fn<OAuthFetch>(async () => json({
      issuer: 'https://identity.example.com/tenant', authorization_endpoint: 'https://identity.example.com/authorize',
      token_endpoint: 'https://identity.example.com/token', registration_endpoint: 'https://identity.example.com/register',
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
    }))
    const metadata = await discoverMcpOAuthMetadata('https://identity.example.com/tenant', fetcher)
    expect(metadata.authorizationEndpoint).toBe('https://identity.example.com/authorize')
    expect(fetcher).toHaveBeenCalledWith('https://identity.example.com/.well-known/oauth-authorization-server/tenant', expect.anything())
  })

  it('rejects insecure issuers and metadata substitution', async () => {
    await expect(discoverMcpOAuthMetadata('http://identity.example.com', vi.fn())).rejects.toThrow(/HTTPS/)
    await expect(discoverMcpOAuthMetadata('https://identity.example.com', async () => json({ issuer: 'https://evil.example.com' }))).rejects.toThrow(/issuer mismatch/)
  })

  it('derives the issuer from a Bearer challenge and protected resource metadata', async () => {
    const fetcher = vi.fn<OAuthFetch>(async input => {
      const url = String(input)
      if (url === 'https://mcp.example.com/mcp') return new Response('', { status: 401,
        headers: { 'WWW-Authenticate': 'Bearer realm="mcp", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"' } })
      return json({ resource: 'https://mcp.example.com/', authorization_servers: ['https://identity.example.com'],
        scopes_supported: ['mcp:tools'] })
    })
    expect(parseMcpOAuthChallenge('Bearer resource_metadata="https://mcp.example.com/metadata"')).toEqual({
      resourceMetadata: 'https://mcp.example.com/metadata',
    })
    await expect(discoverMcpOAuthIssuer('https://mcp.example.com/mcp', fetcher)).resolves.toEqual({
      issuer: 'https://identity.example.com', metadata: {
        resource: 'https://mcp.example.com/', authorizationServers: ['https://identity.example.com'], scopesSupported: ['mcp:tools'],
      },
    })
  })

  it('classifies temporary token failures and honors Retry-After', async () => {
    const grant = { issuer: 'https://identity.example.com', tokenEndpoint: 'https://identity.example.com/token',
      clientId: 'client-id', tokenEndpointAuthMethod: 'none' as const, accessToken: 'expired', refreshToken: 'refresh', expiresAt: 1 }
    const failure = await refreshMcpOAuthGrant(grant, async () => json({ error: 'temporarily_unavailable' }, 503)
    ).catch((cause: unknown) => cause)
    expect(isTransientMcpOAuthError(failure)).toBe(true)
    const throttled = await refreshMcpOAuthGrant(grant, async () => new Response(JSON.stringify({ error: 'slow_down' }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '7' },
    })).catch((cause: unknown) => cause)
    expect(isTransientMcpOAuthError(throttled) && throttled.retryAfterMs).toBe(7_000)
    const expired = await refreshMcpOAuthGrant(grant, async () => json({ error: 'invalid_grant' }, 400)
    ).catch((cause: unknown) => cause)
    expect(isTransientMcpOAuthError(expired)).toBe(false)
  })

  it('registers a client, exchanges a code, and rotates a refresh token without exposing secrets in the authorization URL', async () => {
    const calls: Array<{ url: string, init: RequestInit | undefined }> = []
    const fetcher: OAuthFetch = async (input, init) => {
      const url = String(input); calls.push({ url, init })
      if (url.endsWith('/register')) return json({ client_id: 'client-id', client_secret: 'client-secret', token_endpoint_auth_method: 'client_secret_post' })
      if (calls.filter(call => call.url.endsWith('/token')).length === 1) return json({ access_token: 'access-one', refresh_token: 'refresh-one', token_type: 'Bearer', expires_in: 60 })
      return json({ access_token: 'access-two', refresh_token: 'refresh-two', token_type: 'bearer', expires_in: 120 })
    }
    const metadata = {
      issuer: 'https://identity.example.com', authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token', registrationEndpoint: 'https://identity.example.com/register',
      codeChallengeMethodsSupported: ['S256'], tokenEndpointAuthMethodsSupported: ['client_secret_post'],
    }
    const registration = await registerMcpOAuthClient(metadata, 'http://127.0.0.1:3210/callback', 'ClawClaw', 'mcp:tools', fetcher)
    const authorizationUrl = buildMcpAuthorizationUrl({ metadata, clientId: registration.clientId,
      redirectUri: 'http://127.0.0.1:3210/callback', scope: 'mcp:tools', state: 'state-value', challenge: 'challenge-value', resource: 'https://mcp.example.com/' })
    expect(authorizationUrl).not.toContain('client-secret')
    expect(new URL(authorizationUrl).searchParams.get('code_challenge_method')).toBe('S256')
    const grant = await exchangeMcpAuthorizationCode({ metadata, registration, code: 'code-value', verifier: 'verifier-value',
      redirectUri: 'http://127.0.0.1:3210/callback', scope: 'mcp:tools', resource: 'https://mcp.example.com/', fetcher })
    expect(grant).toMatchObject({ accessToken: 'access-one', refreshToken: 'refresh-one', resource: 'https://mcp.example.com/' })
    expect(String(calls.find(call => call.url.endsWith('/token'))?.init?.body)).toContain('code_verifier=verifier-value')
    const refreshed = await refreshMcpOAuthGrant(grant, fetcher)
    expect(refreshed).toMatchObject({ accessToken: 'access-two', refreshToken: 'refresh-two' })
    expect(parseMcpOAuthGrant(JSON.stringify(refreshed))).toEqual(refreshed)
  })

  it('revokes the refresh token with client authentication', async () => {
    let request: RequestInit | undefined
    const revoked = await revokeMcpOAuthGrant({ issuer: 'https://identity.example.com', tokenEndpoint: 'https://identity.example.com/token',
      revocationEndpoint: 'https://identity.example.com/revoke', clientId: 'client-id', clientSecret: 'client-secret',
      tokenEndpointAuthMethod: 'client_secret_post', accessToken: 'access', refreshToken: 'refresh' }, async (_input, init) => {
      request = init
      return json({})
    })
    expect(revoked).toBe(true)
    expect(String(request?.body)).toContain('token=refresh')
    expect(String(request?.body)).toContain('token_type_hint=refresh_token')
    expect(String(request?.body)).toContain('client_secret=client-secret')
  })
})
