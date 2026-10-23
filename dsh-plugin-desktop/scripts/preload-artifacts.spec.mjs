/** Built preload smoke using Electron's sandbox restriction on local require(). */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

for (const platform of ['darwin', 'win32']) {
  for (const entry of ['preload', 'compatibility-preload']) {
    test(`${entry} exposes its bridge in the ${platform} sandbox without local modules`, async () => {
      const exposed = new Map()
      const invocations = []
      const electron = {
        contextBridge: { exposeInMainWorld: (name, value) => { exposed.set(name, value) } },
        ipcRenderer: {
          invoke: async (...args) => { invocations.push(args) },
          on: () => {}, removeListener: () => {},
        },
        webUtils: { getPathForFile: () => '/selected/file' },
      }
      runInNewContext(readFileSync(new URL(`../lib/${entry}.cjs`, import.meta.url), 'utf8'), {
        process: { platform },
        require: name => {
          assert.equal(name, 'electron', `Sandboxed preload cannot require ${name}`)
          return electron
        },
      })
      if (entry === 'compatibility-preload') {
        const bridge = exposed.get('desktopChrome')
        assert.ok(bridge)
        await bridge.invoke('state')
        assert.deepEqual(invocations, [['dsh-desktop:compatibility-chrome', 'state']])
        assert.equal(typeof bridge.subscribe(() => {}), 'function')
        assert.equal(typeof bridge.onDismiss(() => {}), 'function')
      } else {
        assert.equal(exposed.get('dshDesktop')?.protocolVersion, 1)
        assert.equal(exposed.get('__DSH_DESKTOP_FILE_PATH__')?.getPathForFile({}), '/selected/file')
        await exposed.get('__DSH_LOCALE__').read()
        assert.deepEqual(invocations, [['dsh-desktop:locale-read']])
      }
    })
  }
}
