/** Headless, confirmation-gated downloads for ClawClaw installers. */

import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  compareSemVerVersions,
  fetchDesktopReleaseManifest,
  parseSemVer,
  type DesktopReleaseChannel,
} from './update-checker.ts'

/** Desktop platforms with a fixed installer download endpoint. */
export type DesktopDownloadPlatform = 'darwin' | 'win32'

/** Maximum accepted installer size, in bytes. */
export const MAX_UPDATE_DOWNLOAD_BYTES = 1024 * 1024 * 1024

/** Failure categories exposed to the update coordinator. */
export type UpdateDownloadErrorCode =
  | 'aborted'
  | 'empty-body'
  | 'http-status'
  | 'invalid-artifact'
  | 'invalid-options'
  | 'network'
  | 'response-too-large'

/** Fetch-compatible request boundary supplied by the Electron adapter or a test. */
export type UpdateArtifactRequest = (url: string, init: RequestInit) => Promise<Response>

/** Inputs for one user-confirmed installer download. */
export interface DownloadDesktopUpdateOptions {
  /** Host platform selecting the fixed endpoint and installer validation. */
  readonly platform: DesktopDownloadPlatform
  /** Stable release version used to validate the selected installer. */
  readonly version: string
  /** Release stream selected by the running Desktop flavor. */
  readonly channel?: DesktopReleaseChannel
  /** Absolute installer path selected by the user. */
  readonly destinationPath: string
  /** Request implementation, normally backed by Electron `net.fetch`. */
  readonly request: UpdateArtifactRequest
  /** Optional cancellation signal owned by the update coordinator. */
  readonly signal?: AbortSignal
  /** Optional native progress sink; receives 0..1 while downloading and -1 when finished. */
  readonly progress?: (fraction: number) => void
}

/** Typed failure from installer request, validation, or cancellation. */
export class UpdateDownloadError extends Error {
  /** Stable programmatic failure category. */
  readonly code: UpdateDownloadErrorCode
  /** HTTP status for an unsuccessful response, otherwise undefined. */
  readonly status: number | undefined

