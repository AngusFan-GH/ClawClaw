import assert from 'node:assert/strict'
import test from 'node:test'
import { channelDirectoryPicker } from '../client/directory-picker.js'

test('channel native fallback uses the Desktop picker and keeps browsing intact', async () => {
  const calls = []
  const listing = { entries: [{ name: '.clawclaw', hidden: true }] }
  const original = {
    listDirectory: async () => listing,
    pickDirectory: async () => { calls.push('upstream'); return '/upstream' },
  }
  let desktop = async () => { calls.push('desktop'); return '/Users/test/.clawclaw' }
  const picker = channelDirectoryPicker(original, () => desktop)
  assert.equal(picker.listDirectory, original.listDirectory)
  assert.equal(await picker.listDirectory(), listing)
  assert.equal(await picker.pickDirectory(), '/Users/test/.clawclaw')
  desktop = async () => null
  assert.equal(await picker.pickDirectory(), null)
  desktop = undefined
  assert.equal(await picker.pickDirectory(), '/upstream')
  assert.deepEqual(calls, ['desktop', 'upstream'])
})

test('Desktop picker failure propagates without opening a second native dialog', async () => {
  const picker = channelDirectoryPicker({ pickDirectory: () => assert.fail('unexpected fallback') },
    () => async () => { throw new Error('picker unavailable') })
  await assert.rejects(picker.pickDirectory(), /picker unavailable/)
})

test('forwards hidden-folder preferences to the native Desktop bridge', async () => {
  const calls = []
  const picker = channelDirectoryPicker({}, () => async (options) => { calls.push(options); return null })
  await picker.pickDirectory({ showHiddenFiles: true })
  await picker.pickDirectory({ showHiddenFiles: false })
  assert.deepEqual(calls, [{ showHiddenFiles: true }, { showHiddenFiles: false }])
})
