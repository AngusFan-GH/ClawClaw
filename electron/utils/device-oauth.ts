/**
 * Device OAuth Manager
 *
 * Delegates MiniMax and Qwen OAuth to the OpenClaw extension oauth.ts functions
 * imported directly from the bundled openclaw package at build time.
 *
 * This approach:
 * - Avoids hardcoding client_id (lives in openclaw extension)
 * - Avoids duplicating HTTP OAuth logic
 * - Avoids spawning CLI process (which requires interactive TTY)
 * - Works identically on macOS, Windows, and Linux
 *
 * The extension oauth.ts files only use `node:crypto` and global `fetch` —
 * they are pure Node.js HTTP functions, no TTY, no prompter needed.
 *
 * We provide our own callbacks (openUrl/note/progress) that hook into
 * the Electron IPC system to display UI in the ClawClaw frontend.
 */
import { EventEmitter } from 'events';
import { BrowserWindow, shell } from 'electron';
import { readFile } from 'fs/promises';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from './logger';
import { saveProvider, getProvider, ProviderConfig } from './secure-storage';
import { getProviderDefaultModel } from './provider-registry';
import { isOpenClawPresent } from './paths';
import { getProviderService } from '../services/providers/provider-service';
import { getSecretStore } from '../services/secrets/secret-store';
import {
  loginMiniMaxPortalOAuth,
  type MiniMaxOAuthToken,
  type MiniMaxRegion,
} from '../../node_modules/openclaw/extensions/minimax-portal-auth/oauth';
import {
  loginQwenPortalOAuth,
  type QwenOAuthToken,
} from '../../node_modules/openclaw/extensions/qwen-portal-auth/oauth';
import { saveOAuthTokenToOpenClaw, setOpenClawDefaultModelWithOverride } from './openclaw-auth';

export type OAuthProviderType = 'minimax-portal' | 'minimax-portal-cn' | 'qwen-portal' | 'openai';
export type { MiniMaxRegion };

const OPENAI_CODEX_PROVIDER_ID = 'openai-codex';
const OPENAI_CODEX_DEFAULT_MODEL = 'gpt-5.3-codex';
const OPENAI_DEVICE_VERIFICATION_URL = 'https://auth.openai.com/codex/device';

type OpenAICodexAuthFile = {
  auth_mode?: string;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
    id_token?: string;
  };
};

// ─────────────────────────────────────────────────────────────
// DeviceOAuthManager
// ─────────────────────────────────────────────────────────────

class DeviceOAuthManager extends EventEmitter {
  private activeProvider: OAuthProviderType | null = null;
  private activeAccountId: string | null = null;
  private activeLabel: string | null = null;
  private active: boolean = false;
  private mainWindow: BrowserWindow | null = null;
  private activeChild: ChildProcessWithoutNullStreams | null = null;

  setWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  async startFlow(
    provider: OAuthProviderType,
    region: MiniMaxRegion = 'global',
    options?: { accountId?: string; label?: string }
  ): Promise<boolean> {
    if (this.active) {
      await this.stopFlow();
    }

    this.active = true;
    this.emit('oauth:start', { provider, accountId: options?.accountId || provider });
    this.activeProvider = provider;
    this.activeAccountId = options?.accountId || provider;
    this.activeLabel = options?.label || null;

    try {
      if (provider === 'minimax-portal' || provider === 'minimax-portal-cn') {
        const actualRegion = provider === 'minimax-portal-cn' ? 'cn' : region || 'global';
        await this.runMiniMaxFlow(actualRegion, provider);
      } else if (provider === 'qwen-portal') {
        await this.runQwenFlow();
      } else if (provider === 'openai') {
        await this.runOpenAIFlow();
      } else {
        throw new Error(`Unsupported OAuth provider type: ${provider}`);
      }
      return true;
    } catch (error) {
      if (!this.active) {
        // Flow was cancelled — not an error
        return false;
      }
      logger.error(`[DeviceOAuth] Flow error for ${provider}:`, error);
      this.emitError(error instanceof Error ? error.message : String(error));
      this.active = false;
      this.activeProvider = null;
      this.activeAccountId = null;
      this.activeLabel = null;
      return false;
    }
  }

