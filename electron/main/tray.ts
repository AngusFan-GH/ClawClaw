/**
 * System Tray Management
 * Creates and manages the system tray icon and menu
 */
import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import { join } from 'path';
import type { GatewayManager } from '../gateway/manager';
import { getSetting } from '../utils/store';
import { quitApp } from './quit';

let tray: Tray | null = null;

type TrayLanguage = 'zh' | 'en' | 'ja';

const trayCopy = {
  zh: {
    tooltip: 'ClawClaw - AI 助手',
    show: '显示 ClawClaw',
    gatewayStatus: '网关状态',
    running: '运行中',
    quickActions: '快捷操作',
    newChat: '新建对话',
    restartGateway: '重启网关',
    openSettings: '打开设置',
    quit: '退出 ClawClaw',
  },
  en: {
    tooltip: 'ClawClaw - AI Assistant',
    show: 'Show ClawClaw',
    gatewayStatus: 'Gateway Status',
    running: 'Running',
    quickActions: 'Quick Actions',
    newChat: 'New Chat',
    restartGateway: 'Restart Gateway',
    openSettings: 'Open Settings',
    quit: 'Quit ClawClaw',
  },
  ja: {
    tooltip: 'ClawClaw - AI アシスタント',
    show: 'ClawClaw を表示',
    gatewayStatus: 'ゲートウェイ状態',
    running: '実行中',
    quickActions: 'クイック操作',
    newChat: '新しいチャット',
    restartGateway: 'ゲートウェイを再起動',
    openSettings: '設定を開く',
    quit: 'ClawClaw を終了',
  },
} as const;

function normalizeLanguage(language: string | undefined): TrayLanguage {
  if (language?.startsWith('en')) return 'en';
  if (language?.startsWith('ja')) return 'ja';
  return 'zh';
}

/**
 * Resolve the icons directory path (works in both dev and packaged mode)
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'icons');
  }
  return join(__dirname, '../../resources/icons');
}

/**
 * Create system tray icon and menu
 */
export function createTray(mainWindow: BrowserWindow, gatewayManager: GatewayManager): Tray {
  // Use platform-appropriate icon for system tray
  const iconsDir = getIconsDir();
  let iconPath: string;

  if (process.platform === 'win32') {
    // Windows: use .ico for best quality in system tray
    iconPath = join(iconsDir, 'icon.ico');
  } else if (process.platform === 'darwin') {
    // macOS: use Template.png for proper status bar icon
    // The "Template" suffix tells macOS to treat it as a template image
    iconPath = join(iconsDir, 'tray-icon-Template.png');
  } else {
    // Linux: use 32x32 PNG
    iconPath = join(iconsDir, '32x32.png');
  }

  let icon = nativeImage.createFromPath(iconPath);

  // Fallback to icon.png if platform-specific icon not found
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(join(iconsDir, 'icon.png'));
    // Still try to set as template for macOS
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true);
    }
  }

  // Note: Using "Template" suffix in filename automatically marks it as template image
  // But we can also explicitly set it for safety
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon);

  const showWindow = () => {
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  };

  const sendNavigation = (target: string | { path: string; state?: unknown }) => {
    if (mainWindow.isDestroyed()) return;
    showWindow();
    const send = () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('navigate', target);
      }
    };
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', send);
    } else {
      queueMicrotask(send);
    }
  };

  const sendGatewayLifecycle = (event: {
    phase: 'scheduled' | 'failed';
    action: 'restart';
    source: 'gateway.manualRestart';
    reason: 'gateway.manualRestart';
    error?: string;
    at: number;
  }) => {
    if (mainWindow.isDestroyed()) return;
    const send = () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('gateway:lifecycle-changed', event);
      }
    };
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', send);
    } else {
      queueMicrotask(send);
    }
  };

  const applyMenu = (language: TrayLanguage) => {
    const copy = trayCopy[language];
    if (!tray) return;
    tray.setToolTip(copy.tooltip);
    tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: copy.show,
      click: showWindow,
    },
    {
      type: 'separator',
    },
    {
      label: copy.gatewayStatus,
      enabled: false,
    },
    {
      label: `  ${copy.running}`,
      type: 'checkbox',
      checked: true,
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: copy.quickActions,
      submenu: [
        {
          label: copy.newChat,
          click: () => {
            if (mainWindow.isDestroyed()) return;
            sendNavigation({
              path: '/',
              state: {
                createNewSession: true,
                requestedAt: Date.now(),
              },
            });
          },
        },
        {
          label: copy.openSettings,
          click: () => {
            if (mainWindow.isDestroyed()) return;
            sendNavigation('/settings');
          },
        },
        {
          type: 'separator',
        },
        {
          label: copy.restartGateway,
          click: () => {
            if (mainWindow.isDestroyed()) return;
            showWindow();
            sendGatewayLifecycle({
              phase: 'scheduled',
              action: 'restart',
              source: 'gateway.manualRestart',
              reason: 'gateway.manualRestart',
              at: Date.now(),
            });
            void gatewayManager.restart({ force: true }).catch((error) => {
              if (mainWindow.isDestroyed()) return;
              sendGatewayLifecycle({
                phase: 'failed',
                action: 'restart',
                source: 'gateway.manualRestart',
                reason: 'gateway.manualRestart',
                error: String(error),
                at: Date.now(),
              });
            });
          },
        },
      ],
    },
    {
      type: 'separator',
    },
    {
      label: copy.quit,
      click: () => {
        quitApp(app);
      },
    },
  ]));
  };

  applyMenu('zh');
  void getSetting('language')
    .then((language) => applyMenu(normalizeLanguage(language)))
    .catch(() => applyMenu(normalizeLanguage(app.getLocale())));

  // Click to show window (Windows/Linux)
  tray.on('click', () => {
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Double-click to show window (Windows)
  tray.on('double-click', () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  });

  return tray;
}

/**
 * Update tray tooltip with Gateway status
 */
export function updateTrayStatus(status: string): void {
  if (tray) {
    tray.setToolTip(`ClawClaw - ${status}`);
  }
}

/**
 * Destroy tray icon
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
