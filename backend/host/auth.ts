import { randomBytes } from 'node:crypto';
// Never exposed to the WebView. Only the backend's internal HTTP proxy knows it.
export const hostApiToken = randomBytes(32).toString('hex');
