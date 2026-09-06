import type { App } from '../host/desktop';
import { setQuitting } from './app-state';

export function markAppQuitting(): void {
  setQuitting();
}

export function quitApp(targetApp: Pick<App, 'quit'>): void {
  markAppQuitting();
  targetApp.quit();
}

export function relaunchApp(targetApp: Pick<App, 'relaunch' | 'quit'>): void {
  markAppQuitting();
  targetApp.relaunch();
  targetApp.quit();
}
