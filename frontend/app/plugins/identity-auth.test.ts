import { describe, test, expect, beforeEach, vi } from 'vitest';
import { reactive, ref } from 'vue';

// The KEY is inlined rather than imported: a static import is hoisted above the
// `stubGlobal` calls below, and this module calls `defineNuxtPlugin` as it
// loads. Asserted against the module's own export in the last test here, so the
// two cannot drift apart silently.
const SSR_IDENTITY_CHECK_KEY = 'nd-ssr-identity-check';
type SsrIdentityCheck = 'none' | 'resolved' | 'failed';

/**
 * The client half of the session bootstrap.
 *
 * (The SSR half is not reachable from here: `vitest.config.ts` replaces
 * `import.meta.server` with `false` so the app layer compiles in its CLIENT
 * configuration, which is the right default for every other test in the suite.
 * The server path is exercised end to end by Playwright.)
 *
 * What this decides is whether hydration spends an API call. The server already
 * settled the question for most renders -- `none` means the request carried no
 * session cookie at all, `resolved` means the backend answered -- and asking
 * again would only re-derive what the payload already says. The one case worth a
 * round trip is `failed`: the backend could not be reached, so the render is
 * signed-out by fallback rather than by fact.
 *
 * The identify is not merely an identify: it is where a signup or a login is
 * NOTICED, by comparing the account in session against the last one this browser
 * reported. So it has to happen on every load, including the ones that spend no
 * round trip.
 */
const store = reactive({
  isLoggedIn: false,
  getBasicInfo: vi.fn(),
  applySession: vi.fn(),
  resetAuthState: vi.fn(),
  preferences: {} as Record<string, unknown>,
});
const reconcileAnalyticsIdentity = vi.fn();
const state = new Map<string, ReturnType<typeof ref>>();

vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => plugin);
vi.stubGlobal('userStore', () => store);
vi.stubGlobal('reconcileAnalyticsIdentity', reconcileAnalyticsIdentity);
vi.stubGlobal('useState', (key: string, init?: () => unknown) => {
  if (!state.has(key)) state.set(key, ref(init ? init() : undefined));
  return state.get(key)!;
});

/** Hydrates with whatever the server render settled, and runs the plugin. */
async function hydrate(ssrCheck: SsrIdentityCheck | undefined, loggedIn = false) {
  state.clear();
  state.set(SSR_IDENTITY_CHECK_KEY, ref(ssrCheck));
  store.isLoggedIn = loggedIn;

  const plugin = (
    (await import('./identity-auth')) as unknown as {
      default: { setup: (app: unknown) => Promise<void> };
    }
  ).default;
  await plugin.setup({ ssrContext: undefined });
  // The round trip is deliberately not awaited by the plugin.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  store.getBasicInfo = vi.fn(async () => {});
});

describe('a render the server settled', () => {
  test.each([['none'], ['resolved']] as const)('%s spends no round trip re-deriving it', async (ssrCheck) => {
    // `none` is "the request carried no session cookie", which is not in doubt;
    // `resolved` is the backend having answered. Asking again on hydration is a
    // request per page load that can only agree with the payload.
    await hydrate(ssrCheck);

    expect(store.getBasicInfo).not.toHaveBeenCalled();
  });

  test('but still reports who is here, which is how a login gets noticed', async () => {
    // The identify compares the account in session against the last one this
    // browser reported; skipping it on the cheap path would lose every signup
    // that did not come through the auth callback.
    await hydrate('none');

    expect(reconcileAnalyticsIdentity).toHaveBeenCalledWith({ viaCallback: false });
  });

  test('and says this was not an auth landing, which `auth-callback` is for', async () => {
    // The two calls differ only in that: `viaCallback` is what lets a RETURNING
    // reader's login be counted, and claiming it here would count every page
    // load as one.
    await hydrate('resolved');

    expect(reconcileAnalyticsIdentity).toHaveBeenCalledWith({ viaCallback: false });
  });
});

describe('a render the server could NOT settle', () => {
  test('asks the backend, because signed-out here is a fallback and not a fact', async () => {
    // This branch is reached precisely when the backend failed to answer the
    // server; the reader may well be signed in.
    await hydrate('failed');

    expect(store.getBasicInfo).toHaveBeenCalled();
  });

  test('asks when there was no server pass at all', async () => {
    // `undefined` is a client-only navigation or a payload without the marker.
    await hydrate(undefined);

    expect(store.getBasicInfo).toHaveBeenCalled();
  });

  test('reports who is here only AFTER the answer arrives', async () => {
    // Identifying first would report the anonymous id and then have to correct
    // it, which is the shape that produced a run of aliased distinct_ids.
    const order: string[] = [];
    store.getBasicInfo = vi.fn(async () => {
      order.push('fetch');
    });
    reconcileAnalyticsIdentity.mockImplementation(() => order.push('identify'));

    await hydrate('failed');

    expect(order).toEqual(['fetch', 'identify']);
  });

  test('does not hold hydration open for it', async () => {
    // The worst moment to block first paint is the moment the backend has just
    // failed to answer.
    let settle = () => {};
    store.getBasicInfo = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = () => resolve();
        }),
    );

    await hydrate('failed');

    expect(store.getBasicInfo).toHaveBeenCalled();
    expect(reconcileAnalyticsIdentity).not.toHaveBeenCalled();
    settle();
  });
});

describe('the payload key', () => {
  test('is the one the plugin actually publishes', async () => {
    // This file drives the plugin through that key; a rename would otherwise
    // make every test above pass against a state nobody reads.
    const mod = await import('./identity-auth');

    expect(mod.SSR_IDENTITY_CHECK_KEY).toBe(SSR_IDENTITY_CHECK_KEY);
  });
});

describe('a reader who arrived signed in', () => {
  test.each([['failed'], [undefined]] as const)('spends no round trip even when the server said %s', async (check) => {
    // Pinia restored the session from the payload before this plugin ran, so
    // the answer is already here.
    await hydrate(check, true);

    expect(store.getBasicInfo).not.toHaveBeenCalled();
  });

  test('and is still reported, so their return is counted', async () => {
    await hydrate('resolved', true);

    expect(reconcileAnalyticsIdentity).toHaveBeenCalledTimes(1);
  });
});
