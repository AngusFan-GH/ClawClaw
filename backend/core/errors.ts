/**
 * Stable error taxonomy for ClawCore.
 *
 * Every error that can cross the IPC boundary carries a stable `code` plus a
 * human-readable (but never secret-bearing) message. Codes are part of the
 * contract the renderer and the test-suite rely on; messages may be localized
 * by the renderer using the code.
 */

export type CoreErrorCode =
  // Generic / transport
  | 'INTERNAL_ERROR'
  | 'UNSUPPORTED_OPERATION'
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNAUTHORIZED'
  | 'UNIMPLEMENTED'
  // Provider / credentials
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_NO_DEFAULT'
  | 'PROVIDER_DISABLED'
  | 'PROVIDER_NO_MODEL'
  | 'PROVIDER_SECRET_MISSING'
  | 'PROVIDER_SECRET_UNAVAILABLE'
  | 'PROVIDER_SECRET_WRITE_FAILED'
  | 'PROVIDER_VALIDATION_FAILED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_TLS_ERROR'
  | 'PROVIDER_NETWORK_ERROR'
  | 'PROVIDER_AUTH_FAILED'
  | 'OAUTH_UNSUPPORTED'
  // Agent
  | 'AGENT_NOT_FOUND'
  | 'AGENT_DEFAULT_PROTECTED'
  // Skill
  | 'SKILL_NOT_FOUND'
  | 'SKILL_INVALID_MANIFEST'
  | 'SKILL_PATH_ESCAPE'
  | 'SKILL_BUNDLED_PROTECTED'
  // Artifact
  | 'ARTIFACT_NOT_FOUND'
  | 'ARTIFACT_TOO_LARGE'
  | 'ARTIFACT_MIME_REJECTED'
  | 'ARTIFACT_PATH_REJECTED'
  | 'ARTIFACT_QUOTA_EXCEEDED'
  // Channel
  | 'CHANNEL_UNKNOWN_ADAPTER'
  | 'CHANNEL_UNSUPPORTED_CAPABILITY'
  | 'CHANNEL_NOT_CONFIGURED'
  | 'CHANNEL_INVALID_CONFIG'
  | 'CHANNEL_SECRET_MISSING'
  | 'CHANNEL_SEND_FAILED'
  | 'CHANNEL_PAYLOAD_TOO_LARGE'
  // Run / tool
  | 'RUN_NOT_FOUND'
  | 'RUN_INVALID_TRANSITION'
  | 'RUN_INTERRUPTED'
  | 'RUN_BUDGET_EXCEEDED'
  | 'TOOL_UNKNOWN'
  | 'TOOL_NOT_PENDING'
  | 'TOOL_DENIED'
  | 'TOOL_ARGUMENTS_INVALID'
  | 'TOOL_POLICY_REJECTED'
  | 'TOOL_EXECUTION_FAILED'
  // Cron
  | 'CRON_EXPRESSION_INVALID'
  | 'CRON_NOT_FOUND'
  // Memory / context
  | 'MEMORY_NOT_FOUND';

export class CoreError extends Error {
  readonly code: CoreErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: CoreErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'CoreError';
    this.code = code;
    // Drop stack frames that might carry arguments in some runtimes.
    if (Error.captureStackTrace) Error.captureStackTrace(this, CoreError);
    this.details = details;
  }

  /** Wire-safe, stable serialization: `CODE: message` (never contains secrets). */
  toString(): string {
    return `${this.code}: ${this.message}`;
  }
}

export function fail(code: CoreErrorCode, message: string, details?: Record<string, unknown>): never {
  throw new CoreError(code, message, details);
}

/** Wrap an unknown thrown value into a CoreError without leaking secrets. */
export function toCoreError(error: unknown): CoreError {
  if (error instanceof CoreError) return error;
  if (error instanceof Error) {
    // Native bridge errors and fetch errors are mapped by call sites; here we
    // only preserve a generic message (no stack / headers / URLs with tokens).
    return new CoreError('INTERNAL_ERROR', sanitizeErrorMessage(error.message));
  }
  return new CoreError('INTERNAL_ERROR', 'Unexpected error');
}

/** Best-effort removal of anything that looks like a bearer token / key. */
export function sanitizeErrorMessage(input: string): string {
  return input
    .replace(/(bearer|token|api[_-]?key|authorization|secret|password)\s*[=:]\s*[^\s"']+/gi, '$1=<redacted>')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-<redacted>')
    .replace(/[?&](api[_-]?key|access[_-]?token|token)=([^\s"']+)/gi, '?$1=<redacted>');
}

export function isCoreError(error: unknown): error is CoreError {
  return error instanceof CoreError;
}
