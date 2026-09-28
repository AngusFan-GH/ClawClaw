import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { qualifyWindowsUpdateSignature } from '../scripts/qualify-windows-update-signature.ts'

const roots: string[] = []

async function fixture(publisherName: unknown = ['CN=ClawClaw Release']): Promise<{
  signed: string
  unsigned: string
  config: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'clawclaw-authenticode-'))
  roots.push(root)
  await mkdir(root, { recursive: true })
  const signed = join(root, 'signed.exe')
  const unsigned = join(root, 'unsigned.exe')
  const config = join(root, 'app-update.yml')
  await writeFile(signed, 'signed-control')
  await writeFile(unsigned, 'unsigned-control')
  await writeFile(config, JSON.stringify({ publisherName }))
  return { signed, unsigned, config }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async root => await rm(root, { recursive: true, force: true })))
})

describe('Windows Authenticode release qualification', () => {
  it('requires matching metadata and exercises matching, wrong, and unsigned controls', async () => {
    const f = await fixture()
    const verifySignature = vi.fn(async (path: string, publishers: readonly string[]) =>
      basename(path) === 'signed.exe' && publishers[0] === 'CN=ClawClaw Release'
        ? null
        : 'signature rejected')
    const report = await qualifyWindowsUpdateSignature({
      platform: 'win32',
      publisherName: 'CN=ClawClaw Release',
      signedPath: f.signed,
      unsignedPath: f.unsigned,
      updateConfigPath: f.config,
      createVerifier: async publishers => ({
        verifySignature: async path => await verifySignature(path, publishers ?? []),
      }),
    })

    expect(report.cases).toEqual(['matching-publisher', 'wrong-publisher', 'unsigned-file'])
    expect(report.signedSha512).toMatch(/^[A-Za-z0-9+/]{86}==$/u)
    expect(verifySignature).toHaveBeenCalledTimes(3)
  })

  it('rejects missing or mismatched updater publisher metadata', async () => {
    const f = await fixture(null)
    await expect(qualifyWindowsUpdateSignature({
      platform: 'win32', publisherName: 'CN=ClawClaw Release',
      signedPath: f.signed, unsignedPath: f.unsigned, updateConfigPath: f.config,
      createVerifier: async () => ({ verifySignature: async () => null }),
    })).rejects.toThrow('publisherName does not match')
  })

  it('refuses to pretend Authenticode qualification ran off Windows', async () => {
    const f = await fixture()
    await expect(qualifyWindowsUpdateSignature({
      platform: 'darwin', publisherName: 'CN=ClawClaw Release',
      signedPath: f.signed, unsignedPath: f.unsigned, updateConfigPath: f.config,
      createVerifier: async () => ({ verifySignature: async () => null }),
    })).rejects.toThrow('requires Windows')
  })
})
