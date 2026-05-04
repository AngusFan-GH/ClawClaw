export type InstallerStepStatus = 'pending' | 'active' | 'done' | 'error';

export interface InstallOptions {
  installDir: string;
  createDesktopShortcut: boolean;
  launchAtStartup: boolean;
  installCliPath: boolean;
}

export interface UninstallOptions {
  removeApp: boolean;
  removeClawClawData: boolean;
  removeOpenClawData: boolean;
  removeLogsAndCache: boolean;
}

export const defaultInstallOptions: InstallOptions = {
  installDir: '%LOCALAPPDATA%\\Programs\\ClawClaw',
  createDesktopShortcut: true,
  launchAtStartup: false,
  installCliPath: true,
};

export const defaultUninstallOptions: UninstallOptions = {
  removeApp: true,
  removeClawClawData: false,
  removeOpenClawData: false,
  removeLogsAndCache: false,
};
