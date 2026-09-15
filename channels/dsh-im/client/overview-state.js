export const CLAWCLAW_CHANNELS = Object.freeze([
  Object.freeze({
    id: "weixin",
    rpc: "weixinRpcCall",
    label: "个人微信",
    description: "通过微信扫码和 iLink 长轮询接入个人微信。",
    tone: "weixin",
  }),
  Object.freeze({
    id: "wecom",
    rpc: Object.freeze(["wecomRpcCall", "wecomAppRpcCall"]),
    label: "企业微信",
    description: "支持智能机器人和企业自建应用两种接入方式。",
    tone: "wecom",
  }),
  Object.freeze({
    id: "feishu",
    rpc: "feishuRpcCall",
    label: "飞书",
    description: "通过官方 WebSocket SDK 接收消息并流式回复。",
    tone: "feishu",
  }),
  Object.freeze({
    id: "dingtalk",
    rpc: "dingtalkRpcCall",
    label: "钉钉",
    description: "通过 Stream Mode 接收消息并使用 AI Card 回复。",
    tone: "dingtalk",
  }),
  Object.freeze({
    id: "qq",
    rpc: "qqRpcCall",
    label: "QQ",
    description: "支持手机 QQ 扫码或 AppID / AppSecret 手动接入。",
    tone: "qq",
  }),
  Object.freeze({
    id: "imessage",
    rpc: "imessageRpcCall",
    label: "iMessage",
    description: "连接 macOS Messages，仅在 macOS 上可用。",
    tone: "imessage",
  }),
  Object.freeze({
    id: "telegram",
    rpc: "telegramRpcCall",
    label: "Telegram",
    description: "通过 Bot API 长轮询接收和回复消息。",
    tone: "telegram",
  }),
  Object.freeze({
    id: "whatsapp",
    rpc: "whatsappRpcCall",
    label: "WhatsApp",
    description: "通过 WhatsApp Web 关联设备扫码接入。",
    tone: "whatsapp",
  }),
  Object.freeze({
    id: "discord",
    rpc: "discordRpcCall",
    label: "Discord",
    description: "通过 Gateway 长连接接入 Discord Bot。",
    tone: "discord",
  }),
  Object.freeze({
    id: "slack",
    rpc: "slackRpcCall",
    label: "Slack",
    description: "通过 Socket Mode 接入 Slack App。",
    tone: "slack",
  }),
  // Object.freeze({
  //   id: "office",
  //   rpc: "officeRpcCall",
  //   label: "AI Office",
  //   description: "连接公网 Office，接收任务并主动投递结果。",
  //   tone: "office",
  // }),
]);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

export function channelOverviewState(result) {
  const envelope = object(result);
  if (envelope?.ok === false)
    return Object.freeze({ state: "error", configured: 0, connected: 0 });
  const value = envelope?.ok === true ? envelope.value : result;
  const root = object(value);
  const snapshot = object(root?.snapshot) ?? root;
  if (
    snapshot !== undefined &&
    !Array.isArray(snapshot.bots) &&
    typeof snapshot.configured === "boolean"
  ) {
    const configured = snapshot.configured ? 1 : 0;
    const connected = snapshot.connected === true ? 1 : 0;
    const connecting =
      snapshot.state === "connecting" || snapshot.state === "reconnecting";
    return Object.freeze({
      state:
        connected > 0
          ? "connected"
          : connecting
            ? "connecting"
            : configured > 0
              ? "offline"
              : "unconfigured",
      configured,
      connected,
    });
  }
  if (snapshot === undefined || !Array.isArray(snapshot.bots)) {
    return Object.freeze({ state: "error", configured: 0, connected: 0 });
  }
  const configured = snapshot.bots.length;
  const connected = snapshot.bots.filter(
    (bot) => object(bot)?.connected === true,
  ).length;
  const connecting = snapshot.bots.some((bot) => {
    const state = object(bot)?.state;
    return (
      state === "connecting" ||
      state === "reconnecting" ||
      state === "provisioning"
    );
  });
  return Object.freeze({
    state:
      connected > 0
        ? "connected"
        : connecting
          ? "connecting"
          : configured > 0
            ? "offline"
            : "unconfigured",
    configured,
    connected,
  });
}

export function channelStatusLabel(status) {
  if (status === undefined) return "读取状态中";
  switch (status.state) {
    case "connected":
      return status.connected === status.configured
        ? `${status.connected} 个机器人已连接`
        : `${status.connected}/${status.configured} 个机器人已连接`;
    case "connecting":
      return "正在连接";
    case "offline":
      return `${status.configured} 个机器人未连接`;
    case "error":
      return "状态不可用";
    case "unavailable":
      return "当前发行版未内置";
    default:
      return "未配置";
  }
}

export function combineChannelOverviewStates(statuses) {
  const available = statuses.filter((status) => status.state !== "error");
  if (available.length === 0)
    return Object.freeze({ state: "error", configured: 0, connected: 0 });
  const configured = available.reduce(
    (count, status) => count + status.configured,
    0,
  );
  const connected = available.reduce(
    (count, status) => count + status.connected,
    0,
  );
  const connecting = available.some((status) => status.state === "connecting");
  return Object.freeze({
    state:
      connected > 0
        ? "connected"
        : connecting
          ? "connecting"
          : configured > 0
            ? "offline"
            : "unconfigured",
    configured,
    connected,
  });
}
