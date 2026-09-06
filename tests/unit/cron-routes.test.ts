import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const readFileMock = vi.fn();
const sendJsonMock = vi.fn();

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
  default: {
    readFile: (...args: unknown[]) => readFileMock(...args),
  },
}));

vi.mock('@backend/utils/paths', () => ({
  getOpenClawConfigDir: () => '/tmp/openclaw',
}));

vi.mock('@backend/utils/agent-config', () => ({
  listAgentsSnapshot: vi.fn(),
}));

vi.mock('@backend/api/route-utils', () => ({
  parseJsonBody: vi.fn(),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('handleCronRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('falls back to local run logs for cron session history when transcript is unavailable', async () => {
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/cron/runs/job-1.jsonl')) {
        return `${JSON.stringify({
          jobId: 'job-1',
          action: 'finished',
          status: 'ok',
          summary: 'Reminder delivered.',
          ts: 1_713_386_400_000,
          durationMs: 1250,
          sessionKey: 'agent:main:cron:job-1',
        })}\n`;
      }
      if (path.endsWith('/agents/main/sessions/sessions.json')) {
        return JSON.stringify({
          'agent:main:cron:job-1': {
            label: 'Cron: Every 10 minutes',
            updatedAt: 1_713_386_400_000,
          },
        });
      }
      return '';
    });

    const { handleCronRoutes } = await import('@backend/api/routes/cron');

    const handled = await handleCronRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/cron/session-history?sessionKey=agent:main:cron:job-1&limit=10'),
      {
        gatewayManager: {
          rpc: vi.fn().mockRejectedValue(new Error('gateway unavailable')),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('Scheduled task: Every 10 minutes'),
          }),
          expect.objectContaining({
            role: 'assistant',
            content: expect.stringContaining('Reminder delivered.'),
          }),
        ],
      }),
    );
  });
});
