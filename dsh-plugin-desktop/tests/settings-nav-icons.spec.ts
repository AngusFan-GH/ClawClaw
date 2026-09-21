// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { installSemanticSettingsNavIcons } from '../src/client/settings-nav-icons.ts'

describe('semantic settings navigation icons', () => {
  afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = '' })

  it('decorates known settings rows and follows rows mounted after installation', async () => {
    const dispose = installSemanticSettingsNavIcons([
      { icon: 'skill', labels: ['技能', 'Skills'] },
      { icon: 'mcp', labels: ['MCP 服务', 'MCP Servers'] },
      { icon: 'schedule', labels: ['定时任务'] },
    ])
    document.body.innerHTML = '<div role="dialog"><nav><button><svg></svg><span>技能</span></button><button><svg></svg><span>MCP 服务</span></button><button><svg></svg><span>定时任务</span></button><button><svg></svg><span>Other</span></button></nav></div>'
    await new Promise(resolve => setTimeout(resolve, 0))
    const buttons = [...document.querySelectorAll('button')]
    expect(buttons.map(button => button.getAttribute('data-dsh-settings-icon')))
      .toEqual(['skill', 'mcp', 'schedule', null])
    expect(document.getElementById('dsh-desktop-settings-nav-icons')).not.toBeNull()
    dispose()
    expect(document.getElementById('dsh-desktop-settings-nav-icons')).toBeNull()
  })
})
