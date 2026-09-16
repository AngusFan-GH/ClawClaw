import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { channelSessionArchivePatch, patchChannelSessionArchive } from '../scripts/channel-session-archive-patch.mjs'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../node_modules/@xmanrui/dsh-im/src/channels/shared/workspace-session.mjs', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [channelSessionArchivePatch],
})
const { askInWorkspaceSession } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

function fixture({ archived = [], exists = true, failure, malformed = false } = {}) {
  let bound = 'old'
  let created = 0
  const asked = []
  const state = {
    sessionFor: () => bound,
    setSession: async (_key, id) => { bound = id },
  }
  const harness = {
    rpc: async (method) => {
      assert.equal(method, 'workspace.list')
      if (failure) throw failure
      return malformed ? {} : { archivedSessionIds: archived }
    },
    createSession: async () => { created++; return 'new' },
    workspaceSession: (id) => ({
      sessionExists: async () => id === 'new' || exists,
      ask: async (text) => { asked.push({ id, text }); return 'reply' },
    }),
  }
  return {
    send: (text = 'hello') => askInWorkspaceSession({ harness, state, key: 'chat', text }),
    asked,
    bound: () => bound,
    created: () => created,
  }
}

test('archived binding creates a visible new session and preserves the old archive', async () => {
  const archived = ['old']
  const f = fixture({ archived })
  const result = await f.send()
  assert.equal(result.sessionId, 'new')
  assert.equal(f.bound(), 'new')
  assert.deepEqual(f.asked, [{ id: 'new', text: 'hello' }])
  assert.deepEqual(archived, ['old'])
})

test('concurrent inbound messages create only one replacement session', async () => {
  const f = fixture({ archived: ['old'] })
  await Promise.all([f.send('first'), f.send('second')])
  assert.equal(f.created(), 1)
  assert.equal(f.asked.length, 2)
  assert.ok(f.asked.every(({ id }) => id === 'new'))
})

test('active binding remains unchanged', async () => {
  const f = fixture()
  assert.equal((await f.send()).sessionId, 'old')
  assert.equal(f.created(), 0)
})

test('missing session still gets replaced', async () => {
  const f = fixture({ exists: false })
  assert.equal((await f.send()).sessionId, 'new')
  assert.equal(f.created(), 1)
})

test('failed or malformed archive reads never send to the old session or replace binding', async () => {
  for (const options of [{ failure: new Error('offline') }, { malformed: true }]) {
    const f = fixture(options)
    await assert.rejects(f.send())
    assert.equal(f.created(), 0)
    assert.equal(f.bound(), 'old')
    assert.deepEqual(f.asked, [])
  }
})

test('upstream binding drift fails the build explicitly', () => {
  assert.throws(() => patchChannelSessionArchive('changed'), /review archive handling/)
})
