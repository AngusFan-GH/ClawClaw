/** Localized copy for Desktop-owned native dialogs and notifications. */

import type { DesktopLocale } from './runtime.ts'

export interface DesktopNativeCopy {
  readonly ok: string
  readonly pluginRecoveryTitle: string
  readonly pluginRecoveryMessage: string
  readonly unknownPlugin: string
  readonly missingPluginError: string
  readonly failedPlugins: string
  readonly pluginRecoveryInstructions: string
  readonly openTerminal: string
  readonly restart: string
  readonly dismiss: string
  readonly updateAvailableTitle: string
  readonly updateAvailableMessage: (version: string) => string
  readonly downloadUpdate: string
  readonly download: string
  readonly later: string
  readonly updateCheckFailedTitle: string
  readonly updateCheckFailedMessage: string
  readonly updateFailedTitle: string
  readonly updateReleaseChanged: string
  readonly updateDownloadFailed: string
  readonly updateRetryInstructions: string
  readonly tryAgainLater: string
  readonly upToDateTitle: string
  readonly upToDateMessage: string
  readonly installedVersion: (version: string) => string
  readonly installerUnavailable: string
  readonly updateDownloadedTitle: string
  readonly updateReady: (version: string) => string
  readonly macInstallInstructions: string
  readonly restartInstallQuestion: string
  readonly windowsInstallQuestion: string
  readonly restartAndInstall: string
  readonly saveInstallerTitle: string
  readonly saveAndDownload: string
  readonly diskImage: string
  readonly windowsInstaller: string
  readonly removeInstallerTitle: string
  readonly updateInstalled: (version: string) => string
  readonly removeInstallerQuestion: (path: string) => string
  readonly deleteInstaller: string
  readonly keepInstaller: string
  readonly terminalErrorTitle: string
  readonly terminalErrorMessage: string
  readonly diagnosticsErrorTitle: string
  readonly diagnosticsErrorMessage: string
  readonly skippedPluginTitle: string
  readonly skippedPluginBody: (name: string, additionalCount: number) => string
  readonly unsupportedStorageTitle: string
  readonly unsupportedStorageBody: (label: string) => string
}

