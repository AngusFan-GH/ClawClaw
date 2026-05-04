const HOST_EVENT_TO_IPC_CHANNEL: Record<string, string> = {
  'gateway:status': 'gateway:status-changed',
  'gateway:error': 'gateway:error',
  'gateway:notification': 'gateway:notification',
  'gateway:chat-message': 'gateway:chat-message',
  'gateway:lifecycle': 'gateway:lifecycle-changed',
  'gateway:channel-status': 'gateway:channel-status',
  'gateway:exit': 'gateway:exit',
  'oauth:code': 'oauth:code',
  'oauth:success': 'oauth:success',
  'oauth:error': 'oauth:error',
  'channel:whatsapp-qr': 'channel:whatsapp-qr',
  'channel:whatsapp-success': 'channel:whatsapp-success',
  'channel:whatsapp-error': 'channel:whatsapp-error',
  'channel:wechat-qr': 'channel:wechat-qr',
  'channel:wechat-output': 'channel:wechat-output',
  'channel:wechat-success': 'channel:wechat-success',
  'channel:wechat-error': 'channel:wechat-error',
};

export function subscribeHostEvent<T = unknown>(
  eventName: string,
  handler: (payload: T) => void
): () => void {
  const ipc = window.electron?.ipcRenderer;
  const ipcChannel = HOST_EVENT_TO_IPC_CHANNEL[eventName];
  if (ipcChannel && ipc?.on && ipc?.off) {
    const listener = (payload: unknown) => {
      handler(payload as T);
    };
    const unsubscribe = ipc.on(ipcChannel, listener);
    if (typeof unsubscribe === 'function') {
      return unsubscribe;
    }
    return () => {
      ipc.off(ipcChannel, listener);
    };
  }

  console.warn(`[host-events] no IPC mapping for event "${eventName}"`);
  return () => {};
}
