import { describe, expect, test } from 'vitest';
import { computeFingerprint } from '../lib/errorFingerprint';

describe('computeFingerprint', () => {
  test('does not put request-specific messages in metric dimensions', () => {
    const error = new Error('Page not found: /asset.js?request=unique-value');
    error.stack = 'Error: failed\n    at render (/app/server/render.ts:10:5)';

    const result = computeFingerprint(error, 'Error');

    expect(result).toEqual({
      fingerprint: 'Error:/app/server/render.ts',
      group: 'Error:/app/server/render.ts',
    });
  });
});
