# 渠道官方图标梳理与替换报告

日期：2026-10-23

## 原因与结果

QQ 原来使用上游提供的单色企鹅轮廓（`fill: currentColor`），Desktop 侧栏容器设置了三级文字灰色，因此图标呈灰色。这属于显示问题，与渠道连接状态无关。除微信已有颜色覆盖外，多个其他单色渠道图标也会继承相同的灰色。

按要求，当前开放的 10 个渠道全部改用各厂商官方站点实际发布的原始图片；没有自行绘制、描摹、裁剪、修改路径或重新配色。QQ 使用官网的彩色企鹅。资源以原始字节内置到客户端，不在运行时请求厂商 CDN。

## 官方资源清单

下表为实际下载入口；完整文件地址、MIME、字节数及 SHA-256 记录在 [sources.json](../../channels/dsh-im/client/assets/channel-icons/sources.json)。官网关联 CDN 的来源通过页面中的 favicon、品牌下载预览图或产品图标链接确认。微信官网 favicon 的 URL 虽以 `.ico` 结尾，其实际字节为 PNG，因此按 PNG 保存，文件内容没有变化。

| 渠道 | 官方页面 | 内置文件 |
| --- | --- | --- |
| QQ | [https://im.qq.com/index](https://im.qq.com/index) | `qq.png` |
| 个人微信 | [https://weixin.qq.com/](https://weixin.qq.com/) | `weixin.png` |
| 企业微信（机器人、自建应用） | [https://work.weixin.qq.com/](https://work.weixin.qq.com/) | `wecom.png` |
| 飞书 | [https://www.feishu.cn/](https://www.feishu.cn/) | `feishu.png` |
| 钉钉 | [https://www.dingtalk.com/](https://www.dingtalk.com/) | `dingtalk.png` |
| iMessage / Apple 信息 | [https://support.apple.com/guide/messages/welcome/mac](https://support.apple.com/guide/messages/welcome/mac) | `imessage.png` |
| Telegram | [https://telegram.org/tour/screenshots](https://telegram.org/tour/screenshots) | `telegram.svg` |
| WhatsApp | [https://www.whatsapp.com/](https://www.whatsapp.com/) | `whatsapp.svg` |
| Discord | [https://discord.com/branding](https://discord.com/branding) | `discord.svg` |
| Slack | [https://slack.com/media-kit](https://slack.com/media-kit) | `slack.png` |

## 覆盖范围和适配

- 侧栏会话前导图标：16 × 16，同一官方资源。
- 搜索结果、会话页头、悬停标题：16 × 16，同一官方资源，保持比例。
- 渠道设置总览和已配置渠道：44 × 44 中性白色容器，图像 32 × 32，保持比例。移除原先自行着色的品牌底块。
- 企业微信两种接入方式共用企业微信官方图标。
- QQ 在深色主题使用中性白色底座，保持原图颜色和企鹅轮廓可见；其他资源保持官方文件自身配色。
- 根据最新要求，侧栏只显示图标与会话名称，不显示渠道文字前缀。空闲时使用原生前导位图标；运行或等待处理时由标题内图标接续，原生状态点继续保留，避免来源标识消失或出现双图标。连接状态继续由状态点及文字呈现。
- AI Office 当前隐藏于渠道目录，保留原有历史会话兼容图标；它不属于本次 10 个开放渠道的官方资源替换范围，也未新增开放入口。

## 实现与数据影响

统一注册表为 `channels/dsh-im/client/channel-icons.js`。构建脚本读取来源清单并校验 SHA-256，将原始文件直接编码为内置 data URL。测试逐项比较解码前后的原始字节，防止生成数据遗漏或过期。

非 React 标题适配器原本仅生成 SVG 命名空间节点，本次增加 HTML `img` 节点支持，避免搜索和页头图片生成于错误命名空间。旧 SVG 兼容逻辑仍保留。图像不接收 `currentColor`，也不添加灰度滤镜或透明度覆盖。

仅改动 Desktop 自有渠道呈现层与构建资源；未修改上游 submodule、渠道鉴权配置、消息处理、任务、会话或运行记录。

## 验证结果

- `corepack pnpm --filter @clawclaw/dsh-im check`：构建、语法检查、32 项测试通过；包括 10 个渠道的官方原始字节与 SHA-256 一致性校验。
- 渠道会话呈现 Vitest：5 项通过；包含 10 个渠道在搜索、页头、悬停区域共 30 个真实图片节点，验证 HTML 命名空间、尺寸、内置地址、标题与清理还原。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过。
- `git diff --check`：通过。
- 真实桌面目视：侧栏 QQ 彩色企鹅、飞书、微信可见；渠道总览上下半页的全部 10 个渠道原图均已核对，可正常显示。未发送外部渠道消息，未改变渠道连接设置。
- 本次未重新运行完整 Profile 集成门禁，也未切换用户的主题偏好；深色主题 QQ 底座通过代码审查核对，未声称完成真实深色窗口目视验收。

## 版权和维护

官方图标及商标归相应权利人所有，不将其作为本仓库 MIT 授权的原创素材。来源清单与第三方声明一同保留。未来更新资源应重新核对官方页面、保留原始文件，并更新哈希；常规构建不会联网下载或悄然替换图标。
