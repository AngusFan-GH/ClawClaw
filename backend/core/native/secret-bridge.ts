/**
 * Native capability boundary for ClawCore.
 *
 * Secrets never touch SQLite, logs, run events, messages or renderer state.
 * They cross this single boundary to the OS keychain (Tauri `secret:*` native
 * commands -> keyring crate in src-tauri/src/native.rs). Tests inject a fake
 * in-memory bridge; production uses the framed native transport.
 */
import { nativeRequest } from '../../host/transport';

export interface SecretBridge {
  /** Returns the stored secret, or null when no entry exists. */
  get(account: string): Promise<string | null>;
  /** Persists the secret; throws a classified error when the keychain rejects it. */
  set(account: string, value: string): Promise<void>;
  /** Removes the secret; a missing entry is treated as success. */
  delete(account: string): Promise<void>;
}

export class NativeSecretBridge implements SecretBridge {
  async get(account: string): Promise<string | null> {
    const value = await nativeRequest<string | null>('secret:get', { account });
    return value === undefined ? null : value;
  }
  async set(account: string, value: string): Promise<void> {
    await nativeRequest('secret:set', { account, value });
  }
  async delete(account: string): Promise<void> {
    await nativeRequest('secret:delete', { account });
  }
}

/** Controllable in-memory keychain used by isolated tests and the smoke harness. */
export class FakeSecretBridge implements SecretBridge {
  readonly store = new Map<string, string>();
  failWith: Error | null = null;
  private getDenied = false;

  constructor(initial?: Record<string, string>) {
    if (initial) for (const [k, val] of Object.entries(initial)) this.store.set(k, val);
  }
  denyAccess(denied = true): this {
    this.getDenied = denied;
    return this;
  }
  async get(account: string): Promise<string | null> {
    if (this.failWith) throw this.failWith;
    if (this.getDenied) throw new Error('Keychain access denied (simulated)');
    return this.store.has(account) ? this.store.get(account)! : null;
  }
  async set(account: string, value: string): Promise<void> {
    if (this.failWith) throw this.failWith;
    if (this.getDenied) throw new Error('Keychain access denied (simulated)');
    this.store.set(account, value);
  }
  async delete(account: string): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.store.delete(account);
  }
}
