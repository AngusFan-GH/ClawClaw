import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DESKTOP_THEME_CSS } from '../src/client/desktop-theme.ts'

const require = createRequire(import.meta.url)

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sources(path) : /\.(ts|tsx|js)$/.test(path) ? [path] : []
  })
}

describe('desktop appearance contract', () => {
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
