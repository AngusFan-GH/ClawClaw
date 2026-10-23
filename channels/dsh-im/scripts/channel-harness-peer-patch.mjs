import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** Adapt the pinned IM compatibility adapter without editing installed or upstream files. */
export function patchChannelHarnessPeer(source) {
  const before = 'const gateway = ctx?.typertGateway;'
  if (source.split(before).length !== 2) throw new Error('Pinned IM Gateway lookup changed; review the rc.2 Peer adapter')
  const modulePath = fileURLToPath(new URL('../src/harness-peer.mjs', import.meta.url))
  return `import { channelGateway } from ${JSON.stringify(modulePath)};\n` + source.replace(before, 'const gateway = channelGateway(ctx);')
}
export const channelHarnessPeerPatch = {
  name: 'clawclaw-channel-harness-peer',
  setup(build) {
    build.onLoad({ filter: /[/\\]plugin-src[/\\]host[/\\](?:modern-harness-api|harness-command-executor)\.mjs$/ }, async ({ path }) => ({
      contents: patchChannelHarnessPeer(await readFile(path, 'utf8')),
      loader: 'js',
    }))
  },
}
