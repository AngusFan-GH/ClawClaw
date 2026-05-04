import type {
  ExistingInstallState,
  InstallerPlan,
  InstallerStepPlan,
  InstallPlanInput,
  UninstallPlanInput,
} from './types.js';

const noExistingInstall: ExistingInstallState = {
  detected: false,
  source: 'none',
  requiresLegacyRuntimeCleanup: false,
};

function step(
  id: string,
  kind: InstallerStepPlan['kind'],
  title: string,
  description: string,
  risk: InstallerStepPlan['risk'] = 'low',
  destructive = false,
): InstallerStepPlan {
  return { id, kind, title, description, risk, destructive };
}

export function createInstallPlan(input: InstallPlanInput): InstallerPlan {
  const existingInstall = input.existingInstall ?? noExistingInstall;
  const isUpgrade = input.mode === 'upgrade' || existingInstall.detected;
  const steps: InstallerStepPlan[] = [];

  if (isUpgrade) {
    steps.push(
      step(
        'detect-existing-install',
        'detect-existing-install',
        'Read existing installation',
        'Import install location, version, shortcut state, and legacy registry metadata.',
      ),
      step(
        'stop-running-processes',
        'stop-running-processes',
        'Stop running ClawClaw processes',
        'Close ClawClaw and child processes that lock files in the install directory.',
        'medium',
      ),
      step(
        'stop-gateway',
        'stop-gateway',
        'Stop OpenClaw Gateway',
        'Stop the bundled Gateway before replacing runtime files.',
        'medium',
      ),
      step(
        'remove-gateway-service',
        'remove-gateway-service',
        'Remove old Gateway service',
        'Remove scheduled tasks or services owned by the previous installation.',
        'medium',
      ),
    );
  }

  if (isUpgrade || existingInstall.requiresLegacyRuntimeCleanup) {
    steps.push(
      step(
        'clean-stale-runtime',
        'clean-stale-runtime',
        'Clean stale runtime files',
        'Remove old OpenClaw runtime and plugin mirrors before copying the new bundle.',
        'medium',
        true,
      ),
    );
  }

  steps.push(
    step(
      'copy-payload',
      'copy-payload',
      'Install application files',
      `Copy ClawClaw and bundled OpenClaw resources to ${input.installDir}.`,
    ),
    step(
      'write-registry',
      'write-registry',
      'Register with Windows',
      'Write uninstall metadata, version, install location, and maintenance command.',
    ),
    step(
      'create-shortcuts',
      'create-shortcuts',
      'Create shortcuts',
      input.createDesktopShortcut
        ? 'Create Start Menu and desktop shortcuts.'
        : 'Create Start Menu shortcut only.',
    ),
  );

  if (input.installCliPath) {
    steps.push(
      step(
        'update-path',
        'update-path',
        'Configure OpenClaw CLI',
        'Add the bundled OpenClaw CLI directory to the current user PATH.',
      ),
    );
  }

  steps.push(
    step(
      'finalize',
      'finalize',
      input.launchAtStartup ? 'Finalize and enable launch at startup' : 'Finalize installation',
      'Refresh shell integration and prepare the first launch.',
    ),
  );

  return {
    mode: isUpgrade ? 'upgrade' : 'install',
    title: isUpgrade ? 'Upgrade ClawClaw' : 'Install ClawClaw',
    summary: isUpgrade
      ? 'Upgrade the existing installation in place while preserving user data.'
      : 'Install ClawClaw for the current Windows user.',
    steps,
  };
}

export function createUninstallPlan(input: UninstallPlanInput): InstallerPlan {
  const steps: InstallerStepPlan[] = [
    step(
      'detect-existing-install',
      'detect-existing-install',
      'Read installed application',
      'Locate the installed ClawClaw version and maintenance metadata.',
    ),
    step(
      'stop-running-processes',
      'stop-running-processes',
      'Stop running processes',
      'Close ClawClaw and child processes before deleting application files.',
      'medium',
    ),
    step(
      'stop-gateway',
      'stop-gateway',
      'Stop OpenClaw Gateway',
      'Stop the bundled Gateway before removing the application.',
      'medium',
    ),
    step(
      'remove-gateway-service',
      'remove-gateway-service',
      'Remove Gateway service',
      'Remove scheduled tasks or services owned by ClawClaw.',
      'medium',
      true,
    ),
    step(
      'remove-app-files',
      'remove-app-files',
      'Remove application files',
      'Delete ClawClaw program files, shortcuts, and registry entries.',
      'medium',
      true,
    ),
  ];

  if (input.removeClawClawData || input.removeLogsAndCache) {
    steps.push(
      step(
        'remove-clawclaw-data',
        'remove-user-data',
        'Remove ClawClaw local data',
        'Delete selected settings, logs, cache, and temporary files.',
        'high',
        true,
      ),
    );
  }

  if (input.removeOpenClawData) {
    steps.push(
      step(
        'remove-openclaw-data',
        'remove-user-data',
        'Remove OpenClaw user data',
        'Delete ~/.openclaw, including agents, skills, channels, credentials, sessions, and runtime state.',
        'high',
        true,
      ),
    );
  }

  steps.push(
    step(
      'finalize',
      'finalize',
      'Finalize uninstall',
      'Refresh Windows shell state and complete maintenance.',
    ),
  );

  return {
    mode: 'uninstall',
    title: 'Uninstall ClawClaw',
    summary: 'Remove the application and only the user data explicitly selected.',
    steps,
  };
}
