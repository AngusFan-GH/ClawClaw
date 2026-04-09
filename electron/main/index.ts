/**
 * Electron Main Process Entry
 * Manages window creation, system tray, and IPC handlers
 */
import { app, BrowserWindow, nativeImage, session, shell } from 'electron';
import type { Server } from 'node:http';
import { join } from 'path';
import { GatewayManager } from '../gateway/manager';
import { GatewayApplyCoordinator } from '../gateway/apply-coordinator';
import { registerIpcHandlers } from './ipc-handlers';
import { createTray } from './tray';
import { createMenu } from './menu';

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
import { isQuitting, setQuitting } from './app-state';
import { applyProxySettings } from './proxy';
import { getAllSettings, getSetting } from '../utils/store';
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
import { emitGatewayLifecycleEvent } from '../api/gateway-lifecycle';
import { runGatewayRefresh } from '../api/gateway-refresh';
import { getLastStartupPreflightFailedStepIds } from '../gateway/config-sync';
import {
} from '../services/providers/local-model-presets';
import { getProviderService } from '../services/providers/provider-service';

const isDev = !app.isPackaged;

// Disable GPU hardware acceleration globally for maximum stability across
// all GPU configurations (no GPU, integrated, discrete).
//
// Rationale (following VS Code's philosophy):
// - Page/file loading is async data fetching — zero GPU dependency.
// - The original per-platform GPU branching was added to avoid CPU rendering
//   competing with sync I/O on Windows, but all file I/O is now async
//   (fs/promises), so that concern no longer applies.
// - Software rendering is deterministic across all hardware; GPU compositing
//   behaviour varies between vendors (Intel, AMD, NVIDIA, Apple Silicon) and
//   driver versions, making it the #1 source of rendering bugs in Electron.
//
// Users who want GPU acceleration can pass `--enable-gpu` on the CLI or
// set `"disable-hardware-acceleration": false` in the app config (future).
app.disableHardwareAcceleration();

// Avoid transient Chromium cache read failures in development hot-reload loops.
if (isDev) {
  app.commandLine.appendSwitch('disable-http-cache');
}

// On Linux, set CHROME_DESKTOP so Chromium can find the correct .desktop file.
// On Wayland this maps the running window to clawclaw.desktop (→ icon + app grouping);
// on X11 it supplements the StartupWMClass matching.
// Must be called before app.whenReady() / before any window is created.
if (process.platform === 'linux') {
  app.setDesktopName('clawclaw.desktop');
}

// Prevent multiple instances of the app from running simultaneously.
// Without this, two instances each spawn their own gateway process on the
// same port, then each treats the other's gateway as "orphaned" and kills
// it — creating an infinite kill/restart loop on Windows.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// Global references
let mainWindow: BrowserWindow | null = null;
const gatewayManager = new GatewayManager();
const clawHubService = new ClawHubService();
const hostEventBus = new HostEventBus();
const gatewayApplyCoordinator = new GatewayApplyCoordinator({
  getGatewayStatus: () => gatewayManager.getStatus(),
  emitLifecycle: (payload) => {
    if (!mainWindow) return;
    emitGatewayLifecycleEvent({
      gatewayManager,
      gatewayApplyCoordinator,
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
let hostApiServer: Server | null = null;

/**
 * Resolve the icons directory path (works in both dev and packaged mode)
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    // Packaged: icons are in extraResources → process.resourcesPath/resources/icons
    return join(process.resourcesPath, 'resources', 'icons');
  }
  // Development: relative to dist-electron/main/
  return join(__dirname, '../../resources/icons');
}

/**
 * Get the app icon for the current platform
 */
function getAppIcon(): Electron.NativeImage | undefined {
  if (process.platform === 'darwin') return undefined; // macOS uses the app bundle icon

  const iconsDir = getIconsDir();
  const iconPath =
    process.platform === 'win32' ? join(iconsDir, 'icon.ico') : join(iconsDir, 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? undefined : icon;
}

/**
 * Create the main application window
 */
function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    icon: getAppIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true, // Enable <webview> for embedding OpenClaw Control UI
    },
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    frame: isMac,
    show: false,
  });

  // Show window when ready to prevent visual flash
  win.once('ready-to-show', () => {
    win.show();
  });

  // Handle external links
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, '../../dist/index.html'));
  }

  return win;
}

/**
 * Initialize the application
 */
