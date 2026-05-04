import { describe, expect, it } from 'vitest';
import { classifyGatewayStderrMessage } from '@electron/gateway/startup-stderr';

describe('gateway stderr classification', () => {
  it('downgrades Telegram getUpdates conflicts because upstream retries them', () => {
    const result = classifyGatewayStderrMessage(
      "[telegram] getUpdates conflict: Call to 'getUpdates' failed! (409: Conflict); retrying in 2.03s.",
    );

    expect(result.level).toBe('debug');
  });

  it('downgrades escaped skill symlink noise cleaned during startup', () => {
    const result = classifyGatewayStderrMessage(
      '[skills] Skipping escaped skill path outside its configured root: source=openclaw-workspace reason=symlink-escape',
    );

    expect(result.level).toBe('debug');
  });

  it('keeps unknown stderr as warning', () => {
    expect(classifyGatewayStderrMessage('unexpected gateway failure').level).toBe('warn');
  });
});
