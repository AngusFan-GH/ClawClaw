/** Bilingual copy for the one-time ClawClaw welcome screen. */
import type { DesktopLocale } from './runtime.ts'

export interface DesktopSetupWizardCopy {
  readonly title: string
  readonly welcomeTitle: string
  readonly welcomeBody: string
  readonly modelTitle: string
  readonly modelBody: string
  readonly defaultsTitle: string
  readonly defaultsBody: string
  readonly continue: string
  readonly starting: string
  readonly startingBody: string
  readonly invalidState: string
}

const COPY: Record<DesktopLocale, DesktopSetupWizardCopy> = {
  en: {
    title: 'Welcome to ClawClaw',
    welcomeTitle: 'Welcome to ClawClaw',
    welcomeBody: 'Get ready for your first conversation. You only need to connect a model to start chatting.',
    modelTitle: 'Connect your model next',
    modelBody: 'If SpiritX is not configured yet, you can add an API key on the next screen or configure a model later in Settings > Models.',
    defaultsTitle: 'Start with the defaults',
    defaultsBody: 'Window appearance, notifications and the plugin market can be changed later in Settings > Desktop settings.',
    continue: 'Continue',
    starting: 'Opening ClawClaw…',
    startingBody: 'Preparing your workspace. Model setup will follow if needed.',
    invalidState: 'Welcome information could not be loaded. Close this window and reopen ClawClaw to try again.',
  },
  zh: {
    title: '欢迎使用 ClawClaw',
    welcomeTitle: '欢迎使用 ClawClaw',
    welcomeBody: '准备开始第一次对话。连接模型后，就可以开始聊天了。',
    modelTitle: '接下来连接模型',
    modelBody: '如果尚未配置 SpiritX，下一步可以添加 API 密钥，也可以稍后在“设置” > “模型”中配置。',
    defaultsTitle: '先使用默认设置',
    defaultsBody: '窗口外观、桌面通知和插件市场，都可以之后在“设置” > “桌面设置”中调整。',
    continue: '继续',
    starting: '正在打开 ClawClaw…',
    startingBody: '正在准备工作区，如有需要，接下来将引导你配置模型。',
    invalidState: '无法加载欢迎信息。请关闭此窗口，重新打开 ClawClaw 后重试。',
  },
}

export function desktopSetupWizardCopy(locale: DesktopLocale): DesktopSetupWizardCopy {
  return COPY[locale]
}