async function initialize(): Promise<void> {
  // Initialize logger first
  logger.init();
  logger.info('=== ClawClaw Application Starting ===');
  logger.debug(
    `Runtime: platform=${process.platform}/${process.arch}, electron=${process.versions.electron}, node=${process.versions.node}, packaged=${app.isPackaged}`
  );

  // Warm up network optimization (non-blocking)
  void warmupNetworkOptimization();

  // Apply persisted proxy settings before creating windows or network requests.
  await applyProxySettings();

  if (isDev) {
    await session.defaultSession.clearCache().catch((error: unknown) => {
      logger.warn('Failed to clear Chromium cache in dev mode:', error);
    });
  }

  // Set application menu
  createMenu();

  // Create the main window
  mainWindow = createWindow();

  // Create system tray
  createTray(mainWindow, gatewayManager);

  // Override security headers ONLY for the OpenClaw Gateway Control UI.
  // The URL filter ensures this callback only fires for gateway requests,
  // avoiding unnecessary overhead on every other HTTP response.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['http://127.0.0.1:18789/*', 'http://localhost:18789/*'] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };
      delete headers['X-Frame-Options'];
      delete headers['x-frame-options'];
      if (headers['Content-Security-Policy']) {
        headers['Content-Security-Policy'] = headers['Content-Security-Policy'].map((csp) =>
          csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self' *")
        );
      }
      if (headers['content-security-policy']) {
        headers['content-security-policy'] = headers['content-security-policy'].map((csp) =>
          csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self' *")
        );
      }
      callback({ responseHeaders: headers });
    }
  );

  if (isDev) {
    const devCsp = [
      "default-src 'self' http://localhost:5173 ws://localhost:5173",
      // Vite + React Fast Refresh injects inline preamble scripts in dev.
      "script-src 'self' 'unsafe-inline' http://localhost:5173",
      "style-src 'self' 'unsafe-inline' http://localhost:5173",
      "img-src 'self' data: blob: http://localhost:5173",
      "font-src 'self' data: http://localhost:5173",
      "connect-src 'self' ws://localhost:5173 http://localhost:5173 http://127.0.0.1:18789 http://localhost:18789",
      "worker-src 'self' blob:",
    ].join('; ');

    session.defaultSession.webRequest.onHeadersReceived(
      { urls: ['http://localhost:5173/*'] },
      (details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [devCsp],
          },
        });
      }
    );
  }

  // Register IPC handlers
  registerIpcHandlers(gatewayManager, clawHubService, mainWindow);

  registerGatewayRefreshScheduler((request) => {
    if (
      request.source === 'provider.runtimeSync'
      && gatewayManager.isInStartupStabilizationWindow()
    ) {
      logger.debug(
        `Suppressing provider runtime Gateway refresh during startup stabilization (mode=${request.mode ?? 'reload'})`,
      );
      return;
    }

    const requires = request.mode === 'restart' ? 'restart' : 'reload';
    gatewayApplyCoordinator.enqueue({
      source: request.source ?? 'provider.runtimeSync',
      reason: request.reason ?? request.source ?? 'provider.runtimeSync',
      requires,
      delayMs: request.delayMs,
      skipIfStopped: request.onlyIfRunning !== true,
    });
  });

  hostApiServer = startHostApiServer({
    gatewayManager,
    gatewayApplyCoordinator,
    clawHubService,
    eventBus: hostEventBus,
    mainWindow,
  });

  const currentSettings = await getAllSettings();
  await appUpdater.initializeFromSettings(currentSettings);

  // Register update handlers
  registerUpdateHandlers(appUpdater, mainWindow);

  const { autoCheckUpdate } = currentSettings;
  if (autoCheckUpdate && appUpdater.isSupported()) {
    void appUpdater.checkForUpdates().catch((error) => {
      logger.warn('Startup auto-update check failed:', error);
    });
  }

  // Minimize to tray on close instead of quitting (macOS & Windows)
  mainWindow.on('close', (event) => {
    if (!isQuitting()) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

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
        `Upgrade maintenance completed (app ${upgradeMaintenance.previousAppVersion ?? 'none'} -> ${upgradeMaintenance.currentAppVersion}, openclaw ${upgradeMaintenance.previousOpenClawVersion ?? 'none'} -> ${upgradeMaintenance.currentOpenClawVersion ?? 'unknown'}, preflightTopics=${upgradeMaintenance.preflightRecoveredTopics.length}, doctorFix=${upgradeMaintenance.doctorFixStatus ?? 'skipped'}, doctorWarnings=${upgradeMaintenance.doctorFixWarningCount})`,
      );
    }
  } catch (error) {
    logger.warn('Upgrade maintenance failed:', error);
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
  // after Electron reloads/restarts without forcing an auto-start.
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

// When a second instance is launched, focus the existing window instead.
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// Application lifecycle
app.whenReady().then(() => {
  initialize();

  // Register activate handler AFTER app is ready to prevent
  // "Cannot create BrowserWindow before app is ready" on macOS.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      // On macOS, clicking the dock icon should show the window if it's hidden
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  setQuitting();
  hostEventBus.closeAll();
  hostApiServer?.close();
  // Fire-and-forget: do not await gatewayManager.stop() here.
  // Awaiting inside before-quit can stall Electron's quit sequence.
  void gatewayManager.stop().catch((err) => {
    logger.warn('gatewayManager.stop() error during quit:', err);
  });
});

// Export for testing
export { mainWindow, gatewayManager };
