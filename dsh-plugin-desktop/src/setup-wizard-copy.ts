/** Bilingual copy for the pre-Host native Setup Wizard. */

import type { DesktopLocale } from './runtime.ts'

export interface DesktopSetupWizardCopy {
  readonly title: string
  readonly profile: string
  readonly welcomeTitle: string
  readonly welcomeBody: string
  readonly firstProfileSetup: string
  readonly startSetup: string
  readonly windowMaterial: string
  readonly windowMaterialBody: string
  readonly materialOff: string
  readonly materialOffBody: string
  readonly materialTransparent: string
  readonly materialTransparentBody: string
  readonly materialMica: string
  readonly materialMicaBody: string
  readonly unavailableOnLinux: string
  readonly marketTitle: string
  readonly marketBody: string
  readonly marketDisabled: string
  readonly marketDisabledBody: string
  readonly dshMarket: string
  readonly dshMarketBody: string
  readonly notificationsTitle: string
  readonly notificationsBody: string
  readonly notificationsEnabled: string
  readonly turnCompletion: string
  readonly turnFailure: string
  readonly jobCompletion: string
  readonly jobFailure: string
  readonly back: string
  readonly next: string
  readonly skip: string
  readonly skipDialogTitle: string
  readonly skipDialogBody: string
  readonly cancelSkip: string
  readonly confirmSkip: string
  readonly successTitle: string
  readonly successBody: string
  readonly startUsing: string
  readonly invalidState: string
}

const COPY: Record<DesktopLocale, DesktopSetupWizardCopy> = {
  en: {

    title: 'Set up ClawClaw',
    profile: 'Profile',
    welcomeTitle: 'Welcome to ClawClaw',
    welcomeBody: 'Set up window appearance and notifications for the current Profile.',
    firstProfileSetup: 'Complete Desktop setup before using this configuration environment (Profile) for the first time.',
    startSetup: 'Start setup',
    windowMaterial: 'Choose a window material',
    windowMaterialBody: 'Choose a window background effect.',
    materialOff: 'Solid background',
    materialOffBody: 'Use a solid, opaque window background.',
    materialTransparent: 'Glass background',
    materialTransparentBody: 'Show a blurred view of the content behind the window.',
    materialMica: 'Mica',
    materialMicaBody: 'Use the native Windows Mica material when it is supported.',
    unavailableOnLinux: 'Window materials are currently available on macOS and Windows.',
    marketTitle: 'Choose a plugin market',
    marketBody: 'Choose a plugin market for the current Profile. Only one can be enabled at a time.',
    marketDisabled: 'Turn off plugin market',
    marketDisabledBody: 'Do not load a plugin market interface.',
    dshMarket: 'dsh-market',
    dshMarketBody: 'The popular community market powered by awesome-dsh-plugin data.',
    notificationsTitle: 'Set up Desktop notifications',
    notificationsBody: 'Receive system notifications when tasks finish or fail. Notifications do not show conversation content.',
    notificationsEnabled: 'Enable Desktop notifications',
    turnCompletion: 'Current turn completed',
    turnFailure: 'Current turn failed',
    jobCompletion: 'Background job completed',
    jobFailure: 'Background job failed',
    back: 'Previous',
    next: 'Next',
    skip: 'Skip setup',
    skipDialogTitle: 'Skip setup?',
    skipDialogBody: 'You can still configure all of these options later under Settings > Desktop settings.',
    cancelSkip: 'Continue setup',
    confirmSkip: 'Skip setup',
    successTitle: 'Setup complete',
    successBody: 'Desktop settings have been saved for the current Profile.',
    startUsing: 'Start using ClawClaw',
    invalidState: 'Setup information could not be loaded. Close this window and try again.',
  },
  zh: {

    title: '设置 ClawClaw',
    profile: 'Profile',
    welcomeTitle: '欢迎使用 ClawClaw',
    welcomeBody: '为当前 Profile 设置窗口外观和桌面通知。',
    firstProfileSetup: '首次使用此配置环境（Profile），请先完成桌面设置。',
    startSetup: '开始设置',
    windowMaterial: '选择窗口材质',
    windowMaterialBody: '选择窗口背景效果。',
    materialOff: '纯色背景',
    materialOffBody: '使用不透明的纯色窗口背景。',
    materialTransparent: '玻璃背景',
    materialTransparentBody: '透出窗口背后的内容，并呈现模糊效果。',
    materialMica: 'Mica',
    materialMicaBody: '在系统支持时使用 Windows 原生 Mica 材质。',
    unavailableOnLinux: '窗口材质目前支持 macOS 和 Windows。',
    marketTitle: '选择插件市场',
    marketBody: '为当前 Profile 选择一个插件市场。一次只能启用一个。',
    marketDisabled: '关闭插件市场',
    marketDisabledBody: '不加载插件市场界面。',
    dshMarket: 'dsh-market',
    dshMarketBody: '使用 awesome-dsh-plugin 数据的热门社区市场。',
    notificationsTitle: '设置桌面通知',
    notificationsBody: '在任务完成或失败时接收系统通知。通知不会显示会话内容。',
    notificationsEnabled: '启用桌面通知',
    turnCompletion: '本轮任务完成',
    turnFailure: '本轮任务失败',
    jobCompletion: '后台任务完成',
    jobFailure: '后台任务失败',
    back: '上一步',
    next: '下一步',
    skip: '跳过设置',
    skipDialogTitle: '跳过设置？',
    skipDialogBody: '之后仍可在“设置” > “桌面设置”中配置这里的所有内容。',
    cancelSkip: '继续设置',
    confirmSkip: '跳过设置',
    successTitle: '设置完成',
    successBody: '当前 Profile 的桌面设置已保存。',
    startUsing: '开始使用',
    invalidState: '无法加载设置信息。请关闭此窗口后重试。',
  },
}

export function desktopSetupWizardCopy(locale: DesktopLocale): DesktopSetupWizardCopy {
  return COPY[locale]
}
