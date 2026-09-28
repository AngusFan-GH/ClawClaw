/** Qualify Authenticode publisher enforcement without executing an installer. */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { parse } from 'yaml'

export interface WindowsSignatureVerifier {
  verifySignature(path: string): Promise<string | null>
  dispose?(): void
}

export interface WindowsUpdateSignatureQualificationOptions {
  readonly platform: NodeJS.Platform
  readonly publisherName: string
  readonly signedPath: string
  readonly unsignedPath: string
  readonly updateConfigPath: string
  readonly createVerifier: (publisherName: readonly string[] | undefined) => Promise<WindowsSignatureVerifier>
}

export interface WindowsUpdateSignatureQualificationReport {
  readonly publisherName: string
  readonly signedSha512: string
  readonly unsignedSha512: string
  readonly cases: readonly string[]
}

function normalizedPublisher(value: unknown): readonly string[] | undefined {
  if (typeof value === 'string' && value.trim() !== '') return [value]
  if (Array.isArray(value) && value.length > 0
    && value.every(item => typeof item === 'string' && item.trim() !== '')) return value
  return undefined
}

async function sha512(path: string): Promise<string> {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('base64')
}

/** Exercise the updater's real acceptance rule against positive and negative controls. */
export async function qualifyWindowsUpdateSignature(
  options: WindowsUpdateSignatureQualificationOptions,
): Promise<WindowsUpdateSignatureQualificationReport> {
  if (options.platform !== 'win32') throw new Error('Authenticode qualification requires Windows')
  const publisherName = options.publisherName.trim()
  if (publisherName === '') throw new Error('CLAWCLAW_WINDOWS_PUBLISHER_NAME is required')
  const signedPath = await realpath(options.signedPath)
  const unsignedPath = await realpath(options.unsignedPath)
  if (signedPath === unsignedPath) throw new Error('Signed and unsigned controls must be distinct files')
  const config = parse(readFileSync(options.updateConfigPath, 'utf8')) as unknown
  const configured = config !== null && typeof config === 'object'
    ? normalizedPublisher((config as Record<string, unknown>).publisherName)
    : undefined
  if (configured === undefined || configured.length !== 1 || configured[0] !== publisherName) {
    throw new Error('Windows updater metadata publisherName does not match CLAWCLAW_WINDOWS_PUBLISHER_NAME')
  }
  const before = { signed: await sha512(signedPath), unsigned: await sha512(unsignedPath) }
  const cases = [
    { name: 'matching-publisher', path: signedPath, publishers: [publisherName], accepted: true },
    { name: 'wrong-publisher', path: signedPath, publishers: ['CN=Not the ClawClaw release publisher'], accepted: false },
    { name: 'unsigned-file', path: unsignedPath, publishers: [publisherName], accepted: false },
  ] as const
  for (const item of cases) {
    const verifier = await options.createVerifier(item.publishers)
    try {
      const result = await verifier.verifySignature(item.path)
      if ((result === null) !== item.accepted) {
        throw new Error(`${item.name}: unexpected Authenticode verification result`)
      }
    } finally {
      verifier.dispose?.()
    }
  }
  if (await sha512(signedPath) !== before.signed || await sha512(unsignedPath) !== before.unsigned) {
    throw new Error('Authenticode qualification modified an input artifact')
  }
  return Object.freeze({
    publisherName,
    signedSha512: before.signed,
    unsignedSha512: before.unsigned,
    cases: cases.map(item => item.name),
  })
}

async function runCli(): Promise<void> {
  const [signedPath, unsignedPath, updateConfigPath] = process.argv.slice(2)
  if (signedPath === undefined || unsignedPath === undefined || updateConfigPath === undefined) {
    throw new Error('Usage: qualify-windows-update-signature <signed.exe> <unsigned.exe> <app-update.yml>')
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'clawclaw-signature-qualification-'))
  try {
    const require = createRequire(import.meta.url)
    const NsisUpdater = (require('electron-updater') as { NsisUpdater: new (...args: unknown[]) => {
      autoInstallOnAppQuit: boolean
      updateConfigPath: string
      logger: unknown
      verifySignature(path: string): Promise<string | null>
      removeAllListeners(): void
    } }).NsisUpdater
    const report = await qualifyWindowsUpdateSignature({
      platform: process.platform,
      publisherName: process.env.CLAWCLAW_WINDOWS_PUBLISHER_NAME ?? '',
      signedPath,
      unsignedPath,
      updateConfigPath,
      createVerifier: async (publisherNames) => {
        const configPath = join(temporaryRoot, `${randomUUID()}.yml`)
        await writeFile(configPath, `${JSON.stringify({
          provider: 'generic',
          url: 'https://unused.invalid/',
          publisherName: publisherNames,
        }, null, 2)}\n`, { flag: 'wx' })
        const updater = new NsisUpdater(null, { version: '0.1.0', isPackaged: true })
        updater.autoInstallOnAppQuit = false
        updater.updateConfigPath = configPath
        updater.logger = { info() {}, warn() {}, error() {}, debug() {} }
        return {
          verifySignature: async path => await updater.verifySignature(path),
          dispose: () => { updater.removeAllListeners() },
        }
      },
    })
    console.log(`Windows Authenticode qualification passed for ${report.publisherName}`)
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  runCli().catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exitCode = 1
  })
}