  /**
   * Create one safe update-download failure.
   * @param code - Stable failure category.
   * @param message - Diagnostic text without response content.
   * @param options - Optional HTTP status and underlying failure.
   */
  constructor(
    code: UpdateDownloadErrorCode,
    message: string,
    options: { readonly status?: number; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'UpdateDownloadError'
    this.code = code
    this.status = options.status
  }
}

const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const DECIMAL_BYTES = /^(0|[1-9][0-9]*)$/u
const DMG_TRAILER_BYTES = 512
const DMG_TRAILER_MAGIC = Buffer.from('koly', 'ascii')
const DOS_HEADER_BYTES = 64
const PE_OFFSET_POSITION = 0x3c
const PE_MAGIC = Buffer.from([0x50, 0x45, 0x00, 0x00])
const ARTIFACT_REQUEST_ATTEMPTS = 3
const CONTENT_RANGE = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/u

interface DownloadPaths {
  readonly completed: string
  readonly temporary: string
}

/** Downloaded installer tracked until the upgraded application resolves retention. */
export interface DesktopUpdateArtifact {
  readonly platform: DesktopDownloadPlatform
  readonly version: string
  readonly path: string
}

const UPDATE_ARTIFACT_STATE_VERSION = 1
const UPDATE_ARTIFACT_STATE_BYTES = 4 * 1024
const UPDATE_ARTIFACT_STATE_FILENAME = 'pending-installer.json'

/**
 * Download one installer after its caller has obtained user confirmation.
 * @param options - Fixed platform, release version, selected destination, request, and cancellation inputs.
 * @returns Absolute path to the completely written and validated installer.
 * @throws {UpdateDownloadError} For invalid inputs, transport failures, rejected responses, cancellation, and invalid installers.
 */
export async function downloadDesktopUpdate(options: DownloadDesktopUpdateOptions): Promise<string> {
  const platform = validatedPlatform(options.platform)
  const channel = options.channel ?? 'stable'
  validatedVersion(options.version, channel)
  const destinationPath = validatedArtifactPath(options.destinationPath, platform)
  const paths = await prepareDownloadPaths(destinationPath)
  throwIfAborted(options.signal)

  const manifest = await fetchDesktopReleaseManifest(channel, options.request, options.signal)
  throwIfAborted(options.signal)
  if (manifest === null || manifest.version !== options.version) {
    throw new UpdateDownloadError('invalid-artifact', 'The selected ClawClaw release is no longer available.')
  }
  const artifact = manifest.artifacts[platform]
  if (await isValidCompletedArtifact(paths.completed, artifact.size, artifact.sha512, platform)) {
    return paths.completed
  }

  let failure: unknown
  options.progress?.(0)
  try {
    await downloadArtifactWithResume(paths.temporary, artifact.url, artifact.size, options)
    throwIfAborted(options.signal)
    await validateArtifactChecksum(paths.temporary, artifact.sha512)
    await validateArtifact(paths.temporary, platform)
    throwIfAborted(options.signal)
    await replaceCompletedArtifact(paths.temporary, paths.completed)
    return paths.completed
  } catch (cause) {
    failure = options.signal?.aborted === true || isAbortFailure(cause) ? aborted(cause) : cause
    throw failure
  } finally {
    options.progress?.(-1)
    try {
      await unlinkIfPresent(paths.temporary)
    } catch (cleanupCause) {
      if (failure === undefined) throw cleanupCause
      throw new AggregateError([failure, cleanupCause], 'Failed to download and clean up the update installer.')
    }
  }
}

async function isValidCompletedArtifact(
  filename: string,
  expectedSize: number,
  expectedChecksum: string,
  platform: DesktopDownloadPlatform,
): Promise<boolean> {
  const stat = await lstatOptional(filename)
  if (stat === undefined || !stat.isFile() || stat.isSymbolicLink() || stat.size !== expectedSize) return false
  try {
    await validateArtifactChecksum(filename, expectedChecksum)
    await validateArtifact(filename, platform)
    return true
  } catch (cause) {
    if (cause instanceof UpdateDownloadError && cause.code === 'invalid-artifact') return false
    throw cause
  }
}

async function replaceCompletedArtifact(temporary: string, completed: string): Promise<void> {
  try {
    await rename(temporary, completed)
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'EPERM') throw cause
    const completedStat = await lstatOptional(completed)
    if (completedStat === undefined || !completedStat.isFile() || completedStat.isSymbolicLink()) throw cause
    await unlink(completed)
    await rename(temporary, completed)
  }
}

/** Prepare the private, product-owned destination used for one downloaded installer. */
export async function desktopUpdateDestination(
  userDataPath: string,
  platform: DesktopDownloadPlatform,
  version: string,
  channel: DesktopReleaseChannel = 'stable',
): Promise<string> {
  const root = validatedUserDataPath(userDataPath)
  validatedPlatform(platform)
  validatedVersion(version, channel)
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new UpdateDownloadError('invalid-options', 'The update user-data path must be a real directory.')
  }
  const directory = join(root, 'updates', 'installers')
  await preparePrivateDirectory(directory)
  return join(directory, desktopUpdateFilename(platform, version, channel))
}

/** Fixed default filename shown by the native destination picker. */
export function desktopUpdateFilename(
  platform: DesktopDownloadPlatform,
  version: string,
  channel: DesktopReleaseChannel = 'stable',
): string {
  validatedPlatform(platform)
  validatedVersion(version, channel)
  const extension = platform === 'darwin' ? 'dmg' : 'exe'
  const platformName = platform === 'darwin' ? 'mac' : 'windows'
  return `ClawClaw-${version}-${platformName}.${extension}`
}

