import { describe, expect, it } from 'vitest'
import * as settings from '../src/client/desktop-settings-locales.ts'
import * as cron from '../src/client/cron-tasks-locales.ts'
import * as reminders from '../src/client/reminders-locales.ts'
import * as skills from '../src/client/skills-locales.ts'
import * as mcp from '../src/client/mcp-locales.ts'
import * as presets from '../src/client/legacy-agent-presets-locales.ts'
import { desktopLocaleFromLanguages } from '../src/tray-locale.ts'

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()

describe('Desktop localization coverage', () => {
  it.each([
    ['Windows Chinese UI with English Chromium', ['zh-CN', 'en-US'], 'en-US', 'zh'],
    ['macOS ordered languages', ['fr-FR', 'zh-Hans-CN', 'en-US'], 'en-US', 'zh'],
    ['English preference first', ['en-GB', 'zh-CN'], 'zh-CN', 'en'],
    ['Chinese regional fallback', ['zh-Hant-TW'], 'en-US', 'zh'],
    ['Windows language without country', ['zh'], 'en-US', 'zh'],
    ['Underscore language tag', ['zh_CN'], 'en-US', 'zh'],
    ['Unsupported languages', ['de-DE'], 'en-US', 'en'],
    ['Empty preference list', [], 'zh-CN', 'zh'],
  ] as const)('%s', (_name, languages, fallback, expected) => {
    expect(desktopLocaleFromLanguages(languages, fallback)).toBe(expected)
  })

  it.each(Object.entries({ settings, cron, reminders, skills, mcp, presets }))('%s has matching keys and interpolation parameters', (_name, dictionaries) => {
    const en: Record<string, string> = dictionaries.en
    const zh: Record<string, string> = dictionaries.zh
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    for (const key of Object.keys(en)) {
      expect(en[key]?.trim(), key).not.toBe('')
      expect(zh[key]?.trim(), key).not.toBe('')
      expect(placeholders(en[key]!), key).toEqual(placeholders(zh[key]!))
    }
  })
})
