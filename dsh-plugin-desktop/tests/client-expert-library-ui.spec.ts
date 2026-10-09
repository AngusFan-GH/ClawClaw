import { describe, expect, it } from 'vitest'
import { CUSTOM_EDITOR_CSS } from '../src/experts/client/custom-editor.ts'
import { customEn, customZh } from '../src/experts/client/custom-locales.ts'
import { CARD_SETTINGS_CSS } from '../src/experts/client/index.ts'
import { TEAM_CSS } from '../src/experts/client/team-style.ts'

describe('expert library UI', () => {
  it('keeps the library navigation fixed while each tab owns its scroll position', () => {
    expect(TEAM_CSS).toContain('.aag-library-shell{max-width:1120px;height:100%;max-height:100%')
    expect(TEAM_CSS).toContain('.aag-library-sticky{z-index:20;display:flex;flex:none')
    expect(TEAM_CSS).toContain('.aag-library-navigation{')
    expect(TEAM_CSS).toContain('.aag-tab-label{')
    expect(TEAM_CSS).toContain('grid-template-columns:repeat(4,minmax(0,1fr))')
    expect(TEAM_CSS).toContain('.aag-library-tab[aria-selected=true]')
    expect(TEAM_CSS).toContain('@container(max-width:430px)')
    expect(TEAM_CSS).toMatch(/\.aag-library-panel\{[^}]*overflow-y:auto/)
    expect(TEAM_CSS).toMatch(/\.aag-library-panel\{[^}]*padding:8px 2px 32px 0/)
    expect(TEAM_CSS).toContain('.aag-library-panel[hidden]{display:none}')
    expect(TEAM_CSS).not.toContain('.aag-tab-count')
  })

  it('explains the saved custom filter and offers a way back to the full roster', () => {
    expect(customZh['custom.saved']).toContain('当前仅显示自定义专家')
    expect(customZh['custom.showAllExperts']).toBe('查看全部专家')
    expect(customEn['custom.saved']).toContain('Only custom experts are currently shown')
    expect(customEn['custom.showAllExperts']).toBe('View all experts')
    expect(CUSTOM_EDITOR_CSS).toContain('.aag-custom-notice>span')
  })

  it('keeps built-in and custom expert cards the same size', () => {
    expect(CARD_SETTINGS_CSS).toContain('.aag-expert-window .aag-expert-card{height:164px')
    expect(CARD_SETTINGS_CSS).toContain('.aag-card-category{min-width:0;overflow:hidden;text-overflow:ellipsis}')
    expect(CARD_SETTINGS_CSS).toContain('.aag-card-division .aag-custom-badge{box-sizing:border-box;height:18px;flex:none;margin-left:0')
    expect(CARD_SETTINGS_CSS).toContain('.aag-expert-card-custom .aag-card-division{max-height:38px;flex-wrap:wrap')
    expect(CARD_SETTINGS_CSS).toContain('column-gap:4px;row-gap:2px')
    expect(CARD_SETTINGS_CSS).toContain('.aag-expert-card-custom .aag-card-category{flex:none')
    expect(CARD_SETTINGS_CSS).toContain('.aag-expert-card-custom .aag-card-description{min-height:19px;-webkit-line-clamp:1}')
  })

  it('keeps the team editor controls legible and responsive', () => {
    expect(TEAM_CSS).toContain('.agt-coordinator-toolbar{display:flex')
    expect(TEAM_CSS).toContain('.agt-segment .ant-btn.agt-segment-active{')
    expect(TEAM_CSS).toMatch(/\.agt-segment \.ant-btn\.agt-segment-active\{[^}]*color:var\(--dsw-alias-label-primary\)/)
    expect(TEAM_CSS).toContain('.agt-prompt-meta{display:flex')
    expect(TEAM_CSS).toContain('.agt-example-list{display:grid')
    expect(TEAM_CSS).toContain('.agt-coordinator-toolbar{align-items:stretch;flex-direction:column}')
  })
})