/** Remember a downloaded installer until an upgraded application resolves its retention. */
export async function recordDesktopUpdateArtifact(
  userDataPath: string,
  artifact: DesktopUpdateArtifact,
): Promise<void> {
  const statePath = await prepareArtifactStatePath(userDataPath)
  const value = await validatedArtifactRecord(artifact, true)
  await writeFileAtomic(statePath, `${JSON.stringify({
    stateVersion: UPDATE_ARTIFACT_STATE_VERSION,
    ...value,
  })}\n`, {
    mode: PRIVATE_FILE_MODE,
    dirMode: PRIVATE_DIRECTORY_MODE,
  })
}

/** Return a retained installer only after the running version reaches its target. */
export async function pendingDesktopUpdateArtifact(
  userDataPath: string,
  currentVersion: string,
  platform: DesktopDownloadPlatform,
): Promise<DesktopUpdateArtifact | undefined> {
  const statePath = artifactStatePath(validatedUserDataPath(userDataPath))
  validatedReleaseVersion(currentVersion)
  validatedPlatform(platform)
  let value: DesktopUpdateArtifact
  try {
    value = await readArtifactRecord(statePath)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
  if (value.platform !== platform) return undefined
  const comparison = compareSemVerVersions(currentVersion, value.version)
  if (comparison === null || comparison < 0) return undefined
  try {
    const stat = await lstat(value.path)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new UpdateDownloadError('invalid-options', 'The retained update installer is not a regular file.')
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    await unlinkIfPresent(statePath)
    return undefined
  }
  return value
}

/** Apply one explicit delete/keep choice and consume its cleanup state. */
export async function resolveDesktopUpdateArtifact(
  userDataPath: string,
  artifact: DesktopUpdateArtifact,
  remove: boolean,
): Promise<void> {
  const statePath = artifactStatePath(validatedUserDataPath(userDataPath))
  const current = await readArtifactRecord(statePath)
  const expected = await validatedArtifactRecord(artifact, false)
  if (current.platform !== expected.platform
    || current.version !== expected.version
    || current.path !== expected.path) {
    throw new UpdateDownloadError('invalid-options', 'The update artifact cleanup state changed.')
  }
  if (remove) await unlinkIfPresent(expected.path)
  await unlinkIfPresent(statePath)
}

function validatedPlatform(platform: DesktopDownloadPlatform): DesktopDownloadPlatform {
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new UpdateDownloadError('invalid-options', `Unsupported update download platform: ${String(platform)}`)
  }
  return platform
}

function validatedVersion(version: string, channel: DesktopReleaseChannel = 'stable'): string {
  const parsed = parseSemVer(version)
  const expectedPrerelease = parsed?.prerelease.length === 0
  if (parsed === null || !expectedPrerelease || parsed.version !== version) {
    throw new UpdateDownloadError('invalid-options', `The update version must match the ${channel} channel.`)
  }
  return version
}

function validatedReleaseVersion(version: string): string {
  const parsed = parseSemVer(version)
  if (parsed === null || parsed.version !== version || parsed.prerelease.length !== 0) {
    throw new UpdateDownloadError('invalid-options', 'The update version must belong to a supported release channel.')
  }
  return version
}

function validatedUserDataPath(userDataPath: string): string {
  if (userDataPath.length === 0 || /[\0\r\n]/u.test(userDataPath) || !isAbsolute(userDataPath)) {
    throw new UpdateDownloadError('invalid-options', 'The update user-data path must be an absolute path.')
  }
  return resolve(userDataPath)
}

async function prepareDownloadPaths(
  destinationPath: string,
): Promise<DownloadPaths> {
  const directory = dirname(destinationPath)
  const directoryStat = await lstat(directory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new UpdateDownloadError('invalid-options', 'The update destination directory must be a real directory.')
  }
  const completedStat = await lstatOptional(destinationPath)
  if (completedStat !== undefined) {
    if (!completedStat.isFile() || completedStat.isSymbolicLink()) {
      throw new UpdateDownloadError('invalid-options', 'The completed update path is not a regular file.')
    }
  }

  return {
    completed: destinationPath,
    temporary: join(directory, `.${basename(destinationPath)}.${process.pid}.${randomUUID()}.partial`),
  }
}

