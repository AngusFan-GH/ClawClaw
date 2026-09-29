import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DesktopDialogToneIcon,
} from '../src/native-ui/desktop-dialog/App.tsx'

describe('Desktop dialog native UI', () => {
  it('renders a leading tone icon', () => {
    expect(renderToStaticMarkup(createElement(DesktopDialogToneIcon, {
      type: 'warning',
    }))).toContain('<svg')
  })

  it('uses the shared ScrollArea for long default dialog details', () => {
    const source = readFileSync(new URL('../src/native-ui/desktop-dialog/App.tsx', import.meta.url), 'utf8')
    expect(source).toContain('<ScrollArea className="mt-2 h-28 pr-3">')
    expect(source).not.toContain('max-h-28 overflow-auto')
  })

})
