import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DESKTOP_ACTION_COLORS, DESKTOP_THEME_CSS } from '../src/client/desktop-theme.ts'

const require = createRequire(import.meta.url)

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sources(path) : /\.(ts|tsx|js)$/.test(path) ? [path] : []
  })
}

describe('desktop appearance contract', () => {
  it('keeps white primary-button text readable in normal, hover and pressed states', () => {
    for (const color of Object.values(DESKTOP_ACTION_COLORS)) {
      const channels = [1, 3, 5].map(offset => {
        const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      const luminance = channels.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0)
      expect(1.05 / (luminance + 0.05), color).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('uses color variables supported by the pinned host across every owned client page', () => {
    const host = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-theme/client'), 'utf8')
    const supported = new Set(host.match(/--dsw-[\w-]+/g))
    const directories = ['../src/client/', '../src/experts/client/', '../../channels/dsh-im/client/']
    const unsupported: string[] = []
    for (const directory of directories) {
      for (const path of sources(fileURLToPath(new URL(directory, import.meta.url)))) {
        for (const token of new Set(readFileSync(path, 'utf8').match(/--dsw-[\w-]+/g))) {
          if (!supported.has(token)) unsupported.push(`${path}: ${token}`)
        }
      }
    }
    // Unknown tokens silently fell back to white cards and dark text in dark mode.
    expect(unsupported).toEqual([])
  })

  it('keeps monochrome host branding out of desktop action and focus colors', () => {
    const files = sources(fileURLToPath(new URL('../src/client/', import.meta.url)))
      .concat(sources(fileURLToPath(new URL('../src/experts/client/', import.meta.url))))
    // The shared bridge deliberately maps the published controls' host tokens.
    const monochromeActions = files.filter(path => !path.endsWith('desktop-theme.ts')
      && /--dsw-alias-(?:brand-primary|button-primary-(?:fill|hover)|label-primary-foreground)/.test(readFileSync(path, 'utf8')))
    expect(monochromeActions).toEqual([])
  })

  it('covers the published Button, Switch and Checkbox color contracts', () => {
    const primitiveRoot = new URL('.', pathToFileURL(require.resolve('@deepseek-ai/dsh-client-ui-primitives')))
    const controls = ['Button', 'Switch', 'Checkbox']
    for (const control of controls) {
      const css = readFileSync(new URL(`${control}.module.css`, primitiveRoot), 'utf8')
      const actionTokens = [...new Set(css.match(/--dsw-alias-(?:brand-primary|button-primary-(?:fill|hover)|label-primary-foreground)/g))]
      expect(actionTokens.length).toBeGreaterThan(0)
      for (const token of actionTokens) {
        expect(DESKTOP_THEME_CSS, `${control}: ${token}`).toMatch(new RegExp(`${token}:var\\(--dsh-color-`))
      }
    }
    // Applying mappings only at :root would lose to the host's body theme.
    expect(DESKTOP_THEME_CSS).toContain(':where(button,')
    expect(DESKTOP_THEME_CSS).toContain('[role="switch"]')
    expect(DESKTOP_THEME_CSS).toContain('input[type="checkbox"]')
  })
})
