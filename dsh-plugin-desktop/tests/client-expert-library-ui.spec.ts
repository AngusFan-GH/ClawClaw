import { describe, expect, it } from 'vitest'
import { CUSTOM_EDITOR_CSS } from '../src/experts/client/custom-editor.ts'
import { customEn, customZh } from '../src/experts/client/custom-locales.ts'
import { CAPABILITY_PICKER_CSS, CARD_SETTINGS_CSS, canToggleExpert, connectorStateLabel, expertSource, isDeletableExpert } from '../src/experts/client/index.ts'
import { TEAM_CSS } from '../src/experts/client/team-style.ts'

describe('expert library UI', () => {
  it('keeps the library navigation fixed while each tab owns its scroll position', () => {
    expect(TEAM_CSS).toContain('.aag-section.aag-library-shell{max-width:1120px;height:100%;max-height:100%;gap:0')
    expect(TEAM_CSS).toContain('.aag-library-sticky{z-index:20;display:flex;flex:none')
    expect(TEAM_CSS).toContain('.aag-library-navigation{')
    expect(TEAM_CSS).toContain('.aag-tab-label{')
    expect(TEAM_CSS).toContain('.aag-library-tabs{display:flex')
    expect(TEAM_CSS).toContain('grid-template-columns:repeat(4,minmax(0,1fr))')
    expect(TEAM_CSS).toContain('.aag-library-tab[aria-selected=true]')
    expect(TEAM_CSS).toContain('@container(max-width:560px)')
    expect(TEAM_CSS).toMatch(/\.aag-library-panel\{[^}]*overflow-y:auto/)
    expect(TEAM_CSS).toMatch(/\.aag-library-panel\{[^}]*padding:0 12px 32px/)
    expect(TEAM_CSS).toMatch(/\.aag-library-panel \.aag-card-filters\{[^}]*position:sticky;top:0;z-index:12/)
    expect(TEAM_CSS).toMatch(/\.aag-library-panel \.aag-card-filters\{[^}]*width:calc\(100% \+ 24px\);margin:0 -12px -8px;padding:8px 12px/)
    expect(TEAM_CSS).toMatch(/\.aag-library-panel \.aag-card-filters\{[^}]*background:var\(--dsw-alias-bg-layer-1\)/)
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
    expect(CARD_SETTINGS_CSS).toContain('.aag-team-summon.is-active')
  })

  it('treats bundled packages as built-in experts', () => {
    expect(expertSource({ custom: false })).toBe('base')
    expect(expertSource({ custom: false, conversationCreated: true })).toBe('custom')
    expect(expertSource({ custom: true })).toBe('custom')
    expect(expertSource({ custom: false })).toBe('base')
    expect(isDeletableExpert({ custom: false })).toBe(false)
    expect(isDeletableExpert({ custom: false, conversationCreated: true })).toBe(true)
    expect(CARD_SETTINGS_CSS).toContain('.aag-expert-details{')
    expect(CARD_SETTINGS_CSS).toContain('.aag-card-filters .aag-field-search{flex:1 1 320px;min-width:min(280px,100%)}')
    expect(CARD_SETTINGS_CSS).toContain('@container(max-width:760px){.aag-card-filters .aag-field-search{flex:1 0 100%;width:100%}}')
  })

  it('blocks enabling when a required capability is missing but still permits disabling', () => {
    const blocked = { state: 'blocked', ready: 0, total: 1, issues: [{ type: 'mcp', name: 'docs', required: true, state: 'missing' }] } as const
    expect(canToggleExpert(false, blocked)).toBe(false)
    expect(canToggleExpert(true, blocked)).toBe(true)
  })

  it('keeps the conversation connector picker compact and responsive', () => {
    expect(connectorStateLabel('running', 'zh')).toBe('已连接')
    expect(connectorStateLabel('error', 'en')).toBe('Connection failed')
    expect(connectorStateLabel('vendor-state', 'zh')).toBe('vendor-state')
    expect(CAPABILITY_PICKER_CSS).toContain('grid-template-columns:30px minmax(0,1fr) minmax(64px,112px)')
    expect(CAPABILITY_PICKER_CSS).toContain('.aag-connector-readiness{grid-column:3')
    expect(CAPABILITY_PICKER_CSS).not.toContain('.aag-connector-toggle')
    expect(CAPABILITY_PICKER_CSS).toContain('grid-template-columns:repeat(4,minmax(0,1fr))')
    expect(CAPABILITY_PICKER_CSS).toContain('.aag-capability-summary span:last-child{display:none}')
  })

  it('keeps the team editor controls legible and responsive', () => {
    expect(TEAM_CSS).toContain('.agt-coordinator-toolbar{display:flex')
    expect(TEAM_CSS).toContain('.agt-segment .ant-btn.agt-segment-active{')
    expect(TEAM_CSS).toMatch(/\.agt-segment \.ant-btn\.agt-segment-active\{[^}]*color:var\(--dsw-alias-label-primary\)/)
    expect(TEAM_CSS).toContain('.agt-prompt-meta{display:flex')
    expect(TEAM_CSS).toContain('.agt-example-list{display:grid')
    expect(TEAM_CSS).toContain('.aag-team-details-drawer .ant-drawer-body{')
    expect(TEAM_CSS).toContain('.agt-detail-overview{display:grid')
    expect(TEAM_CSS).toContain('.agt-detail-roster article{display:grid')
    expect(TEAM_CSS).toContain('.agt-coordinator-toolbar{align-items:stretch;flex-direction:column}')
  })
})
