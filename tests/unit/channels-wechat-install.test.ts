import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import {
  decodeCliInstallOutput,
  formatWeChatPluginInstallError,
  WECHAT_PLUGIN_SPEC,
} from '../../backend/utils/wechat-installer';

describe('wechat plugin install helpers', () => {
  it('decodes utf16le stderr emitted by Windows npm.cmd failures', () => {
    const raw = Buffer.from("npm.cmd /c npm pack failed: 'npm.cmd' is not recognized", 'utf16le');
    expect(decodeCliInstallOutput(raw)).toContain("'npm.cmd' is not recognized");
  });

  it('strips hook-pack fallback noise from plugin install errors', () => {
    const raw = [
      'npm pack failed: registry timeout',
      'Also not a valid hook pack: npm pack failed: registry timeout',
    ].join('\n');

    expect(formatWeChatPluginInstallError(raw)).toBe('npm pack failed: registry timeout');
  });

  it('maps ClawHub 429 errors to a concise retry message', () => {
    const raw = 'ClawHub/api/v1/packages/%40tencent-weixin%2Fopenclaw-weixin failed (429): Ratelimit exceeded';
    expect(formatWeChatPluginInstallError(raw)).toContain('ClawHub rate limit exceeded');
  });

  it('uses a plain npm registry spec accepted by current OpenClaw', () => {
    expect(WECHAT_PLUGIN_SPEC).toBe('@tencent-weixin/openclaw-weixin');
    expect(WECHAT_PLUGIN_SPEC.startsWith('npm:')).toBe(false);
  });
});
