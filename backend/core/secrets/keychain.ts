/**
 * Keychain access for ClawCore.
 *
 * Account names are stable and namespaced so that rename/delete/import/migration
 * can deterministically clear stale entries. Every write is verified by reading
 * the value back before the caller is allowed to mark `has_secret = 1`.
 * Nothing here ever logs the secret value.
 */
import { timingSafeEqual } from 'node:crypto';
import { CoreError } from '../errors';
import type { SecretBridge } from '../native/secret-bridge';

export const providerAccount = (workspaceId: string, providerId: string): string =>
  `provider:${workspaceId}:${providerId}`;

export const channelAccount = (workspaceId: string, accountId: string): string =>
  `channel:${workspaceId}:${accountId}`;

export class Keychain {
  constructor(private readonly bridge: SecretBridge) {}

  /** Persist + read back. Throws PROVIDER_SECRET_WRITE_FAILED unless verified. */
  async put(account: string, value: string): Promise<void> {
    if (typeof value !== 'string' || value.length === 0) {
      throw new CoreError('INVALID_ARGUMENT', 'Secret value must be a non-empty string');
    }
    try {
      await this.bridge.set(account, value);
    } catch (error) {
      throw new CoreError('PROVIDER_SECRET_WRITE_FAILED', 'Unable to store the credential in the OS keychain', {
        reason: safeReason(error),
      });
    }
    let readback: string | null;
    try {
      readback = await this.bridge.get(account);
    } catch (error) {
      // Written but unreadable: surface the failure and leave has_secret unset.
      throw new CoreError('PROVIDER_SECRET_UNAVAILABLE', 'Credential was stored but cannot be read back', {
        reason: safeReason(error),
      });
    }
    if (readback === null || !constantTimeEqual(readback, value)) {
      // Best-effort cleanup of the unverified entry.
      await this.bridge.delete(account).catch(() => undefined);
      throw new CoreError('PROVIDER_SECRET_WRITE_FAILED', 'Credential could not be verified after saving');
    }
  }

  /** Returns the secret or null when absent; maps keychain failures to codes. */
  async get(account: string): Promise<string | null> {
    try {
      return await this.bridge.get(account);
    } catch (error) {
      const reason = safeReason(error).toLowerCase();
      if (reason.includes('denied') || reason.includes('permission') || reason.includes('access')) {
        throw new CoreError('PROVIDER_SECRET_UNAVAILABLE', 'OS keychain access was denied');
      }
      throw new CoreError('PROVIDER_SECRET_UNAVAILABLE', 'OS keychain is unavailable', { reason: safeReason(error) });
    }
  }

  async remove(account: string): Promise<void> {
    try {
      await this.bridge.delete(account);
    } catch (error) {
      // A missing entry is success; other failures are actionable.
      if (!/no ?entry|not found/i.test(safeReason(error))) {
        throw new CoreError('PROVIDER_SECRET_UNAVAILABLE', 'Unable to delete the credential from the OS keychain', {
          reason: safeReason(error),
        });
      }
    }
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Strip secret material and stack paths from a native error message. */
function safeReason(error: unknown): string {
  if (error instanceof CoreError) return error.code;
  if (error instanceof Error) return error.message.split('\n')[0].slice(0, 200);
  return 'unknown';
}
