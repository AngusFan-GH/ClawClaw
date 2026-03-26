/**
 * Build the external OpenClaw Control UI URL.
 *
 * OpenClaw 2026.3.13 imports one-time auth tokens from the URL fragment
 * (`#token=...`) and strips them after load. Query-string tokens are kept
 * only as a legacy fallback by the UI bootstrap and should not be emitted
 * by new hosts.
 */
export function buildOpenClawControlUiUrl(port: number, token: string): string {
  const url = new URL(`http://127.0.0.1:${port}/`);
  const trimmedToken = token.trim();

  if (trimmedToken) {
    url.hash = new URLSearchParams({ token: trimmedToken }).toString();
  }

  return url.toString();
}
