/** Exercise the built Host contribution through a disposable real Profile. */
import assert from 'node:assert/strict'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

export async function verifyGenui(ctx) {
  const render = 'clawclaw_render_ui'
  const validate = 'clawclaw_validate_ui'
  assert.equal(ctx.tools.get(render), undefined, 'GenUI must default off')
  const contributed = async () => (await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'clawclaw:genui')
  assert.equal(await contributed(), false)
  try {
    await ctx.settings.update('desktop-genui', { enabled: true })
    assert.ok(ctx.tools.get(render), 'real Profile settings must enable the render tool')
    assert.ok(ctx.tools.get(validate))
    assert.equal(await contributed(), true)
    const document = { format: 'clawclaw.genui/v1', title: 'Offline profile check', items: [
      { type: 'table', columns: ['Service', 'Count'], rows: [['API', 2], ['Worker', 0]] },
      { type: 'chart', kind: 'bar', title: 'Request counts', categories: ['API', 'Worker'],
        series: [{ name: 'Count', values: [2, 0] }] },
    ] }
    const result = await ctx.tools.execute({ callId: ToolCallId('genui-profile-smoke'), name: render,
      arguments: { document }, signal: new AbortController().signal })
    assert.equal(result.isError, false)
    assert.deepEqual(result.meta, document)
    assert.match(result.content[0].text, /Worker \| 0/)
  } finally {
    await ctx.settings.update('desktop-genui', { enabled: false })
  }
  assert.equal(ctx.tools.get(render), undefined)
  assert.equal(ctx.tools.get(validate), undefined)
  assert.equal(await contributed(), false)
  console.log('verify-genui: built Profile settings, tool output metadata, text fallback and disable cleanup passed')
}
