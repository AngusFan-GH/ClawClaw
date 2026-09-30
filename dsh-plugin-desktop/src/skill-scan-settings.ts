/** Persistent, explicit external Skill scan roots owned by ClawClaw. */

import { isAbsolute, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'

export const DESKTOP_SKILL_SCAN_SETTINGS_NAMESPACE = 'clawclaw-skill-scan'
export const MAX_SKILL_SCAN_PATHS = 32

export interface DesktopSkillScanSettings {
  readonly paths: readonly string[]
}

export const DesktopSkillScanSettingsSchema: z<DesktopSkillScanSettings> = z.object({
  paths: z.array(z.string().max(8_192)).max(MAX_SKILL_SCAN_PATHS).default([]),
}) as z<DesktopSkillScanSettings>

function pathKey(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved
}

export function validateDesktopSkillScanSettings(settings: DesktopSkillScanSettings): void {
  const seen = new Set<string>()
  for (const path of settings.paths) {
    if (path === '' || path.includes('\0') || !isAbsolute(path) || resolve(path) !== path) {
      throw new TypeError('Skill scan paths must be normalized absolute paths')
    }
    const key = pathKey(path)
    if (seen.has(key)) throw new TypeError(`Duplicate Skill scan path: ${path}`)
    seen.add(key)
  }
}
