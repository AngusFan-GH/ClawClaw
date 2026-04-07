import type { BrowserWindow } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import type { GatewayApplyCoordinator } from '../gateway/apply-coordinator';
import type { ClawHubService } from '../gateway/clawhub';
import type { HostEventBus } from './event-bus';

export interface HostApiContext {
  gatewayManager: GatewayManager;
  gatewayApplyCoordinator: GatewayApplyCoordinator;
  clawHubService: ClawHubService;
  eventBus: HostEventBus;
  mainWindow: BrowserWindow | null;
}
