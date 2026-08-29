// @vitest-environment happy-dom
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

import { CHUNK_RELOAD_STORAGE_KEY, CHUNK_RELOAD_WINDOW_MS } from '~/utils/chunkReloadGuard';

/**
 * Recovery for a tab left on a stale build after a deploy.
 *
 * `/_nuxt/**` is hashed and served `immutable`, so a tab holding an older app
 * shell asks for chunk hashes the live build no longer has. Unrepaired, every
 * subsequent route change fails the same way for the rest of the visit.
 *
 * Three things here were each learned from production:
 *
 *   - THE CACHE BUST. `reloadNuxtApp` ends in a plain navigation, which is
 *     served from the HTTP cache -- and this site's HTML reaches readers with
 *     `Cache-Control: private, max-age=3600`. So the reload is handed the very
 *     document whose chunks just 404ed, byte for byte, and fails identically
 *     until the budget runs out. `cache: 'reload'` is what makes the navigation
 *     that follows see the new build.
 *   - THE SECOND ENTRY POINT. Nuxt raises `app:chunkError` only for imports
 *     Vite wrapped in its preload helper; a layout is a plain dynamic import, so
 *     a 404 on a layout chunk rejects with nobody listening. Every occurrence in
 *     production arrived through the global handler and none through the hook.
 *   - THE SHARED BUDGET. Both paths can fire for one broken build and must
 *     share one allowance rather than get two each.
 */
const reportError = vi.fn();
vi.mock('~/utils/reportError', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

const reloadNuxtApp = vi.fn();
const hooks: Record<string, (payload: never) => void> = {};
const nuxtApp = {
  hook: (name: string, fn: (payload: never) => void) => {
    hooks[name] = fn;
  },
};
let beforeEachGuard: ((to: { fullPath: string }) => void) | null = null;
let afterEachGuard: (() => void) | null = null;

vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => plugin);
vi.stubGlobal('reloadNuxtApp', reloadNuxtApp);
vi.stubGlobal('useRouter', () => ({
  beforeEach: (fn: (to: { fullPath: string }) => void) => {
    beforeEachGuard = fn;
  },
  afterEach: (fn: () => void) => {
    afterEachGuard = fn;
  },
}));

const NOW = new Date('2026-08-31T12:00:00Z');
/** The error Vite raises for a chunk the live build no longer has. */
const chunkError = () => new TypeError('Failed to fetch dynamically imported module: /_nuxt/DfE1.js');

let fetchMock: ReturnType<typeof vi.fn>;

