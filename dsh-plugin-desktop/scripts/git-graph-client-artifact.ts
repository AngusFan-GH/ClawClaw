/** Strict adapter for the pinned 0.4.8 published browser artifact. */
export function gitGraphClientFactorySource(artifact: string): string {
  const telemetry = /\t\t\/\/#region src\/client\/telemetry\.ts\n[\s\S]*?\t\t\/\/#endregion\n/g
  const call = '\t\t\treportDailyHeartbeat([{ name: "@linxin666/dsh-client-ui-git-graph" }]);'
  if ([...artifact.matchAll(telemetry)].length !== 1 || artifact.split(call).length !== 2) {
    throw new Error('Pinned Git graph telemetry anchors changed; review the new artifact before building')
  }
  let clean = artifact.replace(telemetry, '').replace(call, '')
  // A failed Session create must unregister the new workspace before deleting
  // its checkout. Once a Session exists, a navigation failure must retain it
  // and its files. Keep this correction scoped to the pinned browser method.
  const creation = /createWorktreeSession: async \(sessionId, name, baseRef\) => \{[\s\S]*?(?=\n\s*removeWorktree: async)/g
  if ([...clean.matchAll(creation)].length !== 1) throw new Error('Pinned Git worktree creation anchor changed')
  clean = clean.replace(creation, block => {
    const start = /try \{\s*const workspace = await scope\.workspaces\.create\(\{ path: created\.value\.path \}\);\s*const createdSessionId = await scope\.sessions\.create\(\{ workspaceId: workspace\.workspaceId \}\);/
    const rollback = 'await git.removeWorktree(resolved.path, created.value.path, { force: true });'
    if (!start.test(block) || block.split(rollback).length !== 2) throw new Error('Pinned Git worktree rollback anchors changed')
    return block.replace(start, `let registeredWorkspaceId; let createdSessionId;
      try {
        const workspace = await scope.workspaces.create({ path: created.value.path });
        registeredWorkspaceId = workspace.workspaceId;
        createdSessionId = await scope.sessions.create({ workspaceId: workspace.workspaceId });`)
      .replace(rollback, `if (createdSessionId !== undefined) return { ok: false, error: { code: "internal", message: "Session created but navigation failed; Session and worktree retained: " + String(error) } };
        if (registeredWorkspaceId !== undefined) {
          try { await scope.workspaces.delete(registeredWorkspaceId); }
          catch (cleanupError) { return { ok: false, error: { code: "internal", message: "Workspace cleanup failed; worktree retained: " + String(cleanupError) } }; }
        }
        const cleanup = await git.removeWorktree(resolved.path, created.value.path, { force: true });
        if (!cleanup.ok) return cleanup;`)
  })
  if (/reportDailyHeartbeat|dsh-market\.com|telemetry-visitor/.test(clean)) {
    throw new Error('Git graph browser artifact still contains install telemetry')
  }
  const match = clean.match(/^window\.__ModuleLoader__\.load\(\{\s*id:\s*"@linxin666\/dsh-client-ui-git-graph",\s*factory:\s*((?:\(require\)|require)\s*=>\s*\{[\s\S]*\})\s*\}\);\s*(?:\/\/# sourceMappingURL=.*)?\s*$/)
  if (!match?.[1]) throw new Error('Unexpected pinned Git graph browser wrapper')
  return `export default ${match[1]};`
}
