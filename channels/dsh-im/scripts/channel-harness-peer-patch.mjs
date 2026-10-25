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

/**
 * The pinned IM package imports its development-only proxy agent from its host
 * channel source.  With pnpm's isolated linker that lookup can otherwise walk
 * to an incompatible root copy, so resolve it to this adapter's pinned v5.
 */
export const channelHttpsProxyAgentPatch = {
  name: 'clawclaw-channel-https-proxy-agent',
  setup(build) {
    build.onResolve({ filter: /^https-proxy-agent$/ }, ({ importer }) => {
      if (!/[/\\]plugin-src[/\\]host[/\\]channels[/\\]feishu[/\\]production\.mjs$/.test(importer)) return
      return { path: fileURLToPath(new URL('../node_modules/https-proxy-agent/dist/index.js', import.meta.url)) }
    })
  },
}