  async stopFlow(): Promise<void> {
    if (this.activeChild && !this.activeChild.killed) {
      this.activeChild.kill('SIGINT');
    }
    this.activeChild = null;
    this.active = false;
    this.activeProvider = null;
    this.activeAccountId = null;
    this.activeLabel = null;
    logger.info('[DeviceOAuth] Flow explicitly stopped');
  }

  // ─────────────────────────────────────────────────────────
  // MiniMax flow
  // ─────────────────────────────────────────────────────────

  private async runMiniMaxFlow(
    region?: MiniMaxRegion,
    providerType: OAuthProviderType = 'minimax-portal'
  ): Promise<void> {
    if (!isOpenClawPresent()) {
      throw new Error('OpenClaw package not found');
    }
    const provider = this.activeProvider!;

    const token: MiniMaxOAuthToken = await loginMiniMaxPortalOAuth({
      region,
      openUrl: async (url) => {
        logger.info(`[DeviceOAuth] MiniMax opening browser: ${url}`);
        // Open the authorization URL in the system browser
        shell
          .openExternal(url)
          .catch((err) => logger.warn(`[DeviceOAuth] Failed to open browser:`, err));
      },
      note: async (message, _title) => {
        if (!this.active) return;
        // The extension calls note() with a message containing
        // the user_code and verification_uri — parse them for the UI
        const { verificationUri, userCode } = this.parseNote(message);
        if (verificationUri && userCode) {
          this.emitCode({ provider, verificationUri, userCode, expiresIn: 300 });
        } else {
          logger.info(`[DeviceOAuth] MiniMax note: ${message}`);
        }
      },
      progress: {
        update: (msg) => logger.info(`[DeviceOAuth] MiniMax progress: ${msg}`),
        stop: (msg) => logger.info(`[DeviceOAuth] MiniMax progress done: ${msg ?? ''}`),
      },
    });

    if (!this.active) return;

    await this.onSuccess(providerType, {
      access: token.access,
      refresh: token.refresh,
      expires: token.expires,
      // MiniMax returns a per-account resourceUrl as the API base URL
      resourceUrl: token.resourceUrl,
      // Revert back to anthropic-messages
      api: 'anthropic-messages',
      region,
    });
  }

  // ─────────────────────────────────────────────────────────
  // Qwen flow
  // ─────────────────────────────────────────────────────────

  private async runQwenFlow(): Promise<void> {
    if (!isOpenClawPresent()) {
      throw new Error('OpenClaw package not found');
    }
    const provider = this.activeProvider!;

    const token: QwenOAuthToken = await loginQwenPortalOAuth({
      openUrl: async (url) => {
        logger.info(`[DeviceOAuth] Qwen opening browser: ${url}`);
        shell
          .openExternal(url)
          .catch((err) => logger.warn(`[DeviceOAuth] Failed to open browser:`, err));
      },
      note: async (message, _title) => {
        if (!this.active) return;
        const { verificationUri, userCode } = this.parseNote(message);
        if (verificationUri && userCode) {
          this.emitCode({ provider, verificationUri, userCode, expiresIn: 300 });
        } else {
          logger.info(`[DeviceOAuth] Qwen note: ${message}`);
        }
      },
      progress: {
        update: (msg) => logger.info(`[DeviceOAuth] Qwen progress: ${msg}`),
        stop: (msg) => logger.info(`[DeviceOAuth] Qwen progress done: ${msg ?? ''}`),
      },
    });

    if (!this.active) return;

    await this.onSuccess('qwen-portal', {
      access: token.access,
      refresh: token.refresh,
      expires: token.expires,
      // Qwen returns a per-account resourceUrl as the API base URL
      resourceUrl: token.resourceUrl,
      // Qwen uses OpenAI Completions API format
      api: 'openai-completions',
    });
  }

  // ─────────────────────────────────────────────────────────
  // OpenAI Codex flow
  // ─────────────────────────────────────────────────────────

