declare module 'clawclaw:plugin-manager-client' {
  type ClientRequire = (id: string) => unknown

  interface PluginManagerClientExports {
    apply(ctx: import('@deepseek-ai/cordis').Context): void
  }

  const factory: (require: ClientRequire) => PluginManagerClientExports
  export default factory
}
