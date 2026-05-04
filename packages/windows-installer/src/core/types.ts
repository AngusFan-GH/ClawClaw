export type InstallerMode = 'install' | 'upgrade' | 'uninstall';

export type InstallerStepKind =
  | 'detect-existing-install'
  | 'stop-running-processes'
  | 'stop-gateway'
  | 'remove-gateway-service'
  | 'clean-stale-runtime'
  | 'copy-payload'
  | 'write-registry'
  | 'create-shortcuts'
  | 'update-path'
  | 'remove-app-files'
  | 'remove-user-data'
  | 'finalize';

export type InstallerStepRisk = 'low' | 'medium' | 'high';

export interface InstallerStepPlan {
  id: string;
  kind: InstallerStepKind;
  title: string;
  description: string;
  risk: InstallerStepRisk;
  destructive: boolean;
}

export interface ExistingInstallState {
  detected: boolean;
  version?: string;
  installDir?: string;
  source: 'none' | 'clawclaw-core' | 'legacy-nsis';
  requiresLegacyRuntimeCleanup: boolean;
}

export interface InstallPlanInput {
  mode: InstallerMode;
  installDir: string;
  createDesktopShortcut: boolean;
  launchAtStartup: boolean;
  installCliPath: boolean;
  existingInstall: ExistingInstallState;
}

export interface UninstallPlanInput {
  mode: 'uninstall';
  removeClawClawData: boolean;
  removeOpenClawData: boolean;
  removeLogsAndCache: boolean;
  existingInstall: ExistingInstallState;
}

export interface InstallerPlan {
  mode: InstallerMode;
  title: string;
  summary: string;
  steps: InstallerStepPlan[];
}
