import { readFile } from 'node:fs/promises'

/** Keep archived channel sessions closed when the next inbound message arrives. */
export function patchChannelSessionArchive(source) {
  const before = 'if (!session || !(await sessionExists(session, existsOptions))) {'
  if (source.split(before).length !== 2) {
    throw new Error('Pinned channel session binding changed; review archive handling')
  }
  return source.replace(before,
    'if (!session || !(await sessionExists(session, existsOptions)) || await channelSessionArchived(harness, sessionId, existsOptions)) {') + `

async function channelSessionArchived(harness, sessionId, options) {
  const value = await harness.rpc('workspace.list', {}, 30_000, options);
  if (!Array.isArray(value?.archivedSessionIds)
    || value.archivedSessionIds.some(id => typeof id !== 'string')) {
    throw new Error('Invalid workspace archive state for channel session binding');
  }
  return value.archivedSessionIds.includes(sessionId);
}
`
}

export const channelSessionArchivePatch = {
  name: 'clawclaw-channel-session-archive',
  setup(build) {
    build.onLoad({ filter: /[/\\]src[/\\]channels[/\\]shared[/\\]workspace-session\.mjs$/ }, async ({ path }) => ({
      contents: patchChannelSessionArchive(await readFile(path, 'utf8')),
      loader: 'js',
    }))
  },
}
