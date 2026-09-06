import { emitDesktop, send } from '../host/transport';
import { requestHandlers } from '../host/desktop';
import { ClawCoreRuntime } from '../core/runtime';
/**
 * Node backend process entry.
 * Manages window creation, system tray, and IPC handlers
 */
import { HostWindow } from '../host/desktop';
import type { Server } from 'node:http';
import { GatewayManager } from '../gateway/manager';
import { GatewayApplyCoordinator } from '../gateway/apply-coordinator';
import { RuntimeApplyPlan } from '../gateway/runtime-apply-plan';
import { registerIpcHandlers } from './ipc-handlers';

import { appUpdater, registerUpdateHandlers } from './updater';
import { logger } from '../utils/logger';
import { warmupNetworkOptimization } from '../utils/uv-env';

import { ClawHubService } from '../gateway/clawhub';
import { ensureClawXContext, repairClawXOnlyBootstrapFiles } from '../utils/openclaw-workspace';
import {
  autoInstallCliIfNeeded,
  generateCompletionCache,
  installCompletionToProfile,
  verifyWindowsBundledCliRuntime,
} from '../utils/openclaw-cli';
import { setQuitting } from './app-state';
import { applyProxySettings } from './proxy';
import { getAllSettings, getSetting } from '../utils/store';
import { getDefaultProvider } from '../utils/secure-storage';
import { ensureBuiltinSkillsInstalled } from '../utils/skill-config';
import { performUpgradeMaintenanceIfNeeded } from '../utils/upgrade-maintenance';
import { startHostApiServer } from '../api/server';
import { HostEventBus } from '../api/event-bus';
import { deviceOAuthManager } from '../utils/device-oauth';
import { browserOAuthManager } from '../utils/browser-oauth';
import { whatsAppLoginManager } from '../utils/whatsapp-login';
import {
  registerGatewayRefreshScheduler,
  syncAllProviderAuthToRuntime,
  syncAllProvidersToRuntime,
  syncDefaultProviderToRuntime,
} from '../services/providers/provider-runtime-sync';
import {
  commitAgentDraftSession,
  discardAgentDraftSession,
  finalizeAgentDraftSession,
} from '../services/agent-draft-session';
import {
  commitChannelDraftSession,
  discardChannelDraftSession,
  finalizeChannelDraftSession,
} from '../services/channel-draft-session';
import {
  clearProviderDraftSession,
  discardProviderDraftSession,
} from '../services/provider-draft-session';
import { emitGatewayLifecycleEvent } from '../api/gateway-lifecycle';
import { runGatewayRefresh } from '../api/gateway-refresh';
import { getLastStartupPreflightFailedStepIds } from '../gateway/config-sync';
import { getProviderService } from '../services/providers/provider-service';


let mainWindow: HostWindow | null = null;
const gatewayManager = new GatewayManager();
const clawCore = new ClawCoreRuntime((event) => emitDesktop('core:run:event', event));
const clawHubService = new ClawHubService();
const hostEventBus = new HostEventBus();
const gatewayApplyCoordinator: GatewayApplyCoordinator = new GatewayApplyCoordinator({
  getGatewayStatus: () => gatewayManager.getStatus(),
  emitLifecycle: (payload) => {
    if (!mainWindow) return;
    emitGatewayLifecycleEvent({
      gatewayManager,
      gatewayApplyCoordinator,
      runtimeApplyPlan,
      clawHubService,
      eventBus: hostEventBus,
      mainWindow,
    }, payload);
  },
  executeRefresh: async (action, source, reason, options) => {
    if (!mainWindow) {
      return { triggered: false, accepted: false };
    }
    return await runGatewayRefresh({
      gatewayManager,
      gatewayApplyCoordinator,
      runtimeApplyPlan,
      clawHubService,
      eventBus: hostEventBus,
      mainWindow,
    }, {
      action,
      source,
      reason,
      mode: 'immediate',
      awaitCompletion: true,
      skipIfStopped: options.skipIfStopped,
      suppressScheduledEvent: options.suppressScheduledEvent,
    });
  },
});
const runtimeApplyPlan = new RuntimeApplyPlan({
  gatewayApplyCoordinator,
  getGatewayStatus: () => gatewayManager.getStatus(),
  beforeApply: async (snapshot) => {
    if (snapshot.pending.some((change) => change.domain === 'channels')) {
      await commitChannelDraftSession();
    }

    if (snapshot.pending.some((change) => change.domain === 'agents')) {
      await commitAgentDraftSession();
    }

    if (!snapshot.pending.some((change) => change.domain === 'providers')) {
      return;
    }

    await syncAllProvidersToRuntime();
    const defaultProviderId = await getDefaultProvider();
    if (defaultProviderId) {
      await syncDefaultProviderToRuntime(defaultProviderId, { suppressRefresh: true });
    }
    await syncAllProviderAuthToRuntime();
  },
  beforeDiscard: async (snapshot) => {
    const hasAgentChanges = snapshot.pending.some((change) => change.domain === 'agents');
    const hasChannelChanges = snapshot.pending.some((change) => change.domain === 'channels');
    const hasProviderChanges = snapshot.pending.some((change) => change.domain === 'providers');

    if (hasChannelChanges) {
      await discardChannelDraftSession();
    }
    if (hasAgentChanges || hasChannelChanges) {
      await discardAgentDraftSession();
    }
    if (hasProviderChanges) {
      await discardProviderDraftSession();
    }
  },
  afterApply: async (snapshot) => {
    const hasAgentChanges = snapshot.pending.some((change) => change.domain === 'agents');
    const hasChannelChanges = snapshot.pending.some((change) => change.domain === 'channels');
    const hasProviderChanges = snapshot.pending.some((change) => change.domain === 'providers');

    if (hasChannelChanges) {
      await finalizeChannelDraftSession();
    }
    if (hasAgentChanges || hasChannelChanges) {
      await finalizeAgentDraftSession();
    }
    if (hasProviderChanges) {
      await clearProviderDraftSession();
    }
  },
});
let hostApiServer: Server | null = null;


