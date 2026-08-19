import { describe, expect, it } from 'vitest';
import { apiErrorStatus, isMissing } from './apiError';

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

describe('isMissing', () => {
  it('treats 404 as no such thing', () => {
    expect(isMissing(404)).toBe(true);
  });

  it('treats 400 as no such thing, because the id never reached a lookup', () => {
    // The half that was missed. Public ids are ^[A-Za-z0-9_-]{12}$ and the API
    // rejects anything else before the handler runs, so /sentence/13123123123
    // came back 400 and the page rendered 500.
    expect(isMissing(400)).toBe(true);
  });

  it('leaves real faults alone', () => {
    for (const status of [500, 502, 503, 429, 403, 401, 200, undefined]) {
      expect(isMissing(status)).toBe(false);
    }
  });
});