  private async runOpenAIFlow(): Promise<void> {
    const child = spawn('codex', ['login', '--device-auth'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.activeChild = child;

    let stdout = '';
    let stderr = '';
    let emittedCode = false;

    await new Promise<void>((resolve, reject) => {
      const tryEmitDeviceCode = (): void => {
        if (emittedCode) return;
        const parsed = this.parseOpenAIDeviceOutput(`${stdout}\n${stderr}`);
        if (!parsed.verificationUri || !parsed.userCode) return;

        emittedCode = true;
        shell.openExternal(parsed.verificationUri).catch((error) => {
          logger.warn('[DeviceOAuth] Failed to open OpenAI device login page:', error);
        });
        this.emitCode({
          provider: 'openai',
          verificationUri: parsed.verificationUri,
          userCode: parsed.userCode,
          expiresIn: parsed.expiresIn ?? 900,
        });
      };

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        tryEmitDeviceCode();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        tryEmitDeviceCode();
      });

      child.on('error', (error) => {
        this.activeChild = null;
        reject(
          new Error(
            `Failed to launch Codex login. Make sure the Codex CLI is installed and available in PATH. ${String(error)}`
          )
        );
      });

      child.on('close', (code) => {
        this.activeChild = null;
        if (!this.active) {
          resolve();
          return;
        }
        if (code !== 0) {
          reject(new Error(stderr.trim() || stdout.trim() || `Codex login exited with code ${code}`));
          return;
        }
        resolve();
      });
    });

    if (!this.active) return;

    const token = await this.readOpenAICodexToken();
    if (!token) {
      throw new Error('Codex login finished, but no OAuth token was found in ~/.codex/auth.json.');
    }

    await this.onOpenAISuccess(token);
  }

  // ─────────────────────────────────────────────────────────
  // Success handler
  // ─────────────────────────────────────────────────────────

  private async onSuccess(
    providerType: OAuthProviderType,
    token: {
      access: string;
      refresh: string;
      expires: number;
      resourceUrl?: string;
      api: 'anthropic-messages' | 'openai-completions';
      region?: MiniMaxRegion;
    }
  ) {
    const accountId = this.activeAccountId || providerType;
    const accountLabel = this.activeLabel;
    this.active = false;
    this.activeProvider = null;
    this.activeAccountId = null;
    this.activeLabel = null;
    logger.info(`[DeviceOAuth] Successfully completed OAuth for ${providerType}`);

    // 1. Write OAuth token to OpenClaw's auth-profiles.json in native OAuth format.
    //    (matches what `openclaw models auth login` → upsertAuthProfile writes).
    //    We save both MiniMax providers to the generic "minimax-portal" profile
    //    so OpenClaw's gateway auto-refresher knows how to find it.
    try {
      const tokenProviderId = providerType.startsWith('minimax-portal')
        ? 'minimax-portal'
        : providerType;
      await saveOAuthTokenToOpenClaw(tokenProviderId, {
        access: token.access,
        refresh: token.refresh,
        expires: token.expires,
      });
    } catch (err) {
      logger.warn(`[DeviceOAuth] Failed to save OAuth token to OpenClaw:`, err);
    }

    // 2. Write openclaw.json: set default model + provider config (baseUrl/api/models)
    //    This mirrors what the OpenClaw plugin's configPatch does after CLI login.
    //    The baseUrl comes from token.resourceUrl (per-account URL from the OAuth server)
    //    or falls back to the provider's default public endpoint.
    const defaultBaseUrl =
      providerType === 'minimax-portal'
        ? 'https://api.minimax.io/anthropic'
        : providerType === 'minimax-portal-cn'
          ? 'https://api.minimaxi.com/anthropic'
          : 'https://portal.qwen.ai/v1';

    let baseUrl = token.resourceUrl || defaultBaseUrl;

    // Ensure baseUrl has a protocol prefix
    if (baseUrl && !baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      baseUrl = 'https://' + baseUrl;
    }

    // Ensure the base URL ends with /anthropic
    if (providerType.startsWith('minimax-portal') && baseUrl) {
      baseUrl =
        baseUrl
          .replace(/\/v1$/, '')
          .replace(/\/anthropic$/, '')
          .replace(/\/$/, '') + '/anthropic';
    } else if (providerType === 'qwen-portal' && baseUrl) {
      // Ensure Qwen API gets /v1 at the end
      if (!baseUrl.endsWith('/v1')) {
        baseUrl = baseUrl.replace(/\/$/, '') + '/v1';
      }
    }

    try {
      const tokenProviderId = providerType.startsWith('minimax-portal')
        ? 'minimax-portal'
        : providerType;
      await setOpenClawDefaultModelWithOverride(tokenProviderId, undefined, {
        baseUrl,
        api: token.api,
        // Tells OpenClaw's anthropic adapter to use `Authorization: Bearer` instead of `x-api-key`
        authHeader: providerType.startsWith('minimax-portal') ? true : undefined,
        // OAuth placeholder — tells Gateway to resolve credentials
        // from auth-profiles.json (type: 'oauth') instead of a static API key.
        apiKeyEnv: tokenProviderId === 'minimax-portal' ? 'minimax-oauth' : 'qwen-oauth',
      });
    } catch (err) {
      logger.warn(`[DeviceOAuth] Failed to configure openclaw models:`, err);
    }

    // 3. Save provider record in ClawClaw's own store so UI shows it as configured
    const existing = await getProvider(accountId);
    const nameMap: Record<OAuthProviderType, string> = {
      'minimax-portal': 'MiniMax (Global)',
      'minimax-portal-cn': 'MiniMax (CN)',
      'qwen-portal': 'Qwen',
    };
    const providerConfig: ProviderConfig = {
      id: accountId,
      name: accountLabel || nameMap[providerType as OAuthProviderType] || providerType,
      type: providerType,
      enabled: existing?.enabled ?? true,
      baseUrl, // Save the dynamically resolved URL (Global vs CN)

      model: existing?.model || getProviderDefaultModel(providerType),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveProvider(providerConfig);

    // 4. Emit success internally so the main process can restart the Gateway
    this.emit('oauth:success', { provider: providerType, accountId });

    // 5. Emit success to frontend
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('oauth:success', {
        provider: providerType,
        accountId,
        success: true,
      });
    }
  }