function validatedArtifactPath(path: string, platform: DesktopDownloadPlatform): string {
  if (path.length === 0 || /[\0\r\n]/u.test(path) || !isAbsolute(path)) {
    throw new UpdateDownloadError('invalid-options', 'The update destination path must be absolute.')
  }
  const expectedExtension = platform === 'darwin' ? '.dmg' : '.exe'
  if (extname(path).toLowerCase() !== expectedExtension) {
    throw new UpdateDownloadError('invalid-options', `The update destination must use ${expectedExtension}.`)
  }
  return resolve(path)
}

async function prepareArtifactStatePath(userDataPath: string): Promise<string> {
  const root = validatedUserDataPath(userDataPath)
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new UpdateDownloadError('invalid-options', 'The update user-data path must be a real directory.')
  }
  const directory = join(root, 'updates')
  await preparePrivateDirectory(directory)
  return artifactStatePath(root)
}

function artifactStatePath(userDataPath: string): string {
  return join(userDataPath, 'updates', UPDATE_ARTIFACT_STATE_FILENAME)
}

async function validatedArtifactRecord(
  artifact: DesktopUpdateArtifact,
  requireFile: boolean,
): Promise<DesktopUpdateArtifact> {
  const platform = validatedPlatform(artifact.platform)
  const version = validatedReleaseVersion(artifact.version)
  const path = validatedArtifactPath(artifact.path, platform)
  if (requireFile) {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new UpdateDownloadError('invalid-options', 'The retained update installer must be a regular file.')
    }
  }
  return { platform, version, path }
}

async function parseArtifactRecord(text: string): Promise<DesktopUpdateArtifact> {
  let value: unknown
  try { value = JSON.parse(text) } catch {
    throw new UpdateDownloadError('invalid-options', 'The update artifact cleanup state is invalid.')
  }
  if (value === null
    || typeof value !== 'object'
    || (value as { stateVersion?: unknown }).stateVersion !== UPDATE_ARTIFACT_STATE_VERSION
    || ((value as { platform?: unknown }).platform !== 'darwin'
      && (value as { platform?: unknown }).platform !== 'win32')
    || typeof (value as { version?: unknown }).version !== 'string'
    || typeof (value as { path?: unknown }).path !== 'string'
    || Object.keys(value).some(key => !['stateVersion', 'platform', 'version', 'path'].includes(key))) {
    throw new UpdateDownloadError('invalid-options', 'The update artifact cleanup state is invalid.')
  }
  return await validatedArtifactRecord(value as DesktopUpdateArtifact, false)
}

async function readArtifactRecord(statePath: string): Promise<DesktopUpdateArtifact> {
  const stat = await lstat(statePath)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > UPDATE_ARTIFACT_STATE_BYTES) {
    throw new UpdateDownloadError('invalid-options', 'The update artifact cleanup state is invalid.')
  }
  return await parseArtifactRecord(await readFile(statePath, 'utf8'))
}

async function preparePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new UpdateDownloadError('invalid-options', 'An update destination component is not a real directory.')
  }
  await chmod(directory, PRIVATE_DIRECTORY_MODE)
}

async function lstatOptional(filename: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(filename)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
}

