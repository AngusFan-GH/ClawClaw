/**
 * Environment variable utilities for gateway process launch.
 *
 * Strips systemd supervisor environment variables that cause OpenClaw CLI to
 * enter a supervised retry loop, conflicting with the app's own lifecycle management.
 *
 * Also provides helpers for other gateway env var handling.
 */

export const SUPERVISED_SYSTEMD_ENV_KEYS = [
  'OPENCLAW_SYSTEMD_UNIT',
  'INVOCATION_ID',
  'SYSTEMD_EXEC_PID',
  'JOURNAL_STREAM',
] as const;

export type GatewayEnv = Record<string, string | undefined>;

/**
 * Remove systemd supervisor hint variables so gateway startup follows the app's
 * lifecycle manager instead of being supervised by systemd.
 *
 * Without this, OpenClaw may enter a retry loop when these vars are present,
 * causing duplicate gateway processes.
 */
export function stripSystemdSupervisorEnv(env: GatewayEnv): GatewayEnv {
  const next = { ...env };
  for (const key of SUPERVISED_SYSTEMD_ENV_KEYS) {
    delete next[key];
  }
  return next;
}