  private async onOpenAISuccess(token: {
    access: string;
    refresh: string;
    expires: number;
    accountId?: string;
    email?: string;
  }) {
    const accountId = this.activeAccountId || 'openai';
    const accountLabel = this.activeLabel;
    this.active = false;
    this.activeProvider = null;
    this.activeAccountId = null;
    this.activeLabel = null;
    this.activeChild = null;
    logger.info('[DeviceOAuth] Successfully completed OAuth for openai');

    const providerService = getProviderService();
    const existing = await providerService.getAccount(accountId);
    const nextAccount = await providerService.createAccount({
      id: accountId,
      vendorId: 'openai',
      label: accountLabel || existing?.label || 'OpenAI Codex',
      authMode: 'oauth_device',
      baseUrl: existing?.baseUrl,
      apiProtocol: existing?.apiProtocol,
      model: existing?.model || OPENAI_CODEX_DEFAULT_MODEL,
      fallbackModels: existing?.fallbackModels,
      fallbackAccountIds: existing?.fallbackAccountIds,
      enabled: existing?.enabled ?? true,
      isDefault: existing?.isDefault ?? false,
      metadata: {
        ...existing?.metadata,
        email: token.email,
        resourceUrl: OPENAI_CODEX_PROVIDER_ID,
      },
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await getSecretStore().set({
      type: 'oauth',
      accountId,
      accessToken: token.access,
      refreshToken: token.refresh,
      expiresAt: token.expires,
      email: token.email,
      subject: token.accountId,
    });

    await saveOAuthTokenToOpenClaw(OPENAI_CODEX_PROVIDER_ID, {
      access: token.access,
      refresh: token.refresh,
      expires: token.expires,
      email: token.email,
      projectId: token.accountId,
    });

    this.emit('oauth:success', { provider: 'openai', accountId: nextAccount.id });
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('oauth:success', {
        provider: 'openai',
        accountId: nextAccount.id,
        success: true,
      });
    }
  }

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────

  /**
   * Parse user_code and verification_uri from the note message sent by
   * the OpenClaw extension's loginXxxPortalOAuth function.
   *
   * Note format (minimax-portal-auth/oauth.ts):
   *   "Open https://platform.minimax.io/oauth-authorize?user_code=dyMj_wOhpK&client=... to approve access.\n"
   *   "If prompted, enter the code dyMj_wOhpK.\n"
   *   ...
   *
   * user_code format: mixed-case alphanumeric with underscore, e.g. "dyMj_wOhpK"
   */
  private parseNote(message: string): { verificationUri?: string; userCode?: string } {
    // Primary: extract URL (everything between "Open " and " to")
    const urlMatch = message.match(/Open\s+(https?:\/\/\S+?)\s+to/i);
    const verificationUri = urlMatch?.[1];

    let userCode: string | undefined;

    // Method 1: extract user_code from URL query param (most reliable)
    if (verificationUri) {
      try {
        const parsed = new URL(verificationUri);
        const qp = parsed.searchParams.get('user_code');
        if (qp) userCode = qp;
      } catch {
        // fall through to text-based extraction
      }
    }

    // Method 2: text-based extraction — matches mixed-case alnum + underscore/hyphen codes
    if (!userCode) {
      const codeMatch = message.match(/enter.*?code\s+([A-Za-z0-9][A-Za-z0-9_-]{3,})/i);
      if (codeMatch?.[1]) userCode = codeMatch[1].replace(/\.$/, ''); // strip trailing period
    }

    return { verificationUri, userCode };
  }

  private parseOpenAIDeviceOutput(
    message: string
  ): { verificationUri?: string; userCode?: string; expiresIn?: number } {
    const urlMatch = message.match(/https:\/\/auth\.openai\.com\/codex\/device/i);
    const codeMatch = message.match(/\b([A-Z0-9]{4,}-[A-Z0-9]{4,})\b/);
    const expiresMatch = message.match(/expires in\s+(\d+)\s+minutes/i);
    return {
      verificationUri: urlMatch ? OPENAI_DEVICE_VERIFICATION_URL : undefined,
      userCode: codeMatch?.[1],
      expiresIn: expiresMatch?.[1] ? Number(expiresMatch[1]) * 60 : undefined,
    };
  }

  private async readOpenAICodexToken(): Promise<{
    access: string;
    refresh: string;
    expires: number;
    accountId?: string;
    email?: string;
  } | null> {
    const authPath = join(homedir(), '.codex', 'auth.json');

    try {
      const raw = await readFile(authPath, 'utf-8');
      const parsed = JSON.parse(raw) as OpenAICodexAuthFile;
      const access = parsed.tokens?.access_token?.trim();
      const refresh = parsed.tokens?.refresh_token?.trim();
      if (!access || !refresh) {
        return null;
      }

      const accessPayload = this.decodeJwtPayload(access);
      const email =
        typeof accessPayload?.['https://api.openai.com/profile'] === 'object'
          ? (accessPayload['https://api.openai.com/profile'] as Record<string, unknown>).email as string | undefined
          : undefined;
      const expires =
        typeof accessPayload?.exp === 'number'
          ? accessPayload.exp
          : Math.floor(Date.now() / 1000) + 3600;

      return {
        access,
        refresh,
        expires,
        accountId: parsed.tokens?.account_id,
        email,
      };
    } catch (error) {
      logger.info(`[DeviceOAuth] No reusable Codex auth found at ${authPath}: ${String(error)}`);
      return null;
    }
  }

  private decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
      const [, payload] = token.split('.');
      if (!payload) return null;
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const normalized = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      return JSON.parse(Buffer.from(normalized, 'base64').toString('utf-8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private emitCode(data: {
    provider: string;
    verificationUri: string;
    userCode: string;
    expiresIn: number;
  }) {
    this.emit('oauth:code', data);
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('oauth:code', data);
    }
  }

  private emitError(message: string) {
    this.emit('oauth:error', { message });
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('oauth:error', { message });
    }
  }
}

export const deviceOAuthManager = new DeviceOAuthManager();
