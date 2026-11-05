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
export const SPIRITX_PLATFORM_URL = "https://ai.xzinfra.com/";

export const SPIRITX_ONBOARDING_COPY = {
  en: {
    title: "Connect your model",
    description:
      "Add your SpiritX API key. ClawClaw will fetch the available models and select a language model for your first conversation.",
    getKeyTitle: "Get a SpiritX API key",
    registerStep: "Open the SpiritX platform and register or sign in.",
    findKeyStep:
      "Select Model Plaza (模型广场) in the top navigation, then API-Key Management (API-Key管理) in the sidebar.",
    createKeyStep:
      "Under My API-Key (我的 API-Key), click Create (创建). Once created, click the copy icon next to the API key.",
    connectKeyStep:
      "Return to ClawClaw, paste the API key below, and click Connect and start chatting.",
    getKey: "Get an API key on SpiritX",
    browserHelp:
      "Opens in your browser. Keep this window open to finish setup.",
    keyHelp:
      "Paste your SpiritX API key in the field above, then click Connect and start chatting.",
    laterHelp:
      "To explore the app first, click Configure later. Connect a model in Settings > Models when you are ready to chat.",
    loading: "Checking model configuration…",
    unavailable:
      "Model configuration could not be loaded. Retry, or configure it later in Settings > Models.",
    retry: "Retry",
    saveFailed:
      "Could not finish model setup. Check your connection and try again.",
    keyLabel: "API key",
    keyPlaceholder: "Enter your SpiritX API key",
    later: "Configure later",
    save: "Connect and start chatting",
    saving: "Connecting…",
    required: "Enter an API key to continue.",
  },
  zh: {
    title: "连接模型",
    description:
      "使用神石平台 API Key 连接模型。ClawClaw 会获取可用模型，并为第一次对话选择一个大语言模型。",
    getKeyTitle: "获取神石 API Key",
    registerStep: "前往神石平台，注册账号或登录已有账号。",
    findKeyStep: "点击顶部“模型广场”，再点击左侧“API-Key管理”。",
    createKeyStep:
      "在“我的 API-Key”中点击“创建”，创建完成后点击密钥旁的复制图标。",
    connectKeyStep:
      "返回 ClawClaw，将 API Key 粘贴到下方，点击“连接并开始对话”。",
    getKey: "前往神石平台获取 API Key",
    browserHelp: "将在浏览器中打开，获取后请回到此窗口。",
    keyHelp: "将神石平台的 API Key 粘贴到上方输入框，点击“连接并开始对话”。",
    laterHelp:
      "想先体验应用？点击“稍后配置”，之后在“设置” > “模型”中完成配置，即可开始对话。",
    loading: "正在检查模型配置…",
    unavailable:
      "暂时无法读取模型配置。请重试，或稍后在“设置” > “模型”中配置。",
    retry: "重试",
    saveFailed: "未能完成模型配置，请检查网络连接后重试。",
    keyLabel: "API Key（API 密钥）",
    keyPlaceholder: "粘贴神石平台的 API Key",
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
    return credential?.writable === true
      ? { kind: "missing", writable: true }
      : { kind: "unavailable" };
  }
  if (credential?.configured === true) return { kind: "configured" };
  if (credential === undefined || !credential.writable)
    return { kind: "unavailable" };
  return { kind: "missing", writable: credential.writable };
}
