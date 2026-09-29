/** Dependency-collection policy shared by Electron Builder entry points. */

/**
 * Keep Electron Builder on bounded physical traversal. Its pnpm collector
 * delegates to `npm list --all`, which otherwise expands the outer workspace
 * instead of the selected app's runtime graph.
 */
export function electronBuilderEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '1',
  }
}
