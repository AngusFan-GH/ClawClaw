declare module 'clawclaw:plugin-manager-client' {
  type ClientRequire = (id: string) => unknown

  interface PluginManagerClientExports {
    apply(ctx: import('@deepseek-ai/cordis').Context): void
  }

  const factory: (require: ClientRequire) => PluginManagerClientExports
  export default factory
}

declare module 'clawclaw:git-graph-client' {
  const factory: (require: (id: string) => unknown) => {
    apply(ctx: import('@deepseek-ai/cordis').Context): void
  }
  export default factory
}
