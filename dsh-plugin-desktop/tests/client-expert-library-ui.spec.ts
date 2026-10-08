import { describe, expect, it } from 'vitest'
import { CUSTOM_EDITOR_CSS } from '../src/experts/client/custom-editor.ts'
import { customEn, customZh } from '../src/experts/client/custom-locales.ts'
import { TEAM_CSS } from '../src/experts/client/team-style.ts'

describe('expert library UI', () => {
  it('keeps the library navigation visible without creating a nested vertical scroller', () => {
    expect(TEAM_CSS).toContain('.aag-library-sticky{position:sticky;top:0')
    expect(TEAM_CSS).toContain('.aag-library-navigation{')
    expect(TEAM_CSS).toContain('.aag-tab-label{')
    expect(TEAM_CSS).toContain('.ant-segmented-item-selected')
    expect(TEAM_CSS).toContain('overflow-x:auto')
    expect(TEAM_CSS).not.toMatch(/\.aag-library-content\{[^}]*overflow-y:/)
  })

  it('explains the saved custom filter and offers a way back to the full roster', () => {
    expect(customZh['custom.saved']).toContain('当前仅显示自定义专家')
    expect(customZh['custom.showAllExperts']).toBe('查看全部专家')
    expect(customEn['custom.saved']).toContain('Only custom experts are currently shown')
    expect(customEn['custom.showAllExperts']).toBe('View all experts')
    expect(CUSTOM_EDITOR_CSS).toContain('.aag-custom-notice>span')
  })
})
