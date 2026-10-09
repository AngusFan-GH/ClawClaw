# ClawClaw 数据处理说明

[English](PRIVACY.md)

- **版本：** 2.0
- **最近更新：** 2026-10-09

ClawClaw 是本地优先的开源桌面应用。本说明覆盖此仓库源码与其构建产物已知的本地存储和网络行为；它不是对未部署服务、第三方构建、插件或平台的隐私承诺。项目由 [AngusFan-GH/ClawClaw](https://github.com/AngusFan-GH/ClawClaw) 独立维护，不代表 DeepSeek、Anywhere Labs、SpiritX、npm、GitHub 或消息平台。

## 本地数据

默认 Harness 数据目录为 `~/.clawclaw/data`，默认工作区为 `~/.clawclaw/workspaces/default`。数据可能包括 profile、设置、会话、日志、缓存、插件依赖和用户在工作区保存的文件。Electron 应用数据目录保存窗口、日志、更新状态和诊断状态。应用中保存的数据目录、启动时的 `CLAWCLAW_HOME` 和安全模式可改变路径；ClawClaw 会把最终选择的数据目录作为 `DSH_HOME` 传给 Host、终端和插件。

更新资格记录默认关闭。用户在桌面设置中明确开启后，ClawClaw 才会保存限额本地快照，其中只包含应用与目标版本、类型化更新阶段和结果、耗时，以及根据发布者提供的制品摘要派生的 digest；不包含完整 URL、错误原文、设备身份或用户内容。最多保留 4 个 64 KiB 文件且合计不超过 256 KiB，可在同一设置区立即清除识别到的记录。

ClawClaw 不读取、移动或修改其他应用的 `~/.dsh` 数据，也不会自动合并该目录。健康启动的恢复检查点只覆盖部分 profile 声明和共享设置/patch，不包括凭据、`.env`、会话、storage、缓存或工作区文件。

## 网络连接

网络请求取决于用户选择、profile 和插件配置。当前默认 Desktop composition 的已知外部端点包括：

| 触发 | 接收方与可能发送的数据 |
| --- | --- |
| SpiritX 模型请求 | `https://ai.xzinfra.com/spiritx-api/v1`；模型请求、认证信息及协议所需元数据。`SPIRITX_API_KEY` 由用户配置。 |
| 更新检查 | `https://clawclaw.xzinfra.com/updates/dsh/stable/release.json`；HTTP 请求的 IP、时间、User-Agent 与普通网络元数据。客户端不添加旧 DSH Desktop 的安装 UUID 或 `X-DSH-Desktop-*` 统计 header。 |
| 确认下载 | release manifest 中的 HTTPS artifact URL；IP、时间、下载路径和普通网络元数据。客户端校验 SHA-512 与容器格式。 |
| dshmarket / pnpm | 用户选择的目录来源、npm registry、GitHub 或 package/图片来源；搜索词、包名、版本、目录浏览信息与普通网络元数据可能发送。 |
| Channels | 对应微信、企业微信、飞书、钉钉、QQ、iMessage、Telegram、WhatsApp、Discord、Slack 服务；凭据、授权/扫码数据、消息内容、附件引用及其协议元数据由平台和配置决定。 |
| 其他插件和工具 | 插件或用户配置的模型、MCP、网页、registry 和 API；范围以其实现与服务政策为准。 |

默认 Desktop patch 禁用上游 session telemetry、DeepSeek session log、DeepSeek 模型 API extensions、DeepSeek web search 与官方 package inventory。用户 profile 或插件可以重新启用其他网络功能；检查当前 profile 配置，而不是只依赖此默认说明。

## 本地 Web 与局域网

Web carrier 默认仅监听本机回环地址。打开系统浏览器仍访问本机服务。用户主动启用局域网访问后，服务可绑定网络接口；网络可达性不是用户鉴权，局域网客户端可能通过会话和工具请求操作本机资源。仅在可信网络使用。局域网流量不必经过项目更新服务，但会到达连接者。

## 诊断与分享

诊断 ZIP 仅在用户主动导出时创建，可能包含应用日志、Crashpad dump、运行标记、结构化 fatal report、系统信息，以及启用后产生的更新资格记录。日志会尝试屏蔽已识别凭据，但仍可能包含路径、会话文本、工具输出、插件消息或内存片段。导出不会自动上传；分享前自行检查并通过可信渠道发送。

## 选择与责任

用户可以关闭市场、移除插件、停用局域网、切换模型或删除本地数据。应用无法替用户撤回已发送给模型、市场、消息平台或其他插件的数据；请分别阅读其政策。删除应用不一定删除 `~/.clawclaw`、工作区或应用数据目录，先备份需要保留的文件。

本项目没有提供账号体系或集中式用户数据库。若需报告安全或隐私问题，请在 [ClawClaw Issues](https://github.com/AngusFan-GH/ClawClaw/issues) 使用不含凭据和私密日志的内容；必要时在仓库维护者公开的安全渠道联系。
