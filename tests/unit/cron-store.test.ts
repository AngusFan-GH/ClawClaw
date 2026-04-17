import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const getChatStateMock = vi.fn(() => ({ currentAgentId: 'agent-main' }));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: {
    getState: () => getChatStateMock(),
  },
}));

describe('cron store', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('preserves stale jobs when fetching fewer jobs from gateway', async () => {
    hostApiFetchMock.mockResolvedValueOnce([
      {
        id: 'job-1',
        name: 'Daily',
        message: 'Run daily task',
        schedule: '0 9 * * *',
        enabled: true,
        createdAt: '2026-04-17T00:00:00.000Z',
        updatedAt: '2026-04-17T00:00:00.000Z',
      },
    ]);

    const { useCronStore } = await import('@/stores/cron');
    useCronStore.getState().setJobs([
      {
        id: 'job-1',
        name: 'Daily',
        message: 'Run daily task',
        schedule: '0 9 * * *',
        enabled: true,
        createdAt: '2026-04-17T00:00:00.000Z',
        updatedAt: '2026-04-17T00:00:00.000Z',
      },
      {
        id: 'job-2',
        name: 'Weekly',
        message: 'Run weekly task',
        schedule: '0 9 * * 1',
        enabled: true,
        createdAt: '2026-04-17T00:00:00.000Z',
        updatedAt: '2026-04-17T00:00:00.000Z',
      },
    ]);

    await useCronStore.getState().fetchJobs();

    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/cron/jobs');
    expect(useCronStore.getState().jobs.map((job) => job.id)).toEqual(['job-1', 'job-2']);
  });

  it('auto-injects current agent id when creating a job', async () => {
    hostApiFetchMock.mockResolvedValueOnce({
      id: 'job-3',
      agentId: 'agent-main',
      name: 'Hourly',
      message: 'Run hourly task',
      schedule: '0 * * * *',
      enabled: true,
      createdAt: '2026-04-17T00:00:00.000Z',
      updatedAt: '2026-04-17T00:00:00.000Z',
    });

    const { useCronStore } = await import('@/stores/cron');
    await useCronStore.getState().createJob({
      name: 'Hourly',
      message: 'Run hourly task',
      schedule: '0 * * * *',
    });

    expect(hostApiFetchMock).toHaveBeenCalledWith(
      '/api/cron/jobs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Hourly',
          message: 'Run hourly task',
          schedule: '0 * * * *',
          agentId: 'agent-main',
        }),
      }),
    );
  });

  it('uses the server-returned job on update', async () => {
    hostApiFetchMock.mockResolvedValueOnce({
      id: 'job-1',
      agentId: 'agent-sales',
      agentName: 'Sales',
      name: 'Updated name',
      message: 'Updated message',
      schedule: { kind: 'cron', expr: '0 18 * * *' },
      enabled: false,
      createdAt: '2026-04-17T00:00:00.000Z',
      updatedAt: '2026-04-17T01:00:00.000Z',
    });

    const { useCronStore } = await import('@/stores/cron');
    useCronStore.getState().setJobs([
      {
        id: 'job-1',
        name: 'Old name',
        message: 'Old message',
        schedule: '0 9 * * *',
        enabled: true,
        createdAt: '2026-04-17T00:00:00.000Z',
        updatedAt: '2026-04-17T00:00:00.000Z',
      },
    ]);

    await useCronStore.getState().updateJob('job-1', { name: 'Updated name', enabled: false });

    expect(hostApiFetchMock).toHaveBeenCalledWith(
      '/api/cron/jobs/job-1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ name: 'Updated name', enabled: false }),
      }),
    );
    expect(useCronStore.getState().jobs[0]).toMatchObject({
      id: 'job-1',
      agentId: 'agent-sales',
      agentName: 'Sales',
      name: 'Updated name',
      enabled: false,
      schedule: { kind: 'cron', expr: '0 18 * * *' },
    });
  });
});
