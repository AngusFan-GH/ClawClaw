import type { InstallerMode, InstallerPlan } from '../core/types.js';

export interface InstallerPlanRequest {
  mode: InstallerMode;
  installDir: string;
  arch: string;
  legacyVersion?: string;
  createDesktopShortcut: boolean;
  launchAtStartup: boolean;
  installCliPath: boolean;
  removeClawClawData: boolean;
  removeOpenClawData: boolean;
  removeLogsAndCache: boolean;
}

export interface InstallerInitialState {
  mode: InstallerMode;
  installDir: string;
  arch: string;
  legacyVersion?: string;
  detectedExistingInstall: boolean;
}

export interface InstallerPlanResponse {
  ok: boolean;
  plan?: InstallerPlan;
  error?: string;
}

export interface InstallerStartResponse {
  ok: boolean;
  error?: string;
}

export interface InstallerProgressEvent {
  type: 'start' | 'step:start' | 'step:done' | 'step:error' | 'done' | 'log';
  stepId?: string;
  title?: string;
  message?: string;
}

export interface InstallerBridge {
  getInitialState: () => Promise<InstallerInitialState>;
  getPlan: (request: InstallerPlanRequest) => Promise<InstallerPlanResponse>;
  start: (request: InstallerPlanRequest & { execute?: boolean }) => Promise<InstallerStartResponse>;
  onProgress: (callback: (event: InstallerProgressEvent) => void) => () => void;
  platform: string;
}

declare global {
  interface Window {
    installer?: InstallerBridge;
  }
}
