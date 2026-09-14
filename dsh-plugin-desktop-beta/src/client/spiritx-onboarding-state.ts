/** First-run state derived from the SpiritX credential description. */
export type SpiritXCredentialState =
  | { kind: "missing"; writable: boolean }
  | { kind: "configured" }
  | { kind: "unavailable" };

/** Slot cells shadowed so SpiritX replaces, rather than follows, upstream onboarding. */
export const SPIRITX_ONBOARDING_SHADOW = {
  welcome: { id: "welcome-notice", order: -100, priority: -10 },
  credential: { id: "deepseek-official", order: 0, priority: -10 },
} as const;

/** Product copy kept outside React so the replacement contract is testable headlessly. */
export const SPIRITX_ONBOARDING_COPY = {
  en: {
    welcomeTitle: "Welcome to SpiritX",
    welcomeBody:
      "SpiritX is the default AI model service for ClawClaw. Before you begin, configure the API key issued by your company.\n\nAfter setup, you can use the default model or choose another available SpiritX model from Models.",
    welcomeContinue: "Continue",
    welcomeError: "The acknowledgement could not be saved. Please try again.",
    title: "Add an API key to get started",
    description: "Configure SpiritX to start using ClawClaw.",
    keyLabel: "API key",
    keyPlaceholder: "Enter your SpiritX API key",
    later: "Configure later",
    save: "Save and continue",
    saving: "Saving...",
    required: "Enter an API key to continue.",
    unavailable:
      "SpiritX configuration is unavailable. Configure the key later from Models.",
  },
  zh: {
    welcomeTitle: "欢迎使用 SpiritX",
    welcomeBody:
      "SpiritX 是 ClawClaw 默认使用的 AI 模型服务。\n\n开始使用前，请配置公司分配的 API 密钥。\n\n配置完成后，你可以使用默认模型，也可以在“模型”页面选择其他 SpiritX 模型。",
    welcomeContinue: "继续",
    welcomeError: "暂时无法保存确认状态，请重试。",
    title: "添加一个 API Key 开始使用",
    description: "配置 SpiritX，即可开始使用 ClawClaw。",
    keyLabel: "API 密钥",
    keyPlaceholder: "输入 SpiritX API 密钥",
    later: "稍后配置",
    save: "保存并继续",
    saving: "保存中...",
    required: "请输入 API 密钥后继续。",
    unavailable: "SpiritX 配置暂不可用，请稍后在“模型”页面配置密钥。",
  },
} as const;

export function spiritXCredentialState(
  credential: { configured: boolean; writable: boolean } | undefined,
): SpiritXCredentialState {
  if (credential?.configured === true) return { kind: "configured" };
  if (credential === undefined) return { kind: "unavailable" };
  return { kind: "missing", writable: credential.writable };
}
