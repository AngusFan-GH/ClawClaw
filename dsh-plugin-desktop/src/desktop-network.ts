/** Desktop ordinary-browser access and listener exposure preferences. */

import type { Config as WebServerConfig } from '@deepseek-ai/dsh-host-webserver'
/** Legacy listener scope retained only while old settings are migrated. */
export type DesktopNetworkExposure = 'loopback' | 'lan'

/**
 * Parse the browser-access preference.
 *
 * `openBrowser` is retained as the persisted key for compatibility. Desktop
 * never projects it into the upstream default-browser handoff.
 */
export function parseDesktopOpenBrowser(value: unknown): boolean {
  if (value === undefined) return false
  if (typeof value === 'boolean') return value
  throw new Error('dsh-plugin-desktop: dsh-desktop.openBrowser must be a boolean')
}

/** Parse the restart-applied listener exposure preference. */
export function parseDesktopNetworkExposure(value: unknown): DesktopNetworkExposure {
  if (value === undefined) return 'loopback'
  if (value === 'loopback' || value === 'lan') return value
  throw new Error('dsh-plugin-desktop: dsh-desktop.networkExposure must be "loopback" or "lan"')
}

/** The Desktop WebServer is always private to the local Electron application. */
export function desktopWebServerHost(_exposure: DesktopNetworkExposure): WebServerConfig['host'] {
  return '127.0.0.1'
}
