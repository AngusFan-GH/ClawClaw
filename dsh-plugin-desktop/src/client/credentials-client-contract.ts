/** Client-visible credential Remote contract omitted from the pinned upstream assembly. */
import type { CredentialInfo } from '@deepseek-ai/dsh-credentials/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-api-gateway/client' {
  interface ClientRemote {
    credentials: {
      describe(refs: readonly string[]): Promise<RemoteResult<Record<string, CredentialInfo>>>
      set(ref: string, value: string): Promise<RemoteResult<void>>
      unset(ref: string): Promise<RemoteResult<void>>
    }
  }
}