const COPY: Record<DesktopLocale, DesktopNativeCopy> = {
  en: {
    ok: 'OK',
    pluginRecoveryTitle: 'Plugin Load Failed',
    pluginRecoveryMessage: 'Some plugins could not be loaded.',
    unknownPlugin: 'Unknown client plugin',
    missingPluginError: 'The plugin loader did not provide an error message.',
    failedPlugins: 'Plugins that failed to load:',
    pluginRecoveryInstructions: 'Update or uninstall the failed third-party plugins in DSH Terminal, then restart the app.',
    openTerminal: 'Open DSH Terminal',
    restart: 'Restart ClawClaw',
    dismiss: 'Dismiss',
    updateAvailableTitle: 'ClawClaw Update Available',
    updateAvailableMessage: version => `ClawClaw ${version} is available.`,
    downloadUpdate: 'Download this update now?',
    download: 'Download',
    later: 'Later',
    updateCheckFailedTitle: 'Unable to Check for Updates',
    updateCheckFailedMessage: 'Could not retrieve update information.',
    updateFailedTitle: 'Unable to Complete Update',
    updateReleaseChanged: 'The available release has changed. The previously selected version was not downloaded.',
    updateDownloadFailed: 'Could not download, verify, or open the update installer.',
    updateRetryInstructions: 'Choose Check for Updates to try again.',
    tryAgainLater: 'Please try again later.',
    upToDateTitle: 'ClawClaw Is Up to Date',
    upToDateMessage: 'You are using the latest version.',
    installedVersion: version => `Installed version: ${version}`,
    installerUnavailable: 'This version cannot download installers from within the app.',
    updateDownloadedTitle: 'ClawClaw Update Downloaded',
    updateReady: version => `ClawClaw ${version} is ready to install.`,
    macInstallInstructions: 'The disk image has opened. Replace ClawClaw in Applications, then reopen it.',
    restartInstallQuestion: 'Restart ClawClaw and install the update now?',
    windowsInstallQuestion: 'Restart ClawClaw and run the installer now?',
    restartAndInstall: 'Restart and Install',
    saveInstallerTitle: 'Save Update Installer',
    saveAndDownload: 'Save and Download',
    diskImage: 'Disk Image',
    windowsInstaller: 'Windows Installer',
    removeInstallerTitle: 'Remove Update Installer',
    updateInstalled: version => `ClawClaw ${version} has been installed.`,
    removeInstallerQuestion: path => `Delete the downloaded installer to free disk space?\n\n${path}`,
    deleteInstaller: 'Delete Installer',
    keepInstaller: 'Keep Installer',
    terminalErrorTitle: 'Unable to Open DSH Terminal',
    terminalErrorMessage: 'Could not start the terminal. Please try again.',
    diagnosticsErrorTitle: 'Unable to Export Diagnostics',
    diagnosticsErrorMessage: 'Could not create the diagnostic archive. Please try again.',
    skippedPluginTitle: 'UI Plugin Not Loaded',
    skippedPluginBody: (name, additionalCount) => additionalCount > 0
      ? `${name} and ${additionalCount} other UI ${additionalCount === 1 ? 'plugin are' : 'plugins are'} not installed in this Profile.`
      : `${name} is not installed in this Profile.`,
    unsupportedStorageTitle: 'Storage May Be Unsupported',
    unsupportedStorageBody: label => `${label} is on a volume that may prevent sandboxed commands or plugin installation from working.`,
  },
  zh: {
    ok: '确定',
    pluginRecoveryTitle: '插件加载失败',
    pluginRecoveryMessage: '部分插件未能加载。',
    unknownPlugin: '未知客户端插件',
    missingPluginError: '插件加载器没有提供错误信息。',
    failedPlugins: '加载失败的插件：',
    pluginRecoveryInstructions: '请在 DSH 终端中更新或卸载加载失败的第三方插件，然后重启应用。',
    openTerminal: '打开 DSH 终端',
    restart: '重启 ClawClaw',
    dismiss: '关闭',
    updateAvailableTitle: 'ClawClaw 有可用更新',
    updateAvailableMessage: version => `ClawClaw ${version} 已可用。`,
    downloadUpdate: '现在下载此更新？',
    download: '下载',
    later: '稍后',
    updateCheckFailedTitle: '无法检查更新',
    updateCheckFailedMessage: '未能获取更新信息。',
    updateFailedTitle: '更新未完成',
    updateReleaseChanged: '可用版本已发生变化，未下载之前选择的版本。',
    updateDownloadFailed: '未能下载、校验或打开更新安装包。',
    updateRetryInstructions: '请再次选择“检查更新”重试。',
    tryAgainLater: '请稍后重试。',
    upToDateTitle: 'ClawClaw 已是最新版本',
    upToDateMessage: '当前已是最新版本。',
    installedVersion: version => `当前版本：${version}`,
    installerUnavailable: '当前版本不支持在应用内下载安装包。',
    updateDownloadedTitle: 'ClawClaw 更新已下载',
    updateReady: version => `ClawClaw ${version} 已可安装。`,
    macInstallInstructions: '磁盘映像已打开。请替换“应用程序”中的 ClawClaw，然后重新打开。',
    restartInstallQuestion: '现在重启 ClawClaw 并安装更新？',
    windowsInstallQuestion: '现在重启 ClawClaw 并运行安装程序？',
    restartAndInstall: '重启并安装',
    saveInstallerTitle: '保存更新安装包',
    saveAndDownload: '保存并下载',
    diskImage: '磁盘映像',
    windowsInstaller: 'Windows 安装程序',
    removeInstallerTitle: '删除更新安装包',
    updateInstalled: version => `ClawClaw ${version} 已安装。`,
    removeInstallerQuestion: path => `是否删除下载的安装包以释放磁盘空间？\n\n${path}`,
    deleteInstaller: '删除安装包',
    keepInstaller: '保留安装包',
    terminalErrorTitle: '无法打开 DSH 终端',
    terminalErrorMessage: '未能启动终端。请重试。',
    diagnosticsErrorTitle: '无法导出诊断信息',
    diagnosticsErrorMessage: '未能生成诊断包。请重试。',
    skippedPluginTitle: '界面插件未加载',
    skippedPluginBody: (name, additionalCount) => additionalCount > 0
      ? `${name} 及另外 ${additionalCount} 个界面插件未安装在当前 Profile 中。`
      : `${name} 未安装在当前 Profile 中。`,
    unsupportedStorageTitle: '存储位置可能不受支持',
    unsupportedStorageBody: label => `${label} 所在的磁盘可能导致沙盒命令或插件安装无法正常工作。`,
  },
}

export function desktopNativeCopy(locale: DesktopLocale): DesktopNativeCopy {
  return COPY[locale]
}