export async function initialize(): Promise<void> {
  logger.init();
  void warmupNetworkOptimization();
  await applyProxySettings();
  mainWindow = new HostWindow();
  // Register IPC handlers
  registerIpcHandlers(gatewayManager, clawHubService, mainWindow);
  requestHandlers.handle('core:run:create', async (_, input) => clawCore.runs.create(input));
  requestHandlers.handle('core:run:getEvents', async (_, runId: string, afterSequence?: number) => clawCore.runs.eventLog(runId, afterSequence));
  requestHandlers.handle('core:run:cancel', async (_, runId: string, reason?: string) => clawCore.runs.cancel(runId, reason));
  requestHandlers.handle('core:chat:send', async (_, input) => clawCore.startChat(input));

  registerGatewayRefreshScheduler((request) => {
    if (request.source === 'provider.runtimeSync') {
      const gatewayState = gatewayManager.getStatus().state;
      if (gatewayState !== 'running') {
        logger.debug(
          `Suppressing provider runtime Gateway refresh while Gateway is ${gatewayState} (mode=${request.mode ?? 'reload'})`,
        );
        return;
      }
      if (gatewayManager.isInStartupStabilizationWindow()) {
        logger.debug(
          `Suppressing provider runtime Gateway refresh during startup stabilization (mode=${request.mode ?? 'reload'})`,
        );
        return;
      }
    }

    const requires = request.mode === 'restart' ? 'restart' : 'reload';
    runtimeApplyPlan.record({
      domain: 'providers',
      label: '模型配置',
      source: request.source ?? 'provider.runtimeSync',
      reason: request.reason ?? request.source ?? 'provider.runtimeSync',
      requires,
    });
  });

  hostApiServer = await startHostApiServer({
    gatewayManager,
    gatewayApplyCoordinator,
    runtimeApplyPlan,
    clawHubService,
    eventBus: hostEventBus,
    mainWindow,
  });

  send({ type: 'ready', platform: process.platform });
  const currentSettings = await getAllSettings();
  await appUpdater.initializeFromSettings(currentSettings);

  // Register update handlers
  registerUpdateHandlers(appUpdater, mainWindow);

  // Repair any bootstrap files that only contain ClawClaw markers (no OpenClaw
  // template content). This fixes a race condition where ensureClawXContext()
  // previously created the file before the gateway could seed the full template.
  void repairClawXOnlyBootstrapFiles().catch((error) => {
    logger.warn('Failed to repair bootstrap files:', error);
  });

  // Pre-deploy built-in skills from bundled OpenClaw extensions and
  // resources/skills/ to ~/.openclaw/skills/ so they are immediately
  // available without manual install.
  void ensureBuiltinSkillsInstalled().catch((error) => {
    logger.warn('Failed to install built-in skills:', error);
  });

  try {
    const upgradeMaintenance = await performUpgradeMaintenanceIfNeeded();
    if (upgradeMaintenance.triggered) {
      logger.info(
        `Upgrade maintenance completed (app ${upgradeMaintenance.previousAppVersion ?? 'none'} -> ${upgradeMaintenance.currentAppVersion}, openclaw ${upgradeMaintenance.previousOpenClawVersion ?? 'none'} -> ${upgradeMaintenance.currentOpenClawVersion ?? 'unknown'}, legacyUpgrade=${upgradeMaintenance.legacyUpgradeRan}, preflightTopics=${upgradeMaintenance.preflightRecoveredTopics.length}, doctorFix=${upgradeMaintenance.doctorFixStatus ?? 'skipped'}, doctorWarnings=${upgradeMaintenance.doctorFixWarningCount})`,
      );
    }
  } catch (error) {
    logger.warn('Upgrade maintenance failed:', error);
  }

  const { autoCheckUpdate } = currentSettings;
  if (autoCheckUpdate && appUpdater.isSupported()) {
    void appUpdater.checkForUpdates().catch((error) => {
      logger.warn('Startup auto-update check failed:', error);
    });
  }

  // ClawCore is now the default runtime. The legacy gateway is retained only
  // for explicit migration diagnostics and is never started by normal builds.
  if (process.env.CLAWCLAW_ENABLE_LEGACY_GATEWAY !== '1') {
    logger.info('ClawCore runtime active; legacy OpenClaw gateway is disabled');
    return;
  }

  // Bridge gateway and host-side events before any auto-start logic runs, so
  // renderer subscribers observe the full startup lifecycle.
  gatewayManager.on('status', (status: { state: string }) => {
    hostEventBus.emit('gateway:status', status);
    if (status.state === 'running') {
      void ensureClawXContext().catch((error) => {
        logger.warn('Failed to re-merge ClawClaw context after gateway reconnect:', error);
      });
    }
  });

  gatewayManager.on('error', (error) => {
    hostEventBus.emit('gateway:error', { message: error.message });
  });

  gatewayManager.on('notification', (notification) => {
    hostEventBus.emit('gateway:notification', notification);
  });

  gatewayManager.on('chat:message', (data) => {
    hostEventBus.emit('gateway:chat-message', data);
  });

  gatewayManager.on('channel:status', (data) => {
    hostEventBus.emit('gateway:channel-status', data);
  });

  gatewayManager.on('exit', (code) => {
    hostEventBus.emit('gateway:exit', { code });
  });

  deviceOAuthManager.on('oauth:code', (payload) => {
    hostEventBus.emit('oauth:code', payload);
  });

  deviceOAuthManager.on('oauth:start', (payload) => {
    hostEventBus.emit('oauth:start', payload);
  });

  deviceOAuthManager.on('oauth:success', (payload) => {
    hostEventBus.emit('oauth:success', { ...payload, success: true });
  });

  deviceOAuthManager.on('oauth:error', (error) => {
    hostEventBus.emit('oauth:error', error);
  });

  browserOAuthManager.on('oauth:start', (payload) => {
    hostEventBus.emit('oauth:start', payload);
  });

  browserOAuthManager.on('oauth:success', (payload) => {
    hostEventBus.emit('oauth:success', { ...payload, success: true });
  });

  browserOAuthManager.on('oauth:error', (error) => {
    hostEventBus.emit('oauth:error', error);
  });

  whatsAppLoginManager.on('qr', (data) => {
    hostEventBus.emit('channel:whatsapp-qr', data);
  });

  whatsAppLoginManager.on('success', (data) => {
    hostEventBus.emit('channel:whatsapp-success', data);
  });

  whatsAppLoginManager.on('error', (error) => {
    hostEventBus.emit('channel:whatsapp-error', error);
  });


  const syncProviderRuntimeAfterGatewayReady = async () => {
    const failedStepIds = new Set(getLastStartupPreflightFailedStepIds());
    if (failedStepIds.size === 0) {
      logger.debug('Skipping background provider runtime sync after Gateway availability (startup preflight completed cleanly)');
      return;
    }

    try {
      logger.debug(
        `Starting compensating provider runtime sync after Gateway availability (failed preflight steps: ${Array.from(failedStepIds).join(', ')})`,
      );

      if (failedStepIds.has('sync-provider-configs')) {
        await syncAllProvidersToRuntime();
        logger.debug('Background provider config sync completed');
      }

      if (failedStepIds.has('sync-provider-auth')) {
        await syncAllProviderAuthToRuntime();
        logger.debug('Background provider auth sync completed');
      }

      if (failedStepIds.has('sync-default-provider')) {
        const defaultProviderAccountId = await getProviderService().getDefaultAccountId();
        if (defaultProviderAccountId) {
          await syncDefaultProviderToRuntime(defaultProviderAccountId, { suppressRefresh: true });
          logger.debug(`Background default provider sync completed (${defaultProviderAccountId})`);
        } else {
          logger.debug('Background default provider sync skipped (no default account)');
        }
      }
    } catch (error) {
      logger.warn('Background provider runtime sync failed:', error);
    }
  };

  // Re-attach to an already running Gateway first. This keeps the UI in sync
  // after desktop host reloads/restarts without forcing an auto-start.
  logger.debug('Gateway startup decision: probing for existing Gateway attachment...');
  const attachedExistingGateway = await gatewayManager.attachIfRunning({ force: true });

  // Start Gateway automatically (this seeds missing bootstrap files with full templates)
  const gatewayAutoStart = await getSetting('gatewayAutoStart');
  logger.info(
    `Gateway startup decision: attachExisting=${attachedExistingGateway ? 'connected' : 'none'} autoStart=${gatewayAutoStart ? 'enabled' : 'disabled'}`
  );
  if (attachedExistingGateway) {
    logger.info('Attached to existing Gateway during app startup');
    void syncProviderRuntimeAfterGatewayReady();
  } else if (gatewayAutoStart) {
    try {
      logger.debug('Auto-starting Gateway...');
      const startupLifecycleEvent = {
        phase: 'scheduled' as const,
        action: 'start' as const,
        source: 'gateway.autoStart',
        reason: 'gateway.autoStart',
        at: Date.now(),
      };
      hostEventBus.emit('gateway:lifecycle', startupLifecycleEvent);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('gateway:lifecycle-changed', startupLifecycleEvent);
      }
      await gatewayManager.start();
      const completedStartupLifecycleEvent = {
        phase: 'completed' as const,
        action: 'start' as const,
        source: 'gateway.autoStart',
        reason: 'gateway.autoStart',
        recovery: gatewayManager.getLastStartupRecovery() ?? undefined,
        at: Date.now(),
      };
      hostEventBus.emit('gateway:lifecycle', completedStartupLifecycleEvent);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('gateway:lifecycle-changed', completedStartupLifecycleEvent);
      }
      logger.info('Gateway auto-start succeeded');
      void syncProviderRuntimeAfterGatewayReady();
    } catch (error) {
      logger.error('Gateway auto-start failed:', error);
      const failedStartupLifecycleEvent = {
        phase: 'failed' as const,
        action: 'start' as const,
        source: 'gateway.autoStart',
        reason: 'gateway.autoStart',
        error: String(error),
        recovery: gatewayManager.getLastStartupRecovery() ?? undefined,
        at: Date.now(),
      };
      hostEventBus.emit('gateway:lifecycle', failedStartupLifecycleEvent);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('gateway:lifecycle-changed', failedStartupLifecycleEvent);
      }
      mainWindow?.webContents.send('gateway:error', String(error));
    }
  } else {
    logger.info('Gateway auto-start disabled in settings');
  }

  // Merge ClawClaw context snippets into the workspace bootstrap files.
  // The gateway seeds workspace files asynchronously after its HTTP server
  // is ready, so ensureClawXContext will retry until the target files appear.
  void ensureClawXContext().catch((error) => {
    logger.warn('Failed to merge ClawClaw context into workspace:', error);
  });

  verifyWindowsBundledCliRuntime();

  if (process.env.CLAWCLAW_DISABLE_CLI_INSTALL === '1') return;

  // Auto-install openclaw CLI and shell completions (non-blocking).
  void autoInstallCliIfNeeded((installedPath) => {
    mainWindow?.webContents.send('openclaw:cli-installed', installedPath);
  })
    .then(() => {
      generateCompletionCache();
      installCompletionToProfile();
    })
    .catch((error) => {
      logger.warn('CLI auto-install failed:', error);
    });
}


export async function shutdown(): Promise<void> {
  setQuitting();
  hostEventBus.closeAll();
  hostApiServer?.close();
  clawCore.close();
  await Promise.allSettled([deviceOAuthManager.stopFlow(), browserOAuthManager.stopFlow(), gatewayManager.stop()]);
}
export { gatewayManager };
