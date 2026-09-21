/** Headless checks against the signed ClawClaw release manifest. */

/** Public static release-manifest origin. */
export const CLAWCLAW_UPDATE_BASE_URL = 'https://clawclaw.xzinfra.com/updates'

/** The single release stream supported by the desktop product. */
export type DesktopReleaseChannel = 'stable'

/** Maximum response body bytes accepted from a release manifest. */
export const MAX_VERSION_RESPONSE_BYTES = 16 * 1024

/** Desktop installers declared by one release manifest. */
export type DesktopReleasePlatform = 'darwin' | 'win32'

/** One immutable installer reference published with a release. */
export interface DesktopReleaseArtifact {
  readonly url: string
  readonly sha512: string
  readonly size: number
}

/** Version and platform artifacts published atomically for one channel. */
export interface DesktopReleaseManifest {
  readonly version: string
  readonly channel: DesktopReleaseChannel
  readonly artifacts: Readonly<Record<DesktopReleasePlatform, DesktopReleaseArtifact>>
}

/** Strictly parsed SemVer components. Numeric components remain strings to avoid overflow. */
export interface ParsedSemVer {
  readonly version: string
  readonly major: string
  readonly minor: string
  readonly patch: string
  readonly prerelease: readonly string[]
  readonly build: readonly string[]
}

/** Fetch-compatible request function used by the headless checker. */
export type UpdateRequest = (url: string, init: RequestInit) => Promise<Response>

/** Inputs for one channel-scoped version check. */
export interface UpdateCheckOptions {
  readonly currentVersion: string
  readonly channel: DesktopReleaseChannel
  readonly signal?: AbortSignal
  readonly request?: UpdateRequest
}

/** Successful comparison returned by the static release manifest. */
export type UpdateCheckResult = {
  readonly status: 'up-to-date' | 'update-available'
  readonly currentVersion: string
  readonly latestVersion: string
}

const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u
const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/u

export function desktopReleaseManifestUrl(channel: DesktopReleaseChannel): string {
  return `${CLAWCLAW_UPDATE_BASE_URL}/${channel}/release.json`
}

export function parseSemVer(input: string): ParsedSemVer | null {
  const version = input.startsWith('v') ? input.slice(1) : input
  const match = SEMVER_PATTERN.exec(version)
  if (match === null) return null
  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some(identifier => isNumeric(identifier) && hasLeadingZero(identifier))) return null
  return { version, major: match[1]!, minor: match[2]!, patch: match[3]!, prerelease, build: match[5]?.split('.') ?? [] }
}

export function compareSemVerVersions(left: string, right: string): number | null {
  const leftVersion = parseSemVer(left)
  const rightVersion = parseSemVer(right)
  return leftVersion === null || rightVersion === null ? null : compareParsedSemVer(leftVersion, rightVersion)
}

/** Fetch and strictly validate one static, channel-specific release manifest. */
export async function fetchDesktopReleaseManifest(
  channel: DesktopReleaseChannel,
  request: UpdateRequest = defaultRequest,
  signal?: AbortSignal,
): Promise<DesktopReleaseManifest | null> {
  let response: Response
  try {
    response = await request(desktopReleaseManifestUrl(channel), {
      method: 'GET', cache: 'no-store', redirect: 'error',
      ...(signal === undefined ? {} : { signal }),
    })
  } catch { return null }
  if (response.status !== 200) return null
  try { return parseReleaseManifest(await readLimitedBody(response), channel) } catch { return null }
}

/** Check whether a newer release exists in one published channel. */
export async function checkForDesktopUpdate(options: UpdateCheckOptions): Promise<UpdateCheckResult | null> {
  const current = parseCanonicalChannelVersion(options.currentVersion)
  if (current === null) return null
  const release = await fetchDesktopReleaseManifest(options.channel, options.request, options.signal)
  if (release === null) return null
  const latest = parseCanonicalChannelVersion(release.version)
  if (latest === null) return null
  const comparison = compareParsedSemVer(latest, current)
  return {
    status: comparison > 0 ? 'update-available' : 'up-to-date',
    currentVersion: current.version, latestVersion: latest.version,
  }
}

export function checkForStableUpdate(options: Omit<UpdateCheckOptions, 'channel'>): Promise<UpdateCheckResult | null> {
  return checkForDesktopUpdate({ ...options, channel: 'stable' })
}

async function defaultRequest(url: string, init: RequestInit): Promise<Response> { return globalThis.fetch(url, init) }

async function readLimitedBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && /^[0-9]+$/u.test(declaredLength) && BigInt(declaredLength) > BigInt(MAX_VERSION_RESPONSE_BYTES)) throw new Error('manifest too large')
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('manifest body missing')
  const decoder = new TextDecoder(); let bytes = 0; let text = ''
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > MAX_VERSION_RESPONSE_BYTES) throw new Error('manifest too large'); text += decoder.decode(chunk.value, { stream: true }) }
    return text + decoder.decode()
  } finally { reader.releaseLock() }
}

function parseReleaseManifest(body: string, expectedChannel: DesktopReleaseChannel): DesktopReleaseManifest | null {
  let value: unknown; try { value = JSON.parse(body) } catch { return null }
  if (!isRecord(value) || value.channel !== expectedChannel || typeof value.version !== 'string' || !isRecord(value.artifacts)) return null
  if (parseCanonicalChannelVersion(value.version) === null) return null
  const artifacts = {} as Record<DesktopReleasePlatform, DesktopReleaseArtifact>
  for (const platform of ['darwin', 'win32'] as const) {
    const artifact = value.artifacts[platform]
    if (!isRecord(artifact) || typeof artifact.url !== 'string' || typeof artifact.sha512 !== 'string' || typeof artifact.size !== 'number' || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > 1024 * 1024 * 1024 || !SHA512_BASE64.test(artifact.sha512)) return null
    let url: URL; try { url = new URL(artifact.url) } catch { return null }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null
    artifacts[platform] = { url: url.href, sha512: artifact.sha512, size: artifact.size }
  }
  return { version: value.version, channel: expectedChannel, artifacts }
}

function parseCanonicalChannelVersion(input: string): ParsedSemVer | null {
  const parsed = parseSemVer(input)
  if (parsed === null || parsed.version !== input) return null
  return parsed.prerelease.length === 0 ? parsed : null
}

function compareParsedSemVer(left: ParsedSemVer, right: ParsedSemVer): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    const comparison = compareNumeric(left[key], right[key])
    if (comparison !== 0) return comparison
  }
  if (left.prerelease.length === 0) return right.prerelease.length === 0 ? 0 : 1
  if (right.prerelease.length === 0) return -1

  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index]
    const rightIdentifier = right.prerelease[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue

    const leftNumeric = isNumeric(leftIdentifier)
    const rightNumeric = isNumeric(rightIdentifier)
    if (leftNumeric && rightNumeric) return compareNumeric(leftIdentifier, rightIdentifier)
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return leftIdentifier < rightIdentifier ? -1 : 1
  }
  return 0
}

function compareNumeric(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

function isNumeric(identifier: string): boolean {
  return /^[0-9]+$/u.test(identifier)
}

function hasLeadingZero(identifier: string): boolean {
  return identifier.length > 1 && identifier.startsWith('0')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
