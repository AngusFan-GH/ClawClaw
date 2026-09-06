import type { RunStatus } from './contracts';

const TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ['preparing', 'cancelled', 'failed'],
  preparing: ['streaming', 'stopping', 'cancelled', 'failed'],
  streaming: ['waiting_for_approval', 'stopping', 'completed', 'failed', 'cancelled'],
  waiting_for_approval: ['streaming', 'stopping', 'failed', 'cancelled'],
  stopping: ['cancelled', 'completed', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) {
    throw new Error(`Invalid run state transition: ${from} -> ${to}`);
  }
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