async function downloadArtifactWithResume(
  filename: string,
  url: string,
  expectedSize: number,
  options: Pick<DownloadDesktopUpdateOptions, 'request' | 'signal' | 'progress'>,
): Promise<void> {
  let offset = 0
  let lastFailure: UpdateDownloadError | undefined
  for (let attempt = 0; attempt < ARTIFACT_REQUEST_ATTEMPTS; attempt += 1) {
    throwIfAborted(options.signal)
    let response: Response
    try {
      response = await options.request(url, {
        method: 'GET', cache: 'no-store', redirect: 'error',
        ...(offset === 0 ? {} : { headers: { Range: `bytes=${String(offset)}-` } }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    } catch (cause) {
      if (options.signal?.aborted === true || isAbortFailure(cause)) throw aborted(cause)
      lastFailure = new UpdateDownloadError('network', 'The update installer could not be downloaded.', { cause })
      continue
    }

    const expectedStatus = offset === 0 ? 200 : 206
    if (response.status !== expectedStatus) {
      await response.body?.cancel().catch(() => undefined)
      if (offset > 0 && response.status === 200) {
        await unlinkIfPresent(filename)
        offset = 0
        continue
      }
      const failure = new UpdateDownloadError(
        'http-status',
        `The update download service returned HTTP ${String(response.status)}.`,
        { status: response.status },
      )
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        lastFailure = failure
        continue
      }
      throw failure
    }
    if (response.body === null) {
      lastFailure = new UpdateDownloadError('empty-body', 'The update download service returned an empty body.')
      continue
    }
    try {
      assertDeclaredSize(response, expectedSize - offset)
      if (offset > 0) assertContentRange(response, offset, expectedSize)
      await appendResponseBody(filename, response.body, options.signal, offset, expectedSize, options.progress)
      return
    } catch (cause) {
      await response.body.cancel(cause).catch(() => undefined)
      if (!(cause instanceof UpdateDownloadError) || cause.code !== 'network') throw cause
      lastFailure = cause
      const stat = await lstatOptional(filename)
      offset = stat?.isFile() === true && !stat.isSymbolicLink() ? Number(stat.size) : 0
      if (offset > expectedSize) throw new UpdateDownloadError(
        'invalid-artifact', 'The update installer exceeds its published size.',
      )
      if (offset === expectedSize) return
      if (offset === 0) await unlinkIfPresent(filename)
    }
  }
  throw lastFailure ?? new UpdateDownloadError('network', 'The update installer could not be downloaded.')
}

function assertDeclaredSize(response: Response, expectedSize: number): void {
  const declared = response.headers.get('content-length')
  if (declared === null || !DECIMAL_BYTES.test(declared)) return
  if (BigInt(declared) > BigInt(MAX_UPDATE_DOWNLOAD_BYTES)) {
    throw new UpdateDownloadError(
      'response-too-large',
      `The update installer exceeds ${String(MAX_UPDATE_DOWNLOAD_BYTES)} bytes.`,
    )
  }
  if (BigInt(declared) !== BigInt(expectedSize)) {
    throw new UpdateDownloadError('invalid-artifact', 'The update installer size does not match the published release.')
  }
}

function assertContentRange(response: Response, expectedStart: number, expectedSize: number): void {
  const value = response.headers.get('content-range')
  const match = value === null ? null : CONTENT_RANGE.exec(value)
  if (match === null
    || Number(match[1]) !== expectedStart
    || Number(match[2]) !== expectedSize - 1
    || Number(match[3]) !== expectedSize) {
    throw new UpdateDownloadError('invalid-artifact', 'The resumed update response range is invalid.')
  }
}

async function appendResponseBody(
  filename: string,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  initialBytes: number,
  expectedSize: number,
  progress?: (fraction: number) => void,
): Promise<void> {
  const handle = await open(filename, initialBytes === 0 ? 'wx' : 'a', PRIVATE_FILE_MODE)
  const reader = body.getReader()
  const cancel = (): void => { void reader.cancel(signal?.reason).catch(() => undefined) }
  signal?.addEventListener('abort', cancel, { once: true })
  let bytesWritten = initialBytes
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size !== initialBytes) {
      throw new UpdateDownloadError('invalid-options', 'The partial update installer changed during download.')
    }
    while (true) {
      throwIfAborted(signal)
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (cause) {
        throw new UpdateDownloadError('network', 'The update installer connection was interrupted.', { cause })
      }
      throwIfAborted(signal)
      if (chunk.done) break
      if (chunk.value.byteLength > MAX_UPDATE_DOWNLOAD_BYTES - bytesWritten) {
        throw new UpdateDownloadError(
          'response-too-large',
          `The update installer exceeds ${String(MAX_UPDATE_DOWNLOAD_BYTES)} bytes.`,
        )
      }
      if (chunk.value.byteLength > expectedSize - bytesWritten) {
        throw new UpdateDownloadError('invalid-artifact', 'The update installer exceeds its published size.')
      }
      await writeAll(handle, chunk.value)
      bytesWritten += chunk.value.byteLength
      progress?.(bytesWritten / expectedSize)
    }
    if (bytesWritten !== expectedSize) {
      throw new UpdateDownloadError('invalid-artifact', 'The update installer size does not match the published release.')
    }
    await handle.sync()
  } catch (cause) {
    await reader.cancel(cause).catch(() => undefined)
    throw cause
  } finally {
    signal?.removeEventListener('abort', cancel)
    reader.releaseLock()
    await handle.close()
  }
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  chunk: Uint8Array,
): Promise<void> {
  let offset = 0
  while (offset < chunk.byteLength) {
    const result = await handle.write(chunk, offset, chunk.byteLength - offset, null)
    if (result.bytesWritten === 0) throw new Error('The update installer write made no progress.')
    offset += result.bytesWritten
  }
}

