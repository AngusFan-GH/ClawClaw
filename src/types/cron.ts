/**
 * Cron Job Type Definitions
 * Types for scheduled tasks
 */

import { ChannelType } from './channel';

/**
 * Cron job target (where to send the result)
 */
export interface CronJobTarget {
  channelType: ChannelType;
  channelId: string;
  channelName: string;
}

/**
 * Cron job last run info
 */
export interface CronJobLastRun {
  time: string;
  success: boolean;
  error?: string;
  duration?: number;
}

/**
 * Gateway CronSchedule object format
 */
export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string };

/**
 * Cron job data structure
 * schedule can be a plain cron string or a Gateway CronSchedule object
 */
export interface CronJob {
  id: string;
  agentId?: string;
  agentName?: string;
  name: string;
  message: string;
  schedule: string | CronSchedule;
  target?: CronJobTarget;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRun?: CronJobLastRun;
  nextRun?: string;
  kind?: string;
  uiManaged?: boolean;
  deliveryMode?: string;
  deliveryChannel?: string;
  deliveryTo?: string;
  sessionTarget?: string | null;
  readOnlyReason?: string;
}

/**
 * Input for creating a cron job from the UI.
 * No target/delivery — UI-created tasks push results to the ClawClaw chat page.
 * Tasks created via external channels are handled directly by the Gateway.
 */
export interface CronJobCreateInput {
  name: string;
  message: string;
  schedule: string;
  enabled?: boolean;
}

/**
 * Input for updating a cron job
 */
export interface CronJobUpdateInput {
  name?: string;
  message?: string;
  schedule?: string;
  enabled?: boolean;
  deliveryChannel?: string;
  deliveryTo?: string;
}

/**
 * Schedule type for UI picker
 */
export type ScheduleType = 'daily' | 'weekly' | 'monthly' | 'interval' | 'custom';