/** Installs the plugin and returns the two ways a chunk failure reaches it. */
async function install() {
  const plugin = (
    (await import('./chunkReload.client')) as unknown as {
      default: { setup: (app: unknown) => void };
    }
  ).default;
  plugin.setup(nuxtApp);
  return {
    viaHook: (error: unknown) => hooks['app:chunkError']!({ error } as never),
    viaRejection: (reason: unknown) => {
      // Cancelable, as the real one is: `preventDefault` on an uncancelable
      // event is silently a no-op, and the claim this test is about would look
      // broken when it is not.
      const event = new Event('unhandledrejection', { cancelable: true }) as Event & { reason: unknown };
      event.reason = reason;
      window.dispatchEvent(event);
      return event;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  sessionStorage.clear();
  beforeEachGuard = null;
  afterEachGuard = null;
  for (const key of Object.keys(hooks)) delete hooks[key];
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  window.history.replaceState({}, '', '/en/search/kanji?media=m1');
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  // `restoreAllMocks`, NOT `unstubAllGlobals`: the stubs above are installed
  // once at module scope, and unstubbing them leaves every test after the first
  // without `useRouter` or `reloadNuxtApp`. This undoes the per-test spies --
  // the `Storage` ones especially -- and leaves the globals in place.
  vi.restoreAllMocks();
});

describe('a chunk that will not load', () => {
  test('reloads the page onto the new build', async () => {
    const { viaHook } = await install();

    viaHook(chunkError());
    await vi.runAllTimersAsync();

    expect(reloadNuxtApp).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/en/search/kanji?media=m1', force: true, ttl: CHUNK_RELOAD_WINDOW_MS }),
    );
  });

  test('replaces the cached document FIRST, or the reload is a no-op', async () => {
    // The navigation `reloadNuxtApp` ends in is served from the HTTP cache, and
    // this site's HTML is cached for an hour -- so without this the reload gets
    // back the same stale document and fails the same way.
    const { viaHook } = await install();

    viaHook(chunkError());
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledWith('/en/search/kanji?media=m1', expect.objectContaining({ cache: 'reload' }));
  });

  test('fetches it as the reader, since a credential-less request is a different cache key', async () => {
    // The entry being overwritten was stored by a cookie-bearing navigation.
    const { viaHook } = await install();

    viaHook(chunkError());
    await vi.runAllTimersAsync();

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: 'same-origin' });
  });

  test('reloads anyway when the cache bust itself fails', async () => {
    // Offline, aborted or refused: the reload is no worse off than it would
    // have been, so every outcome leads to the same next line.
    fetchMock.mockRejectedValue(new Error('refused'));
    const { viaHook } = await install();

    viaHook(chunkError());
    await vi.runAllTimersAsync();

    expect(reloadNuxtApp).toHaveBeenCalled();
  });

  test('does not wait forever for it', async () => {
    // A hung fetch would leave the reader on a broken page indefinitely.
    fetchMock.mockImplementation(
      (_url: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const { viaHook } = await install();

    viaHook(chunkError());
    await vi.advanceTimersByTimeAsync(3_000);

    expect(reloadNuxtApp).toHaveBeenCalled();
  });
});

describe('which page it reloads onto', () => {
  test('the one being navigated TO, not the one being left', async () => {
    // `app:chunkError` fires mid-navigation, so `window.location` still points
    // at the old route; reloading that strands the reader where they were.
    const { viaHook } = await install();
    beforeEachGuard?.({ fullPath: '/en/media/oshi-no-ko' });

    viaHook(chunkError());
    await vi.runAllTimersAsync();

    expect(reloadNuxtApp).toHaveBeenCalledWith(expect.objectContaining({ path: '/en/media/oshi-no-ko' }));
  });

  test('and the current one once that navigation has landed', async () => {
    const { viaHook } = await install();
    beforeEachGuard?.({ fullPath: '/en/media/oshi-no-ko' });
    afterEachGuard?.();

    viaHook(chunkError());
    await vi.runAllTimersAsync();

    expect(reloadNuxtApp).toHaveBeenCalledWith(expect.objectContaining({ path: '/en/search/kanji?media=m1' }));
  });

  test('keeping the query string, which is most of what a search page is', async () => {
    const { viaHook } = await install();

    viaHook(chunkError());
    await vi.runAllTimersAsync();

    expect(reloadNuxtApp).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('?media=m1') }));
  });
});

describe('a reader who is OFFLINE', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
  });

  test('is not reloaded, because the chunk is not coming either way', async () => {
    // The reload would drop whatever unsaved state the page holds for nothing.
    const { viaHook } = await install();

    viaHook(chunkError());
    await vi.runAllTimersAsync();

    expect(reloadNuxtApp).not.toHaveBeenCalled();
  });

  test('is reported separately, so this is not read as a broken deploy', async () => {
    const { viaHook } = await install();

    viaHook(chunkError());

    expect(reportError).toHaveBeenCalledWith('app:chunk-error-offline', expect.anything(), expect.anything());
  });

  test('and no attempt is spent on it', async () => {
    const { viaHook } = await install();

    viaHook(chunkError());

    expect(sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY)).toBeNull();
  });
});

