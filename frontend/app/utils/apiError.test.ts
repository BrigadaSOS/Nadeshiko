import { describe, expect, it } from 'vitest';
import { apiErrorStatus } from './apiError';

/**
 * The case that matters is the last one. `apiErrorStatus` exists because
 * `instanceof NadeshikoError` is unreliable across the SSR boundary, so the
 * regression to guard against is someone "tidying" this back into a class
 * check -- which passes every unit test written against a real SDK error and
 * fails only in production, on the server, for pages that do not exist.
 */
describe('apiErrorStatus', () => {
  it('reads the status the SDK sets on its errors', () => {
    const err = Object.assign(new Error('Segment not found'), { status: 404 });
    expect(apiErrorStatus(err)).toBe(404);
  });

  it('reads statusCode, which is what h3 and $fetch use', () => {
    expect(apiErrorStatus({ statusCode: 404 })).toBe(404);
  });

  it('prefers status when both are present', () => {
    expect(apiErrorStatus({ status: 404, statusCode: 500 })).toBe(404);
  });

  it('returns undefined when there is no status to read', () => {
    // A call that never landed -- a network drop or an abort -- is not a 404 and
    // must stay distinguishable from one, or every outage renders as "this
    // sentence does not exist".
    expect(apiErrorStatus(new Error('fetch failed'))).toBeUndefined();
    expect(apiErrorStatus(null)).toBeUndefined();
    expect(apiErrorStatus(undefined)).toBeUndefined();
    expect(apiErrorStatus('404')).toBeUndefined();
    expect(apiErrorStatus({ status: '404' })).toBeUndefined();
  });

  it('identifies a plain object carrying the shape, without any class involved', () => {
    // Precisely the case a class check fails: same data, different realm, no
    // shared prototype.
    const acrossBundles = JSON.parse(JSON.stringify({ status: 404, code: 'NOT_FOUND' }));
    expect(apiErrorStatus(acrossBundles)).toBe(404);
  });
});
