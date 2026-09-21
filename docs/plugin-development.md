# ClawClaw 插件开发

[English](plugin-development.en.md)

普通 DSH 插件应优先依赖上游公开 contract，因此能在 CLI、普通 Web profile 和 ClawClaw 中运行。只有确实需要桌面能力时才依赖 ClawClaw contract。Fabric 的 RFC 是设计讨论，当前不能作为 package、schema 或 loader 依赖。

## 生命周期

ClawClaw 每次启动 profile 或切换窗口模式都会创建新的 Host generation。Host service、Client service、进程 handle 和 profile 路径只对当前 generation 有效；在 Cordis effect 清理函数中取消子进程、取消订阅并丢弃引用。不要从 argv、URL、`DSH_HOME` 或 settings 猜测当前 profile。

## Desktop Host services

从 `dsh-plugin-desktop/*` 导入 Desktop 类型。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from 'dsh-plugin-desktop/profile-service'
import type { DesktopPnpmHandle } from 'dsh-plugin-desktop/pnpm'

export const inject = ['desktopProfiles', 'desktopPnpm']

export function apply(ctx: Context) {
  const profile = ctx.desktopProfiles.current
  let operation: DesktopPnpmHandle | undefined

  async function add(packageName: string) {
    operation = ctx.desktopPnpm.run(['add', '--save-exact', packageName])
    operation.stdout.resume()
    operation.stderr.resume()
    const result = await operation.done
    if (result.exitCode !== 0 || result.signal !== null) throw new Error('pnpm operation failed')
  }

  ctx.effect(() => () => {
    operation?.cancel()
  }, `example plugin for ${profile.name}`)
}
```

`desktopProfiles.current` 给出不可变的当前 profile 名称和绝对目录。`list()` 只读发现；`create()`、`prepareSelection()`、`select()`、`canDelete()`、`delete()` 经 launcher 边界操作。`select()` 会有序重启。详细签名见 [Desktop contract](../dsh-plugin-desktop/docs/plugin-services.zh.md)。

`desktopPnpm` 的方法如下：

| 方法 | 用途 |
| --- | --- |
| `run(argv, signal?)` | 在 active profile 目录运行打包 pnpm。调用方负责 npm 目标、bundle reconcile、进度与验证。 |
| `runPlugin(argv, invokingDir, signal?)` | 通过打包 `dsh plugin --profile <active>` 执行普通插件管理语义。 |
| `runExternalMarketPluginInstall(...)` | 仅为兼容 bundled `dshmarket` 的受限精确版本 `add` adapter。 |

接口不存在 `installPlugin()`、安装 receipt、自动重试、快照或回滚。每个 generation 最多一个 package operation；读取 stdout/stderr、设置超时、检查 `exitCode` 和 `signal`，并在 dispose 时 `cancel()` 后等待 `done`。参数必须是 argv，不能拼接 shell 字符串。

## 同时支持普通 DSH

不要在顶层 required `inject` 中声明 Desktop service。先判断 service 是否存在，再在嵌套 injection 中挂载 Desktop adapter：

```ts
export const inject = ['webServer']

export function apply(ctx: Context) {
  if (ctx.get('desktopProfiles') === undefined) {
    mountOrdinaryDsh(ctx)
    return
  }
  ctx.inject(['desktopProfiles', 'desktopPnpm'], desktop => {
    desktop.effect(() => mountDesktopAdapter(desktop), 'desktop adapter')
  })
}
```

普通 DSH fallback 仍由插件自身负责。Renderer 无法直接使用 Host service；浏览器 UI 用 route/RPC/client service/slot。

## Client service

浏览器插件可 type-only 导入 `dsh-plugin-desktop/client` 并注入 `desktopWindow`。它只提供当前 generation 的窗口模式、平台、有效材质与几何事实，不能控制 Electron。兼容和扩展模式的内容 WebContentsView 已在独立 Chrome 下方，`safeAreaInsets.top` 和 `dragRegion.height` 都是 `0`；插件不能再次添加标题栏间距。增强模式才报告其集成 caption 几何。

## 不公开的实现

`desktopRuntime`、`desktopPnpmBootstrap`、Electron APIs、Host RPC、BrowserWindow、tray、打包 Node shim、内部 resolver 和安装器属于私有实现。它们即使出现在运行时或声明中，也不保证兼容性。

开发完成后，在普通 DSH 与 ClawClaw Desktop 中分别测试。
