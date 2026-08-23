import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMediaSlugIndex, resolveMediaSlug } from './mediaSlugIndex';

/**
 * `useServerSdk` is a Nitro auto-import, so it is a bare global at runtime and
 * simply absent under vitest. Parking a stub on `globalThis` is the whole mock:
 * the module under test never imports it.
 */
type Catalogue = Array<{ slug?: string | null; publicId: string }>;

let build: ReturnType<typeof vi.fn>;

/** Installs a catalogue and returns the spy that counts full scans. */
function serveCatalogue(pages: () => Catalogue | Promise<Catalogue>) {
  build = vi.fn(async () => await pages());
  (globalThis as any).useServerSdk = () => ({
    listMedia: {
      paginate: () =>
        (async function* () {
          for (const media of await build()) yield media;
        })(),
    },
  });
  return build;
}

const TTL_MS = 60 * 60 * 1000;

/**
 * Flush the promise nobody awaited.
 *
 * `vi.advanceTimersByTimeAsync(0)` and not `vi.waitFor`: waitFor polls by
 * ADVANCING the fake clock, which silently moves `Date.now()` out from under a
 * test whose whole subject is a time-based cooldown. Zero drains the microtask
 * queue and leaves the clock where the test put it.
 */
async function settleBackgroundRebuild(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  resetMediaSlugIndex();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-23T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  (globalThis as any).useServerSdk = undefined;
});

