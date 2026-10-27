import { readFile, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const upstreamRoot = fileURLToPath(new URL('../node_modules/@xmanrui/dsh-im/', import.meta.url))

/**
 * Rebrand the pinned channel's own source copy before bundling, including both
 * sides of translation dictionaries and template/regex static text. Never run
 * this over rendered messages: interpolated names, inbound text, history and
 * streamed model output must retain their original contents.
 * Protocol identifiers such as deepseek-harness and package names stay intact.
 */
export function patchChannelBrandCopy(source) {
  return source.replaceAll('DeepSeek Harness', 'ClawClaw')
}

export const channelBrandCopyPatch = {
  name: 'clawclaw-channel-brand-copy',
  setup(build) {
    const upstreamRootPath = realpath(upstreamRoot)
    build.onLoad({ filter: /\.(?:[cm]?js|json)$/ }, async ({ path }) => {
      // Resolve the pnpm symlink so this cannot rewrite another dependency or
      // any desktop/user module that happens to mention the upstream product.
      const root = await upstreamRootPath
      const relative = path.slice(root.length).replaceAll('\\', '/')
      if (path.startsWith(root) && relative === '/package.json') {
        const manifest = JSON.parse(await readFile(path, 'utf8'))
        manifest.description = patchChannelBrandCopy(manifest.description)
        return { contents: JSON.stringify(manifest), loader: 'json' }
      }
      if (!path.startsWith(root) || !/^\/(?:src\/channels\/|plugin-src\/client\/)/u.test(relative)) return
      const source = await readFile(path, 'utf8')
      if (!source.includes('DeepSeek Harness')) return
      return { contents: patchChannelBrandCopy(source), loader: 'js' }
    })
  },
}
