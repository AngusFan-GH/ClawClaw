import { describe, expect, it } from 'vitest';
import { buildOpenClawControlUiUrl } from '../../backend/utils/openclaw-control-ui';

describe('buildOpenClawControlUiUrl', () => {
  it('uses the URL fragment for auth token import', () => {
    expect(buildOpenClawControlUiUrl(18789, 'secret-token')).toBe(
      'http://127.0.0.1:18789/#token=secret-token',
    );
  });

  it('omits the fragment when the token is blank', () => {
    expect(buildOpenClawControlUiUrl(18789, '  ')).toBe('http://127.0.0.1:18789/');
  });

  it('supports opening the dreams control UI view', () => {
    expect(buildOpenClawControlUiUrl(18789, 'secret-token', { view: 'dreams' })).toBe(
      'http://127.0.0.1:18789/dreaming#token=secret-token',
    );
  });
});
