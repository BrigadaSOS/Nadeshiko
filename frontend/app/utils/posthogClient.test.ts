import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFERRED_CALL_LIMIT,
  _resetPostHogClientForTests,
  isAnalyticsEnabled,
  onPostHogReady,
  posthog,
  startPostHog,
} from './posthogClient';

/** Just the members the app calls, which is all the stub forwards. */
function fakeClient() {
  return {
    __loaded: true,
    capture: vi.fn(),
    captureException: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    set_config: vi.fn(),
    get_distinct_id: vi.fn(() => 'abc'),
    get_session_id: vi.fn(() => 'sess'),
    get_property: vi.fn(() => 'identified'),
    getFeatureFlag: vi.fn(),
  };
}

/** Loads a client and lets the promise chain in `startPostHog` settle. */
async function load(client: unknown) {
  startPostHog(async () => client as never);
  await vi.waitFor(() => expect(posthog.__loaded).toBe(true));
}

beforeEach(() => {
  _resetPostHogClientForTests();
  vi.stubGlobal('window', { location: { href: 'https://nadeshiko.co/en/search/x', pathname: '/en/search/x' } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('before anything starts the client', () => {
  it('reports analytics as absent and drops calls instead of queueing them', async () => {
    expect(isAnalyticsEnabled()).toBe(false);

    posthog.capture('never_sent');
    posthog.captureException(new Error('nowhere to go'));

    // Nothing is holding these: the build has no SDK coming, so a queue would
    // only grow for the life of the page. Starting one afterwards must not
    // resurrect them.
    const client = fakeClient();
    await load(client);
    expect(client.capture).not.toHaveBeenCalled();
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it('runs no ready callbacks', () => {
    const callback = vi.fn();
    onPostHogReady(callback);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('while the client is loading', () => {
  let resolveLoad: (client: unknown) => void;

  beforeEach(() => {
    startPostHog(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve as (client: unknown) => void;
        }),
    );
  });

  it('counts as enabled the moment the load starts, not when it finishes', () => {
    expect(isAnalyticsEnabled()).toBe(true);
    expect(posthog.__loaded).toBe(false);
  });

  it('replays captures in the order they were made', async () => {
    posthog.identify('user-1');
    posthog.capture('first');
    posthog.capture('second');

    const client = fakeClient();
    resolveLoad(client);
    await vi.waitFor(() => expect(client.capture).toHaveBeenCalledTimes(2));

    // `identify` before the captures, or the events land on the anonymous person
    // and the browser's history is stranded rather than merged.
    expect(Math.min(...client.capture.mock.invocationCallOrder)).toBeGreaterThan(
      Math.max(...client.identify.mock.invocationCallOrder),
    );
    expect(client.capture.mock.calls[0]?.[0]).toBe('first');
    expect(client.capture.mock.calls[1]?.[0]).toBe('second');
  });

  it('stamps the page a capture was made on, so a replay cannot misattribute it', async () => {
    posthog.capture('page_engaged');

    const client = fakeClient();
    resolveLoad(client);
    await vi.waitFor(() => expect(client.capture).toHaveBeenCalled());

    expect(client.capture.mock.calls[0]?.[1]).toMatchObject({
      $current_url: 'https://nadeshiko.co/en/search/x',
      $pathname: '/en/search/x',
    });
  });

  it('stamps the time a capture was made, not the time the queue drained', async () => {
    posthog.capture('page_engaged');

    const client = fakeClient();
    resolveLoad(client);
    await vi.waitFor(() => expect(client.capture).toHaveBeenCalled());

    expect(client.capture.mock.calls[0]?.[2]?.timestamp).toBeInstanceOf(Date);
  });

  it("lets a caller's own timestamp win over the queued one", async () => {
    const own = new Date('2026-08-23T00:00:00.000Z');
    posthog.capture('page_engaged', {}, { timestamp: own });

    const client = fakeClient();
    resolveLoad(client);
    await vi.waitFor(() => expect(client.capture).toHaveBeenCalled());

    expect(client.capture.mock.calls[0]?.[2]?.timestamp).toBe(own);
  });

  it('delivers exceptions captured before the SDK arrived', async () => {
    const error = new Error('thrown during hydration');
    posthog.captureException(error, { error_source: 'player:audio-play-failed' });

    const client = fakeClient();
    resolveLoad(client);
    await vi.waitFor(() => expect(client.captureException).toHaveBeenCalled());

    expect(client.captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ error_source: 'player:audio-play-failed' }),
    );
  });

  it('answers undefined to reads, which cannot be deferred', () => {
    expect(posthog.get_distinct_id()).toBeUndefined();
    expect(posthog.get_session_id()).toBeUndefined();
    expect(posthog.get_property('$user_state')).toBeUndefined();
  });

  it('queues a member the stub does not implement rather than throwing', async () => {
    expect(() => posthog.getFeatureFlag('some-flag')).not.toThrow();

    const client = fakeClient();
    resolveLoad(client);
    await vi.waitFor(() => expect(client.getFeatureFlag).toHaveBeenCalledWith('some-flag'));
  });

  it('stops queueing at the limit and reports the overflow once the SDK is up', async () => {
    for (let i = 0; i < DEFERRED_CALL_LIMIT + 5; i += 1) posthog.capture(`event_${i}`);

    const client = fakeClient();
    resolveLoad(client);
    await vi.waitFor(() => expect(client.capture).toHaveBeenCalledTimes(DEFERRED_CALL_LIMIT + 1));

    expect(client.capture).toHaveBeenLastCalledWith('analytics_deferred_overflow', { dropped: 5 });
  });

  it('drains the rest of the queue when one replayed call throws', async () => {
    posthog.capture('explodes');
    posthog.capture('still_sent');

    const client = fakeClient();
    client.capture.mockImplementationOnce(() => {
      throw new Error('capture blew up');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    resolveLoad(client);
    await vi.waitFor(() => expect(client.capture).toHaveBeenCalledTimes(2));
    expect(client.capture.mock.calls[1]?.[0]).toBe('still_sent');
  });
});

describe('once the client has arrived', () => {
  it('forwards straight through, so a reference taken earlier gets the real API', async () => {
    const client = fakeClient();
    await load(client);

    // Untouched: no page snapshot, no timestamp, not even the padding arguments
    // the stub adds. Past this point the app is talking to posthog-js directly.
    posthog.capture('live');
    expect(client.capture).toHaveBeenCalledWith('live');
    expect(posthog.get_distinct_id()).toBe('abc');
    expect(posthog.get_session_id()).toBe('sess');
    expect(posthog.get_property('$user_state')).toBe('identified');
  });

  it('runs a ready callback immediately', async () => {
    const client = fakeClient();
    await load(client);

    const callback = vi.fn();
    onPostHogReady(callback);
    expect(callback).toHaveBeenCalledWith(client);
  });

  it('ignores a second start', async () => {
    const client = fakeClient();
    await load(client);

    const second = vi.fn();
    startPostHog(second);
    expect(second).not.toHaveBeenCalled();
  });
});

describe('when the client never arrives', () => {
  it('releases the queue on a rejection rather than holding it for the page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let rejectLoad: (reason: unknown) => void = () => {};
    startPostHog(() => new Promise((_resolve, reject) => (rejectLoad = reject)));

    posthog.capture('lost');
    const ready = vi.fn();
    onPostHogReady(ready);

    rejectLoad(new Error('chunk 404 after a deploy'));
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());

    expect(ready).not.toHaveBeenCalled();
    expect(posthog.__loaded).toBe(false);
  });

  it('treats a null client the same as a failure', async () => {
    startPostHog(async () => null);
    const ready = vi.fn();
    onPostHogReady(ready);

    await vi.waitFor(() => expect(isAnalyticsEnabled()).toBe(true));
    expect(ready).not.toHaveBeenCalled();
    expect(posthog.__loaded).toBe(false);
  });
});
