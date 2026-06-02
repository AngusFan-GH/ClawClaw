import { hostApiFetch } from '@/lib/host-api';
import type { RawMessage } from '@/stores/chat';

export async function loadSessionTranscriptFallback(
  sessionKey: string,
  limit = 200,
  mode: 'recent' | 'head' = 'recent',
): Promise<RawMessage[]> {
  try {
    const params = new URLSearchParams({ sessionKey, limit: String(limit), mode });
    const response = await hostApiFetch<{ messages?: RawMessage[] }>(
      `/api/sessions/transcript?${params.toString()}`,
    );
    return Array.isArray(response.messages) ? response.messages : [];
  } catch (error) {
    console.warn('[chat.history] transcript fallback failed:', error);
    return [];
  }
}
