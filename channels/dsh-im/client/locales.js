/** Desktop-owned channel copy and exact translations for upstream detail gaps. */
const copy = {
  '使用系统选择器': 'Use system folder picker',
  '消息渠道': 'Message channels',
  '返回': 'Back',
  '企业微信接入方式': 'WeCom connection method',
  '智能机器人': 'AI bot',
  '自建应用': 'Custom app',
  '连接外部聊天平台，管理消息入口和投递能力。': 'Connect chat platforms and manage incoming messages and delivery.',
  '已配置渠道': 'Configured channels',
  '管理已经保存的渠道连接。': 'Manage saved channel connections.',
  '还没有已配置的渠道。': 'No channels configured yet.',
  '支持的渠道': 'Supported channels',
  '选择一个平台开始连接。': 'Choose a platform to connect.',
  '个人微信': 'Personal WeChat',
  '飞书服务请求失败': 'Feishu request failed',
  '飞书连接遇到问题': 'Feishu connection encountered a problem',
  '机器人': 'Bot',
  'Telegram Bot API 长轮询运行正常': 'Telegram Bot API long polling is healthy',
  'Discord Gateway 长连接运行正常': 'Discord Gateway connection is healthy',
  'Slack Socket Mode 长连接运行正常': 'Slack Socket Mode connection is healthy',
  '通过微信扫码和 iLink 长轮询接入个人微信。': 'Connect personal WeChat using a QR code and iLink long polling.',
  '支持智能机器人和企业自建应用两种接入方式。': 'Connect an AI bot or a custom WeCom app.',
  '通过官方 WebSocket SDK 接收消息并流式回复。': 'Receive messages and stream replies using the official WebSocket SDK.',
  '通过 Stream Mode 接收消息并使用 AI Card 回复。': 'Receive messages in Stream Mode and reply with AI Cards.',
  '支持手机 QQ 扫码或 AppID / AppSecret 手动接入。': 'Connect using a mobile QQ QR code or an AppID and AppSecret.',
  '连接 macOS Messages，仅在 macOS 上可用。': 'Connect macOS Messages. Available on macOS only.',
  '通过 Bot API 长轮询接收和回复消息。': 'Receive and reply to messages using Bot API long polling.',
  '通过 WhatsApp Web 关联设备扫码接入。': 'Connect by scanning a WhatsApp Web linked-device QR code.',
  '通过 Gateway 长连接接入 Discord Bot。': 'Connect a Discord bot using the Gateway.',
  '通过 Socket Mode 接入 Slack App。': 'Connect a Slack app using Socket Mode.',
  '连接公网 Office，接收任务并主动投递结果。': 'Connect Office to receive tasks and deliver results.',
}

// These messages are emitted by the pinned detail components and their RPC
// adapters. Exact entries avoid mixed-language results from phrase fallbacks.
for (const [source, name] of Object.entries({
  '微信': 'WeChat', '企业微信': 'WeCom', '钉钉': 'DingTalk', '飞书': 'Feishu', QQ: 'QQ', WhatsApp: 'WhatsApp', 'AI Office': 'AI Office', Telegram: 'Telegram', Discord: 'Discord', Slack: 'Slack',
})) {
  Object.assign(copy, {
    [`${source} 服务返回了无法识别的响应`]: `${name} returned an unrecognized response`,
    [`${source}服务返回了无法识别的响应`]: `${name} returned an unrecognized response`,
    [`${source} 操作失败`]: `${name} operation failed`,
    [`${source}操作失败`]: `${name} operation failed`,
    [`${source} 操作失败，请稍后重试`]: `${name} operation failed. Try again later.`,
    [`${source}操作失败，请稍后重试`]: `${name} operation failed. Try again later.`,
    [`${source} 连接尚未就绪`]: `${name} connection is not ready`,
    [`${source}连接尚未就绪`]: `${name} connection is not ready`,
    [`${source} 没有接入完成`]: `${name} is not connected`,
    [`${source}没有绑定完成`]: `${name} is not connected`,
    [`${source} 机器人没有接入完成`]: `${name} bot is not connected`,
    [`${source}机器人没有接入完成`]: `${name} bot is not connected`,
    [`${source} 机器人没有绑定完成`]: `${name} bot is not connected`,
    [`${source}机器人没有绑定完成`]: `${name} bot is not connected`,
    [`正在读取 ${source} 机器人状态…`]: `Loading ${name} bot status…`,
    [`正在读取${source}机器人状态…`]: `Loading ${name} bot status…`,
    [`尚未接入 ${source} 机器人`]: `No ${name} bot connected yet`,
    [`尚未接入${source}机器人`]: `No ${name} bot connected yet`,
    [`${source} 设置页缺少 RPC 连接`]: `${name} settings are missing an RPC connection`,
    [`${source}设置页缺少 RPC 连接`]: `${name} settings are missing an RPC connection`,
    [`${source} 设置`]: `${name} settings`,
    [`${source}仍未连接，插件会继续自动重试。`]: `${name} is still offline. Automatic retries will continue.`,
    [`${source}连接检查完成。`]: `${name} connection check completed.`,
    [`无法读取 ${source} 机器人状态`]: `Could not load ${name} bot status`,
    [`无法读取${source}机器人状态`]: `Could not load ${name} bot status`,
  })
}

export const en = Object.freeze(copy)
export const zh = Object.freeze(Object.fromEntries(Object.keys(copy).map(key => [key, key])))

/** Translate nested diagnostic causes before the pinned phrase fallback runs. */
export function channelTranslator(translate, localize) {
  return (key, params) => {
    const exact = translate(key, params)
    if (exact !== key || translate('$locale') !== 'en') return exact
    for (const [prefix, english] of [
      ['状态刷新失败：', 'Status refresh failed: '],
      ['状态自动刷新失败：', 'Automatic status refresh failed: '],
      ['操作失败：', 'Operation failed: '],
      ['连接检查失败：', 'Connection check failed: '],
      ['移除失败：', 'Removal failed: '],
    ]) {
      if (!key.startsWith(prefix)) continue
      const cause = key.slice(prefix.length)
      const reference = /^(.*)（参考号：(.+)）$/.exec(cause)
      return english + (reference
        ? `${localize(reference[1])} (reference: ${reference[2]})` : localize(cause))
    }
    return exact
  }
}
