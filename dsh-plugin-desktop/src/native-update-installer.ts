/** Native update staging. Importing this module never starts Electron or network work. */
import type { AppUpdater } from 'electron-updater'
import { CLAWCLAW_UPDATE_BASE_URL } from './update-checker.ts'

export type NativeUpdater = Pick<AppUpdater,
  'autoDownload' | 'autoInstallOnAppQuit' | 'allowDowngrade' | 'allowPrerelease' | 'channel' |
  'setFeedURL' | 'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall' | 'on' | 'removeListener'>

/** Only an explicit successful Host shutdown may call the returned installer action. */
export async function stageNativeUpdate(
  updater: NativeUpdater,
  version: string,
  signal: AbortSignal,
  progress: (fraction: number) => void = () => {},
): Promise<() => void> {
  signal.throwIfAborted()
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowPrerelease = false
  updater.allowDowngrade = false
  updater.channel = 'latest'
  updater.setFeedURL({ provider: 'generic', url: `${CLAWCLAW_UPDATE_BASE_URL}/stable`, useMultipleRangeRequest: false })
  const result = await updater.checkForUpdates()
  signal.throwIfAborted()
  if (result === null || !result.isUpdateAvailable || result.updateInfo.version !== version) {
    throw new Error('The selected release is no longer available. Check for updates again.')
  }
  const cancel = (): void => { result.cancellationToken?.cancel() }
  const onProgress = (info: { percent: number }): void => { progress(Math.min(1, Math.max(0, info.percent / 100))) }
  signal.addEventListener('abort', cancel, { once: true })
  updater.on('download-progress', onProgress)
  try {
    await updater.downloadUpdate(result.cancellationToken)
    signal.throwIfAborted()
    return () => { updater.quitAndInstall(false, true) }
  } finally {
    signal.removeEventListener('abort', cancel)
    updater.removeListener('download-progress', onProgress)
    progress(-1)
  }
}

let updaterPromise: Promise<AppUpdater> | undefined
/** The native updater is process-owned; Host restarts must not duplicate its listeners. */
export function getNativeUpdater(): Promise<AppUpdater> {
  return updaterPromise ??= import('electron-updater').then(module => {
    // electron-updater is CommonJS; autoUpdater is a lazy accessor on its default export.
    const updater = module.autoUpdater ?? module.default?.autoUpdater
    if (updater === undefined) throw new Error('electron-updater did not provide an auto updater')
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.logger = null
    // Operations reject their promises too; retain a listener to prevent unhandled EventEmitter errors.
    updater.on('error', () => {})
    return updater
  })
}
