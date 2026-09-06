import { describe, expect, it } from 'vitest';
import {
  getGatewayStartupRecoveryAction,
  hasMalformedConfigFailureSignal,
  hasInvalidConfigFailureSignal,
  isInvalidConfigSignal,
  isMalformedConfigSignal,
  isTransientGatewayStartError,
  shouldAttemptConfigAutoRepair,
} from '@backend/gateway/startup-recovery';

describe('gateway startup recovery heuristics', () => {
  it('detects invalid-config signal from stderr lines', () => {
    const lines = [
      'Invalid config at C:\\Users\\pc\\.openclaw\\openclaw.json:\\n- skills: Unrecognized key: "enabled"',
      'Run: openclaw doctor --fix',
    ];
    expect(hasInvalidConfigFailureSignal(new Error('gateway start failed'), lines)).toBe(true);
  });

  it('detects invalid-config signal from error message fallback', () => {
    expect(
      hasInvalidConfigFailureSignal(
        new Error('Config invalid. Run: openclaw doctor --fix'),
        [],
      ),
    ).toBe(true);
  });

  it('detects malformed-config signal from stderr lines', () => {
    const lines = [
      'Failed to read config at C:\\Users\\pc\\.openclaw\\openclaw.json SyntaxError: JSON5: invalid character \';\' at 10:1',
    ];
    expect(hasMalformedConfigFailureSignal(new Error('gateway start failed'), lines)).toBe(true);
  });

  it('does not treat unrelated startup failures as invalid-config failures', () => {
    const lines = [
      'Gateway process exited (code=1, expected=no)',
      'WebSocket closed before handshake',
    ];
    expect(
      hasInvalidConfigFailureSignal(
        new Error('Gateway process exited before becoming ready (code=1)'),
        lines,
      ),
    ).toBe(false);
  });

  it('attempts auto-repair only once per startup flow', () => {
    const lines = ['Config invalid', '- skills: Unrecognized key: "enabled"'];
    expect(shouldAttemptConfigAutoRepair(new Error('start failed'), lines, false)).toBe(true);
    expect(shouldAttemptConfigAutoRepair(new Error('start failed'), lines, true)).toBe(false);
  });

  it('attempts auto-repair for malformed-config failures', () => {
    const lines = [
      'Failed to read config at C:\\Users\\pc\\.openclaw\\openclaw.json SyntaxError: JSON5: invalid character \';\' at 10:1',
    ];
    expect(shouldAttemptConfigAutoRepair(new Error('start failed'), lines, false)).toBe(true);
    expect(shouldAttemptConfigAutoRepair(new Error('start failed'), lines, true)).toBe(false);
  });

  it('matches common invalid-config phrases robustly', () => {
    expect(isInvalidConfigSignal('Config invalid')).toBe(true);
    expect(isInvalidConfigSignal('skills: Unrecognized key: "enabled"')).toBe(true);
    expect(isInvalidConfigSignal('Run: openclaw doctor --fix')).toBe(true);
    expect(isInvalidConfigSignal('Gateway ready after 3 attempts')).toBe(false);
  });

  it('matches malformed-config phrases robustly', () => {
    expect(isMalformedConfigSignal('Failed to read config at ~/.openclaw/openclaw.json')).toBe(true);
    expect(isMalformedConfigSignal('SyntaxError: JSON5: invalid character \';\' at 10:1')).toBe(true);
    expect(isMalformedConfigSignal('Gateway ready after 3 attempts')).toBe(false);
  });

  it('treats Gateway WebSocket 503 during startup as transient', () => {
    expect(isTransientGatewayStartError(new Error('Unexpected server response: 503'))).toBe(true);
    expect(getGatewayStartupRecoveryAction({
      startupError: new Error('Unexpected server response: 503'),
      startupStderrLines: [],
      configRepairAttempted: false,
      attempt: 1,
      maxAttempts: 90,
    })).toBe('retry');
  });

  it('treats EADDRINUSE gateway lock failures during startup as transient', () => {
    const error = new Error(
      'another gateway instance is already listening on ws://127.0.0.1:18789 | listen EADDRINUSE: address already in use 127.0.0.1:18789',
    );
    expect(isTransientGatewayStartError(error)).toBe(true);
    expect(getGatewayStartupRecoveryAction({
      startupError: error,
      startupStderrLines: ['GatewayLockError: another gateway instance is already listening on ws://127.0.0.1:18789'],
      configRepairAttempted: false,
      attempt: 1,
      maxAttempts: 90,
    })).toBe('retry');
  });

  it('prefers reset-config for malformed config failures', () => {
    const lines = [
      'Failed to read config at C:\\Users\\pc\\.openclaw\\openclaw.json SyntaxError: JSON5: invalid character \';\' at 10:1',
    ];
    expect(getGatewayStartupRecoveryAction({
      startupError: new Error('Gateway process exited before becoming ready (code=1)'),
      startupStderrLines: lines,
      configRepairAttempted: false,
      attempt: 1,
      maxAttempts: 3,
    })).toBe('reset-config');
  });
});
