import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { channelDirectoryPickerPatch } from './channel-directory-picker-patch.mjs'
import { larkSdkHandshakePatch } from '../node_modules/@xmanrui/dsh-im/plugin-src/host/lark-sdk-handshake-patch.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lib = resolve(root, 'lib')
await mkdir(lib, { recursive: true })

await build({
  entryPoints: [resolve(root, 'src/index.mjs')],
  outfile: resolve(lib, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  mainFields: ['module', 'main'],
  external: [
    '@tencent-connect/qqbot-connector',
    '@tencent-connect/qqbot-connector/*',
    '@tencent-connect/qqbot-nodejs',
    '@tencent-connect/qqbot-nodejs/*',
    '@whiskeysockets/baileys',
    '@whiskeysockets/baileys/*',
    '@wecom/aibot-node-sdk',
    '@wecom/aibot-node-sdk/*',
    'dingtalk-stream',
    'dingtalk-stream/*',
    'qrcode',
    'qrcode/*',
    'undici',
    'undici/*',
  ],
  plugins: [larkSdkHandshakePatch],
  banner: {
    js: [
      "import { createRequire as __clawCreateRequire } from 'node:module';",
      "import { dirname as __clawDirname } from 'node:path';",
      "import { fileURLToPath as __clawFileURLToPath } from 'node:url';",
      'const require = __clawCreateRequire(import.meta.url);',
      'const __filename = __clawFileURLToPath(import.meta.url);',
      'const __dirname = __clawDirname(__filename);',
    ].join('\n'),
  },
  legalComments: 'eof',
})

const client = await build({
  entryPoints: [resolve(root, 'client/index.js')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome100'],
  external: ['react', 'react-dom'],
  plugins: [channelDirectoryPickerPatch],
  write: false,
  legalComments: 'none',
})
const bundled = client.outputFiles?.[0]?.text
if (!bundled) throw new Error('ClawClaw IM client bundle was not generated')
const output = `window.__ModuleLoader__.load({\n  id: '@clawclaw/dsh-im',\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n${bundled}\n    return module.exports;\n  }\n});\n`
await import('node:fs/promises').then(({ writeFile }) => writeFile(resolve(lib, 'client.js'), output, 'utf8'))