describe('several chunks failing at once', () => {
  test('reload only once, since one broken page orphans several chunks', async () => {
    const { viaHook } = await install();

    viaHook(chunkError());
    viaHook(chunkError());
    viaHook(chunkError());
    await vi.runAllTimersAsync();

    expect(reloadNuxtApp).toHaveBeenCalledTimes(1);
  });

  test('and the rest are not reported, having nothing new to say', async () => {
    const { viaHook } = await install();

    viaHook(chunkError());
    viaHook(chunkError());

    expect(reportError).not.toHaveBeenCalled();
  });

  test('the attempt is spent BEFORE the cache bust is awaited', async () => {
    // The rest of the burst is already queued and runs before any of it
    // resolves; an attempt recorded after the await would let every one of them
    // start its own reload.
    const { viaHook } = await install();

    viaHook(chunkError());

    expect(sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY)).not.toBeNull();
  });
});

describe('a build that stays broken', () => {
  /**
   * One page load that hits a chunk error, `seconds` after the last.
   *
   * The gap matters: within a second of the previous attempt the guard reads
   * this as the same broken page still shedding chunks and does nothing, so a
   * loop with a frozen clock never spends a second attempt and this would test
   * the burst window instead of the budget.
   */
  async function pageLoadAfter(seconds: number) {
    vi.setSystemTime(new Date(NOW.getTime() + seconds * 1000));
    vi.resetModules();
    const { viaHook } = await install();
    viaHook(chunkError());
    await vi.runAllTimersAsync();
  }

  test('gives up rather than cycling the tab', async () => {
    // Past the budget the reload is not fixing anything, so let the error reach
    // the reader instead.
    await pageLoadAfter(0);
    await pageLoadAfter(5);
    await pageLoadAfter(10);

    expect(reportError).toHaveBeenCalledWith(
      'app:chunk-error-unrecoverable',
      expect.anything(),
      expect.objectContaining({ 'chunk.attempts': '2' }),
    );
  });

  test('and stops reloading once it has', async () => {
    await pageLoadAfter(0);
    await pageLoadAfter(5);
    reloadNuxtApp.mockClear();

    await pageLoadAfter(10);

    expect(reloadNuxtApp).not.toHaveBeenCalled();
  });

  test('but a failure long afterwards gets a fresh budget', async () => {
    // A second deploy hours later is a new event, not a continuation of the
    // one the reader already sat through.
    await pageLoadAfter(0);
    await pageLoadAfter(5);
    reloadNuxtApp.mockClear();

    await pageLoadAfter(11 * 60);

    expect(reloadNuxtApp).toHaveBeenCalled();
  });
});

describe('the second entry point', () => {
  test('catches a layout chunk, which the hook never sees', async () => {
    // Nuxt raises `app:chunkError` from Vite's preload helper, and a layout is
    // a plain dynamic import. Every occurrence in production arrived this way.
    const { viaRejection } = await install();

    viaRejection(chunkError());
    await vi.runAllTimersAsync();

    expect(reloadNuxtApp).toHaveBeenCalled();
  });

  test('claims the rejection, so it is not also filed as an unexplained error', async () => {
    const { viaRejection } = await install();

    const event = viaRejection(chunkError());

    expect(event.defaultPrevented).toBe(true);
  });

  test('ignores a rejection that has nothing to do with chunks', async () => {
    // Reloading the page on any unhandled rejection would be a reload loop for
    // an ordinary failed request.
    const { viaRejection } = await install();

    const event = viaRejection(new Error('the API said no'));
    await vi.runAllTimersAsync();

    expect(reloadNuxtApp).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  test('shares one budget with the hook rather than getting its own', async () => {
    // Both paths fire for one broken build.
    const { viaHook, viaRejection } = await install();

    viaHook(chunkError());
    viaRejection(chunkError());
    await vi.runAllTimersAsync();

    expect(reloadNuxtApp).toHaveBeenCalledTimes(1);
  });
});

describe('a browser that refuses sessionStorage', () => {
  test('still recovers, treating every failure as a first attempt', async () => {
    // Safari private mode throws on access. Without persistence the recovery
    // still terminates: the reload either fixes the mismatch or the reader
    // stops navigating.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { viaHook } = await install();

    viaHook(chunkError());
    await vi.runAllTimersAsync();

    expect(reloadNuxtApp).toHaveBeenCalled();
  });
});