describe('resolveMediaSlug', () => {
  it('resolves a slug to its publicId', async () => {
    serveCatalogue(() => [{ slug: 'yuru-camp', publicId: 'abcdefghijkl' }]);
    await expect(resolveMediaSlug('yuru-camp')).resolves.toBe('abcdefghijkl');
  });

  it('serves later calls from the index rather than rescanning', async () => {
    const scan = serveCatalogue(() => [{ slug: 'yuru-camp', publicId: 'abcdefghijkl' }]);
    await resolveMediaSlug('yuru-camp');
    await resolveMediaSlug('yuru-camp');
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it('skips titles with no slug', async () => {
    serveCatalogue(() => [{ slug: null, publicId: 'abcdefghijkl' }]);
    await expect(resolveMediaSlug('anything')).resolves.toBeNull();
  });

  /**
   * The reason this file exists. A rebuild is 7 sequential `GET /v1/media`
   * pages, ~740ms measured in production on 2026-08-23, and it used to be in
   * front of the render on every request that found the index expired.
   *
   * A build that never settles is the sharpest way to state "does not block":
   * if the caller waited on it, this test would time out rather than fail.
   */
  it('returns the expired index immediately instead of waiting for the rebuild', async () => {
    serveCatalogue(() => [{ slug: 'yuru-camp', publicId: 'abcdefghijkl' }]);
    await resolveMediaSlug('yuru-camp');

    // Past the hour, with a rebuild that will never come back.
    serveCatalogue(() => new Promise<Catalogue>(() => {}));
    vi.setSystemTime(Date.now() + TTL_MS + 1);

    await expect(resolveMediaSlug('yuru-camp')).resolves.toBe('abcdefghijkl');
  });

  it('picks up a title the background rebuild found', async () => {
    serveCatalogue(() => [{ slug: 'yuru-camp', publicId: 'abcdefghijkl' }]);
    await resolveMediaSlug('yuru-camp');

    const scan = serveCatalogue(() => [
      { slug: 'yuru-camp', publicId: 'abcdefghijkl' },
      { slug: 'sakura-quest', publicId: 'mnopqrstuvwx' },
    ]);
    vi.setSystemTime(Date.now() + TTL_MS + 1);

    // This one is served stale, and starts the rebuild.
    await resolveMediaSlug('yuru-camp');
    expect(scan).toHaveBeenCalledTimes(1);

    // Let the background build settle, then the new title is there.
    await settleBackgroundRebuild();
    await expect(resolveMediaSlug('sakura-quest')).resolves.toBe('mnopqrstuvwx');
  });

  /**
   * A dropped promise is a dead Nitro worker, so the background path swallows
   * and logs. The caller must not see the failure, and the previous index must
   * survive it -- stale-but-correct beats nothing at all.
   */
  it('survives a background rebuild that fails', async () => {
    serveCatalogue(() => [{ slug: 'yuru-camp', publicId: 'abcdefghijkl' }]);
    await resolveMediaSlug('yuru-camp');

    const scan = serveCatalogue(async () => {
      throw new Error('backend down');
    });
    vi.setSystemTime(Date.now() + TTL_MS + 1);

    await expect(resolveMediaSlug('yuru-camp')).resolves.toBe('abcdefghijkl');
    await settleBackgroundRebuild();
    expect(scan).toHaveBeenCalled();
    // Still served, and still from the index the failed rebuild did not replace.
    await expect(resolveMediaSlug('yuru-camp')).resolves.toBe('abcdefghijkl');
  });

  /**
   * Serving stale removed the brake that blocking used to provide: the caller
   * no longer waits, so nothing stops the next request starting another scan
   * against a backend that just failed. One attempt a minute, not one per
   * request.
   */
  it('does not restart a failed rebuild on every subsequent request', async () => {
    serveCatalogue(() => [{ slug: 'yuru-camp', publicId: 'abcdefghijkl' }]);
    await resolveMediaSlug('yuru-camp');

    const scan = serveCatalogue(async () => {
      throw new Error('backend down');
    });
    vi.setSystemTime(Date.now() + TTL_MS + 1);

    await resolveMediaSlug('yuru-camp');
    await settleBackgroundRebuild();
    expect(scan).toHaveBeenCalledTimes(1);

    await resolveMediaSlug('yuru-camp');
    await resolveMediaSlug('yuru-camp');
    await settleBackgroundRebuild();
    expect(scan).toHaveBeenCalledTimes(1);

    // And it does try again once the cooldown is up.
    vi.setSystemTime(Date.now() + 60_001);
    await resolveMediaSlug('yuru-camp');
    await settleBackgroundRebuild();
    expect(scan).toHaveBeenCalledTimes(2);
  });

  /**
   * The cold path is the one that still blocks, and it must scan exactly once.
   * Falling through to the miss-rebuild would double the cost of the single
   * request that already pays full price, to re-ask a catalogue read
   * milliseconds earlier.
   */
  it('scans once on a cold miss, not twice', async () => {
    const scan = serveCatalogue(() => [{ slug: 'yuru-camp', publicId: 'abcdefghijkl' }]);
    await expect(resolveMediaSlug('never-imported')).resolves.toBeNull();
    expect(scan).toHaveBeenCalledTimes(1);
  });

  /**
   * A title imported ten minutes ago still has to resolve before the hour is
   * out, and there is no stale answer to hand back for a slug the index has
   * never seen -- so this path blocks, deliberately.
   */
  it('rebuilds on a miss so a newly imported title resolves', async () => {
    serveCatalogue(() => [{ slug: 'yuru-camp', publicId: 'abcdefghijkl' }]);
    await resolveMediaSlug('yuru-camp');

    serveCatalogue(() => [
      { slug: 'yuru-camp', publicId: 'abcdefghijkl' },
      { slug: 'sakura-quest', publicId: 'mnopqrstuvwx' },
    ]);
    // Well inside the TTL: the index is not stale, the slug is simply new.
    vi.setSystemTime(Date.now() + 61_000);

    await expect(resolveMediaSlug('sakura-quest')).resolves.toBe('mnopqrstuvwx');
  });

  it('caps miss-triggered rebuilds so a bot walking random slugs cannot rescan per request', async () => {
    serveCatalogue(() => [{ slug: 'yuru-camp', publicId: 'abcdefghijkl' }]);
    await resolveMediaSlug('yuru-camp');

    const scan = serveCatalogue(() => [{ slug: 'yuru-camp', publicId: 'abcdefghijkl' }]);
    await resolveMediaSlug('probe-1');
    await resolveMediaSlug('probe-2');
    await resolveMediaSlug('probe-3');

    expect(scan).toHaveBeenCalledTimes(1);
  });
});
