/**
 * Cron State Store
 * Manages scheduled task state
 */
import { create } from 'zustand';
import { invokeIpc } from '@/lib/api-client';
import { useChatStore } from './chat';
import type { CronJob, CronJobCreateInput, CronJobUpdateInput } from '../types/cron';

interface CronState {
  jobs: CronJob[];
  loading: boolean;
  error: string | null;
  
  // Actions
  fetchJobs: () => Promise<void>;
  createJob: (input: CronJobCreateInput) => Promise<CronJob>;
  updateJob: (id: string, input: CronJobUpdateInput) => Promise<void>;
  deleteJob: (id: string) => Promise<void>;
  toggleJob: (id: string, enabled: boolean) => Promise<void>;
  triggerJob: (id: string) => Promise<void>;
  setJobs: (jobs: CronJob[]) => void;
}

let fetchJobsInFlight: Promise<CronJob[]> | null = null;

function fetchCronJobs(): Promise<CronJob[]> {
  if (!fetchJobsInFlight) {
    fetchJobsInFlight = invokeIpc<CronJob[]>('cron:list')
      .finally(() => {
        fetchJobsInFlight = null;
      });
  }
  return fetchJobsInFlight;
}

export const useCronStore = create<CronState>((set) => ({
  jobs: [],
  loading: false,
  error: null,
  
  fetchJobs: async () => {
    const currentJobs = useCronStore.getState().jobs;
    if (currentJobs.length === 0) {
      set({ loading: true, error: null });
    } else {
      set({ error: null });
    }
    
    try {
      const result = await fetchCronJobs();
      const resultIds = new Set(result.map((job) => job.id));
      const extraJobs = currentJobs.filter((job) => !resultIds.has(job.id));
      set({ jobs: [...result, ...extraJobs], loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },
  
  createJob: async (input) => {
    try {
      const agentId = input.agentId ?? useChatStore.getState().currentAgentId;
      const job = await invokeIpc<CronJob>('cron:save', { ...input, agentId });
      set((state) => ({ jobs: [...state.jobs, job] }));
      return job;
    } catch (error) {
      console.error('Failed to create cron job:', error);
      throw error;
    }
  },
  
  updateJob: async (id, input) => {
    try {
      const existing = useCronStore.getState().jobs.find((job) => job.id === id);
      if (!existing) throw new Error('Cron job not found');
      const updatedJob = await invokeIpc<CronJob>('cron:save', { ...existing, ...input, id });
      set((state) => ({
        jobs: state.jobs.map((job) =>
          job.id === id ? updatedJob : job
        ),
      }));
    } catch (error) {
      console.error('Failed to update cron job:', error);
      throw error;
    }
  },
  
  deleteJob: async (id) => {
    try {
      await invokeIpc('cron:delete', id);
      set((state) => ({
        jobs: state.jobs.filter((job) => job.id !== id),
      }));
    } catch (error) {
      console.error('Failed to delete cron job:', error);
      throw error;
    }
  },
  
  toggleJob: async (id, enabled) => {
    try {
      const existing = useCronStore.getState().jobs.find((job) => job.id === id);
      if (!existing) throw new Error('Cron job not found');
      const updatedJob = await invokeIpc<CronJob>('cron:save', { ...existing, enabled, id });
      set((state) => ({
        jobs: state.jobs.map((job) =>
          job.id === id ? updatedJob : job
        ),
      }));
    } catch (error) {
      console.error('Failed to toggle cron job:', error);
      throw error;
    }
  },
  
  triggerJob: async (id) => {
    try {
      await invokeIpc('cron:trigger', id);
      // Refresh jobs after trigger to update lastRun/nextRun state
      try {
        const jobs = await fetchCronJobs();
        set({ jobs });
      } catch {
        // Ignore refresh error
      }
    } catch (error) {
      console.error('Failed to trigger cron job:', error);
      throw error;
    }
  },
  
  setJobs: (jobs) => set({ jobs }),
}));
