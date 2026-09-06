import { describe, expect, it } from 'vitest';
import { classifyOpenClawDoctorResult } from '@backend/utils/openclaw-doctor';

describe('classifyOpenClawDoctorResult', () => {
  it('marks a clean exit as success', () => {
    expect(
      classifyOpenClawDoctorResult({
        exitCode: 0,
        stderr: '',
      }),
    ).toEqual({
      status: 'success',
      success: true,
      warnings: [],
    });
  });

  it('marks stderr on exit code 0 as success_with_warnings', () => {
    expect(
      classifyOpenClawDoctorResult({
        exitCode: 0,
        stderr: 'Failed to install bundled plugin runtime deps: Error: npm install failed\n',
      }),
    ).toEqual({
      status: 'success_with_warnings',
      success: true,
      warnings: ['Failed to install bundled plugin runtime deps: Error: npm install failed'],
    });
  });

  it('marks non-zero exit as failed', () => {
    expect(
      classifyOpenClawDoctorResult({
        exitCode: 1,
        stderr: 'config invalid',
      }),
    ).toEqual({
      status: 'failed',
      success: false,
      warnings: [],
    });
  });
});
