import {
  captureApiActiveDay,
  captureApiKeyCreated,
  resetAnalyticsClientForTests,
} from '@app/services/analytics/posthog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two server-side events that make API users visible.
 *
 * They exist because an API reader is invisible to every browser event the
 * product has: no pageview, no search, no playback. Without these, the segment
 * shows up in every activation and retention figure as a failed signup.
 *
 * `posthog-node` is mocked rather than the analytics module, because what these
 * tests are about IS the capture payload -- the distinct id it keys on, and the
 * dedupe that decides whether a second call sends anything at all.
 */
const capture = vi.fn();

vi.mock('posthog-node', () => ({
  PostHog: class {
    capture = capture;
    shutdown = async () => {};
  },
}));

vi.mock('@config/config', () => ({
  config: { POSTHOG_API_KEY: 'phc_test', POSTHOG_HOST: 'https://example.test' },
}));

beforeEach(() => {
  capture.mockClear();
  resetAnalyticsClientForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('captureApiKeyCreated', () => {
  it('keys on the numeric account id the browser also identifies with', () => {
    // The whole point of a server-side event: it has to land on the same PostHog
    // person as the reader's own pageviews, or it answers nothing.
    captureApiKeyCreated({ userId: 651, scopes: ['SEARCH'] });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]?.[0]).toMatchObject({
      distinctId: '651',
      event: 'api_key_created',
    });
  });

  it('marks the person so later questions can be split by it without re-deriving the segment', () => {
    captureApiKeyCreated({ userId: 651, scopes: ['SEARCH', 'ADD_MEDIA'] });

    const properties = capture.mock.calls[0]?.[0].properties;
    expect(properties.scopes).toEqual(['SEARCH', 'ADD_MEDIA']);
    expect(properties.scope_count).toBe(2);
    expect(properties.$set).toEqual({ has_api_key: true });
    expect(properties.$set_once.first_api_key_at).toEqual(expect.any(String));
  });

  it('sends no key name, which is the one free-text field a caller controls', () => {
    captureApiKeyCreated({ userId: 651, scopes: ['SEARCH'] });

    expect(JSON.stringify(capture.mock.calls[0]?.[0])).not.toContain('name');
  });
});

describe('captureApiActiveDay', () => {
  it('reports the first call of the day, carrying month-to-date consumption', () => {
    captureApiActiveDay({ userId: 651, quotaUsed: 120, quotaLimit: 5000 });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]?.[0]).toMatchObject({
      distinctId: '651',
      event: 'api_active_day',
    });
    expect(capture.mock.calls[0]?.[0].properties).toMatchObject({ quota_used: 120, quota_limit: 5000 });
  });

  it('stays silent for the rest of that account’s day', () => {
    // The reason the event is affordable at all. An account inside its quota can
    // make 5,000 calls a month; per-request capture would be the largest series
    // in the project.
    captureApiActiveDay({ userId: 651, quotaUsed: 1, quotaLimit: 5000 });
    captureApiActiveDay({ userId: 651, quotaUsed: 2, quotaLimit: 5000 });
    captureApiActiveDay({ userId: 651, quotaUsed: 900, quotaLimit: 5000 });

    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('does not let one account silence another', () => {
    captureApiActiveDay({ userId: 651, quotaUsed: 1, quotaLimit: 5000 });
    captureApiActiveDay({ userId: 652, quotaUsed: 1, quotaLimit: 5000 });

    expect(capture).toHaveBeenCalledTimes(2);
  });

  it('reports again once the UTC day rolls over', () => {
    // Day boundaries are the grain of the series, so this is the one piece of
    // behaviour a reader of a daily-actives chart is actually relying on.
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-08-24T23:59:59.000Z'));
    captureApiActiveDay({ userId: 651, quotaUsed: 1, quotaLimit: 5000 });

    vi.setSystemTime(new Date('2026-08-25T00:00:01.000Z'));
    captureApiActiveDay({ userId: 651, quotaUsed: 2, quotaLimit: 5000 });

    expect(capture).toHaveBeenCalledTimes(2);
  });
});
