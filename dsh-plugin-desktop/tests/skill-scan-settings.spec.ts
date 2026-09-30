import { describe, expect, it } from 'vitest'
import {
  DesktopSkillScanSettingsSchema,
  validateDesktopSkillScanSettings,
} from '../src/skill-scan-settings.ts'

describe('Skill scan settings', () => {
  it('defaults to no external roots and accepts normalized absolute paths', () => {
    expect(DesktopSkillScanSettingsSchema({} as never)).toEqual({ paths: [] })
    expect(() => validateDesktopSkillScanSettings({ paths: ['/opt/team-skills'] })).not.toThrow()
  })

  it('rejects relative, unnormalized, duplicate and oversized lists', () => {
    expect(() => validateDesktopSkillScanSettings({ paths: ['relative'] })).toThrow('normalized absolute')
    expect(() => validateDesktopSkillScanSettings({ paths: ['/opt/../tmp'] })).toThrow('normalized absolute')
    expect(() => validateDesktopSkillScanSettings({ paths: ['/tmp/skills', '/tmp/skills'] })).toThrow('Duplicate')
    expect(() => DesktopSkillScanSettingsSchema({ paths: Array.from({ length: 33 }, (_, index) => `/tmp/${String(index)}`) })).toThrow()
  })
})
