/**
 * Use Electron's network stack when available so requests honor
 * session.defaultSession.setProxy(...). Fall back to the Node global fetch
 * for non-Electron test environments.
 */

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1'
    || hostname === 'localhost'
    || hostname === '::1'
    || hostname === '[::1]';
}

function shouldBypassElectronProxy(input: string | URL): boolean {
  try {
    const url = input instanceof URL ? input : new URL(input);
    return isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

export async function proxyAwareFetch(
  input: string | URL,
  init?: RequestInit
): Promise<Response> {
  if (shouldBypassElectronProxy(input)) {
    return await fetch(input, init);
  }

  if (process.versions.electron) {
    try {
      const { net } = await import('electron');
      return await net.fetch(input, init);
    } catch {
      // Fall through to the global fetch.
    }
  }

  return await fetch(input, init);
}
