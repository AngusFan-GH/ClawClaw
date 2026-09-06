import { EventEmitter } from 'events';
import { existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { getOpenClawResolvedDir, resolveOpenClawDir } from './paths';

type WhatsAppLoginApi = {
  startWebLoginWithQr(opts?: {
    accountId?: string;
    force?: boolean;
    timeoutMs?: number;
    verbose?: boolean;
  }): Promise<{ qrDataUrl?: string; message?: string }>;
  waitForWebLogin(opts?: {
    accountId?: string;
    timeoutMs?: number;
    verbose?: boolean;
  }): Promise<{ connected: boolean; message?: string }>;
};

let loginApiPromise: Promise<WhatsAppLoginApi> | null = null;

async function loadWhatsAppLoginApi(): Promise<WhatsAppLoginApi> {
  if (!loginApiPromise) {
    const openclawResolvedPath = getOpenClawResolvedDir();
    const entryPath = join(openclawResolvedPath, 'dist', 'extensions', 'whatsapp', 'login-qr-api.js');
    loginApiPromise = import(pathToFileURL(entryPath).href) as Promise<WhatsAppLoginApi>;
  }
  return await loginApiPromise;
}

function cleanupPendingAuth(accountId: string): void {
  try {
    const authDir = join(resolveOpenClawDir(), 'credentials', 'whatsapp', accountId);
    if (existsSync(authDir)) {
      rmSync(authDir, { recursive: true, force: true });
    }

    const parentDir = join(resolveOpenClawDir(), 'credentials', 'whatsapp');
    if (existsSync(parentDir)) {
      const remaining = readdirSync(parentDir);
      if (remaining.length === 0) {
        rmSync(parentDir, { recursive: true, force: true });
      }
    }
  } catch (error) {
    console.error('[WhatsAppLogin] Failed to clean up auth dir after cancel:', error);
  }
}

export class WhatsAppLoginManager extends EventEmitter {
  private accountId: string | null = null;
  private active = false;
  private loginSucceeded = false;
  private flowId = 0;

  async start(accountId = 'default'): Promise<void> {
    if (this.active && this.accountId === accountId) {
      return;
    }

    await this.stop();

    this.accountId = accountId;
    this.active = true;
    this.loginSucceeded = false;
    this.flowId += 1;
    const flowId = this.flowId;

    const { startWebLoginWithQr, waitForWebLogin } = await loadWhatsAppLoginApi();
    const startResult = await startWebLoginWithQr({
      accountId,
      force: true,
      timeoutMs: 30000,
    });

    if (!this.active || this.flowId !== flowId) {
      return;
    }

    if (!startResult.qrDataUrl) {
      throw new Error(startResult.message || 'Failed to start WhatsApp login');
    }

    const base64 = startResult.qrDataUrl.replace(/^data:image\/png;base64,/, '');
    this.emit('qr', { qr: base64, raw: undefined, message: startResult.message });

    void this.waitForCompletion(accountId, flowId, waitForWebLogin);
  }

  private async waitForCompletion(
    accountId: string,
    flowId: number,
    waitForWebLogin: WhatsAppLoginApi['waitForWebLogin'],
  ): Promise<void> {
    try {
      while (this.active && this.flowId === flowId) {
        const result = await waitForWebLogin({
          accountId,
          timeoutMs: 15000,
        });

        if (!this.active || this.flowId !== flowId) {
          return;
        }

        if (result.connected) {
          this.loginSucceeded = true;
          this.active = false;
          this.emit('success', { accountId, message: result.message });
          return;
        }

        if (
          result.message
          && !result.message.includes('Still waiting for the QR scan')
          && !result.message.includes('No active WhatsApp login in progress')
        ) {
          this.active = false;
          this.emit('error', result.message);
          return;
        }
      }
    } catch (error) {
      if (!this.active || this.flowId !== flowId) {
        return;
      }
      this.active = false;
      this.emit('error', error instanceof Error ? error.message : String(error));
    }
  }

  async stop(): Promise<void> {
    const cleanupAccountId = !this.loginSucceeded ? this.accountId : null;
    this.active = false;
    this.accountId = null;
    this.loginSucceeded = false;
    this.flowId += 1;

    if (cleanupAccountId) {
      cleanupPendingAuth(cleanupAccountId);
    }
  }
}

export const whatsAppLoginManager = new WhatsAppLoginManager();
