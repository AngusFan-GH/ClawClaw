import { describe, expect, it } from 'vitest';
import { UPDATE_FEEDS } from '@backend/shared/update-feed';

describe('update feed helpers', () => {
  it('keeps installed update feed on the stable latest.yml base URL', () => {
    expect(UPDATE_FEEDS.stable.url).toBe('https://clawclaw.xzinfra.com/updates/stable');
  });
});
