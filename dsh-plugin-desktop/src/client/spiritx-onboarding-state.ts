/** First-run state derived from the SpiritX credential description. */
export type SpiritXCredentialState =
  | { kind: "missing"; writable: boolean }
  | { kind: "configured" }
  | { kind: "unavailable" };

/** Skip the upstream preview notice and replace its credential step. */
export const SPIRITX_ONBOARDING_SHADOW = {
  welcome: { id: "welcome-notice", order: -100, priority: -10 },
  credential: { id: "deepseek-official", order: 0, priority: -10 },
} as const;

/** Product copy kept outside React so the replacement contract is testable headlessly. */
export const SPIRITX_ONBOARDING_COPY = {
  en: {
    title: "Connect your model",
    description: "Add your SpiritX API key. ClawClaw will fetch the available models and select a language model for your first conversation.",
    laterHelp: "You can explore ClawClaw now and configure a model later in Settings > Models. A configured model is required to chat.",
    loading: "Checking model configuration…",
    unavailable: "Model configuration could not be loaded. Retry, or configure it later in Settings > Models.",
    retry: "Retry",
    saveFailed: "Could not finish model setup. Check your connection and try again.",
    keyLabel: "API key",
    keyPlaceholder: "Enter your SpiritX API key",
    later: "Configure later",
    save: "Connect and start chatting",
    saving: "Connecting…",
    required: "Enter an API key to continue.",
  },
  zh: {
    title: "连接模型",
    description: "添加 SpiritX API 密钥后，ClawClaw 会获取可用模型，并为第一次对话选择一个大语言模型。",
    laterHelp: "可以先进入 ClawClaw，稍后在“设置” > “模型”中配置。开始对话前需要连接可用模型。",
    loading: "正在检查模型配置…",
    unavailable: "暂时无法读取模型配置。请重试，或稍后在“设置” > “模型”中配置。",
    retry: "重试",
    saveFailed: "未能完成模型配置，请检查网络连接后重试。",
    keyLabel: "API 密钥",
    keyPlaceholder: "输入 SpiritX API 密钥",
    later: "稍后配置",
    save: "连接并开始对话",
    saving: "正在连接…",
    required: "请输入 API 密钥后继续。",
  },
} as const;

export function spiritXCredentialState(
  credential: { configured: boolean; writable: boolean } | undefined,
  profileConfigured = true,
): SpiritXCredentialState {
  if (!profileConfigured) {
    return credential?.writable === true ? { kind: "missing", writable: true } : { kind: "unavailable" };
  }
  if (credential?.configured === true) return { kind: "configured" };
  if (credential === undefined || !credential.writable) return { kind: "unavailable" };
  return { kind: "missing", writable: credential.writable };
}
