/** Keep upstream compatibility admission on the same package graph as Desktop imports. */
import type { Context } from '@deepseek-ai/cordis'
import { PluginPackages, type PluginPackage } from '@deepseek-ai/dsh-app-boot'
import { readFileSync } from 'node:fs'
import { desktopProfilePackageCandidate } from './module-resolution.ts'

export class DesktopPluginPackages extends PluginPackages {
  constructor(ctx: Context, private readonly profileBaseUrl: string) { super(ctx) }

  override packageOf(specifier: string, _parentURL: string): PluginPackage | undefined {
    const candidate = desktopProfilePackageCandidate(specifier, this.profileBaseUrl)
    if (candidate === undefined) return undefined
    const manifest = JSON.parse(readFileSync(candidate.manifestPath, 'utf8')) as Record<string, unknown>
    return {
      name: candidate.packageName, version: candidate.version, dir: candidate.packageDir,
      manifestPath: candidate.manifestPath, manifest,
    }
  }
}
