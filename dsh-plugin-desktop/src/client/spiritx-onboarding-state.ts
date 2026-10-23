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
    title: "Add an API key to get started",
    description: "Configure SpiritX to start using ClawClaw.",
    keyLabel: "API key",
    keyPlaceholder: "Enter your SpiritX API key",
    later: "Configure later",
    save: "Save and continue",
    saving: "Saving...",
    required: "Enter an API key to continue.",
  },
  zh: {
    title: "添加一个 API Key 开始使用",
    description: "配置 SpiritX，即可开始使用 ClawClaw。",
    keyLabel: "API 密钥",
    keyPlaceholder: "输入 SpiritX API 密钥",
    later: "稍后配置",
    save: "保存并继续",
    saving: "保存中...",
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
