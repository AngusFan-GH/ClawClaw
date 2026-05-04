/**
 * Build the external OpenClaw Control UI URL.
 *
 * OpenClaw imports one-time auth tokens from the URL fragment and strips them
 * after load. Query-string tokens are intentionally avoided.
 */
export function buildOpenClawControlUiUrl(port: number, token: string): string {
  const url = new URL(`http://127.0.0.1:${port}/`);
  const trimmedToken = token.trim();

  if (trimmedToken) {
    url.hash = new URLSearchParams({ token: trimmedToken }).toString();
  }

  return url.toString();
}
