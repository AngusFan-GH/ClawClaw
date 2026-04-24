import { describe, expect, it } from 'vitest';
import {
  getPortableManifestName,
  getPortableManifestUrl,
  PORTABLE_UPDATE_BASE_URL,
  UPDATE_FEEDS,
} from '@electron/shared/update-feed';

describe('update feed helpers', () => {
  it('keeps installed update feed on the stable latest.yml base URL', () => {
    expect(UPDATE_FEEDS.stable.url).toBe('https://clawclaw.xzinfra.com/updates/stable');
  });

  it('builds portable manifest names and URLs per platform target', () => {
    expect(getPortableManifestName('win32-x64')).toBe('win32-x64.json');
    expect(getPortableManifestUrl('stable', 'darwin-arm64')).toBe(
      `${PORTABLE_UPDATE_BASE_URL}/stable/darwin-arm64.json`,
    );
  });
});
