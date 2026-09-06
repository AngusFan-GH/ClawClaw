import { EnvHttpProxyAgent, fetch as nodeFetch } from 'undici';
let dispatcher: EnvHttpProxyAgent | undefined;
export function configureProxyFetch(env: Record<string, string>): void {
  const previous = dispatcher;
  dispatcher = new EnvHttpProxyAgent({ httpProxy: env.HTTP_PROXY || '', httpsProxy: env.HTTPS_PROXY || '', noProxy: env.NO_PROXY || 'localhost,127.0.0.1,::1' });
  void previous?.close();
}
export async function proxyAwareFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const hostname = new URL(input).hostname;
  if (!dispatcher || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) return fetch(input, init);
  return await nodeFetch(input, { ...init, dispatcher } as Parameters<typeof nodeFetch>[1]) as unknown as Response;
}
