import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getOpenClawCliSpawnConfig } from './openclaw-cli';
import { ensureBundledPluginInstalled } from './bundled-plugin-installer';
import { resolveOpenClawDir } from './paths';

type WeChatInstallerEvents = {
  output: [{ stream: 'stdout' | 'stderr'; text: string }];
  success: [{ code: number }];
  error: [string];
};

const WECHAT_PLUGIN_SPEC = '@tencent-weixin/openclaw-weixin';
const WECHAT_CHANNEL_ID = 'openclaw-weixin';

function installBundledWeChatPlugin(): boolean {
  return ensureBundledPluginInstalled(WECHAT_CHANNEL_ID, 'WeChat').installed;
}

type SpawnedStep = {
  child: ChildProcessWithoutNullStreams;
  done: Promise<number>;
};

export class WeChatInstallerManager extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private active = false;
  private cancelled = false;

  override on<K extends keyof WeChatInstallerEvents>(
    eventName: K,
    listener: (...args: WeChatInstallerEvents[K]) => void,
  ): this {
    return super.on(eventName, listener);
  }

  override emit<K extends keyof WeChatInstallerEvents>(
    eventName: K,
    ...args: WeChatInstallerEvents[K]
  ): boolean {
    return super.emit(eventName, ...args);
  }

  private spawnStep(args: string[], label: string): SpawnedStep {
    const spawnConfig = getOpenClawCliSpawnConfig(args);
    const child = spawn(spawnConfig.command, spawnConfig.args, {
      cwd: spawnConfig.cwd,
      env: spawnConfig.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.child = child;
    this.emit('output', { stream: 'stdout', text: `${label}\n` });

    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      this.emit('output', { stream: 'stdout', text: String(chunk) });
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = String(chunk);
      stderr += text;
      this.emit('output', { stream: 'stderr', text });
    });

    const done = new Promise<number>((resolve, reject) => {
      child.once('error', (error) => {
        reject(error);
      });

      child.once('close', (code, signal) => {
        if (this.child === child) {
          this.child = null;
        }
        if (this.cancelled) {
          reject(new Error(`WeChat setup was cancelled${signal ? ` (${signal})` : ''}.`));
          return;
        }
        if (code === 0) {
          resolve(0);
          return;
        }

        const suffix = stderr.trim() ? `\n${stderr.trim()}` : '';
        reject(new Error(`Command failed with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}.${suffix}`));
      });
    });

    return { child, done };
  }

  private async runStep(args: string[], label: string): Promise<void> {
    const step = this.spawnStep(args, label);
    await step.done;
  }

  async start(): Promise<void> {
    if (this.active) {
      return;
    }

    this.active = true;
    this.cancelled = false;

    try {
      this.emit('output', { stream: 'stdout', text: 'Preparing WeChat plugin setup...\n' });

      const pluginManifest = join(resolveOpenClawDir(), 'extensions', WECHAT_CHANNEL_ID, 'openclaw.plugin.json');
      if (installBundledWeChatPlugin()) {
        this.emit('output', {
          stream: 'stdout',
          text: `Installed bundled WeChat plugin mirror: ${WECHAT_CHANNEL_ID}\n`,
        });
      } else if (existsSync(pluginManifest)) {
        await this.runStep(
          ['plugins', 'update', WECHAT_CHANNEL_ID],
          `WeChat plugin already exists, updating: ${WECHAT_CHANNEL_ID}`,
        );
      } else {
        await this.runStep(
          ['plugins', 'install', WECHAT_PLUGIN_SPEC],
          `Installing WeChat plugin: ${WECHAT_PLUGIN_SPEC}`,
        );
      }

      this.emit('output', {
        stream: 'stdout',
        text: 'Plugin ready. Waiting for WeChat QR login...\n',
      });

      await this.runStep(
        ['channels', 'login', '--channel', WECHAT_CHANNEL_ID],
        `Starting WeChat login: ${WECHAT_CHANNEL_ID}`,
      );

      this.active = false;
      this.emit('success', { code: 0 });
    } catch (error) {
      this.active = false;
      if (this.cancelled) {
        this.emit('error', 'WeChat setup was cancelled.');
        return;
      }
      this.emit('error', error instanceof Error ? error.message : String(error));
    } finally {
      this.child = null;
    }
  }

  async stop(): Promise<void> {
    this.cancelled = true;
    this.active = false;

    if (!this.child) {
      return;
    }

    const child = this.child;
    this.child = null;

    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
}

export const weChatInstallerManager = new WeChatInstallerManager();