async function validateArtifactChecksum(filename: string, expected: string): Promise<void> {
  const hash = createHash('sha512')
  const handle = await open(filename, 'r')
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let position = 0
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, position)
      if (result.bytesRead === 0) break
      hash.update(buffer.subarray(0, result.bytesRead))
      position += result.bytesRead
    }
  } finally { await handle.close() }
  if (hash.digest('base64') !== expected) throw new UpdateDownloadError('invalid-artifact', 'The update installer checksum does not match the published release.')
}

async function validateArtifact(filename: string, platform: DesktopDownloadPlatform): Promise<void> {
  const handle = await open(filename, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_UPDATE_DOWNLOAD_BYTES) {
      throw invalidArtifact(platform)
    }
    if (platform === 'darwin') {
      if (stat.size < DMG_TRAILER_BYTES) throw invalidArtifact(platform)
      const magic = Buffer.alloc(DMG_TRAILER_MAGIC.byteLength)
      const result = await handle.read(magic, 0, magic.byteLength, stat.size - DMG_TRAILER_BYTES)
      if (result.bytesRead !== magic.byteLength || !magic.equals(DMG_TRAILER_MAGIC)) {
        throw invalidArtifact(platform)
      }
      return
    }

    if (stat.size < DOS_HEADER_BYTES) throw invalidArtifact(platform)
    const dosHeader = Buffer.alloc(DOS_HEADER_BYTES)
    const dosResult = await handle.read(dosHeader, 0, dosHeader.byteLength, 0)
    if (dosResult.bytesRead !== dosHeader.byteLength || dosHeader[0] !== 0x4d || dosHeader[1] !== 0x5a) {
      throw invalidArtifact(platform)
    }
    const peOffset = dosHeader.readUInt32LE(PE_OFFSET_POSITION)
    if (peOffset > stat.size - PE_MAGIC.byteLength) throw invalidArtifact(platform)
    const peMagic = Buffer.alloc(PE_MAGIC.byteLength)
    const peResult = await handle.read(peMagic, 0, peMagic.byteLength, peOffset)
    if (peResult.bytesRead !== peMagic.byteLength || !peMagic.equals(PE_MAGIC)) {
      throw invalidArtifact(platform)
    }
  } finally {
    await handle.close()
  }
}

function invalidArtifact(platform: DesktopDownloadPlatform): UpdateDownloadError {
  return new UpdateDownloadError(
    'invalid-artifact',
    platform === 'darwin'
      ? 'The downloaded file is not a UDIF disk image.'
      : 'The downloaded file is not a PE executable.',
  )
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return
  throw aborted(signal.reason)
}

function aborted(cause: unknown): UpdateDownloadError {
  return new UpdateDownloadError('aborted', 'The update installer download was cancelled.', { cause })
}

function isAbortFailure(value: unknown): boolean {
  return value instanceof UpdateDownloadError
    ? value.code === 'aborted'
    : typeof value === 'object'
      && value !== null
      && 'name' in value
      && value.name === 'AbortError'
}

async function unlinkIfPresent(filename: string): Promise<void> {
  try {
    await unlink(filename)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
}
