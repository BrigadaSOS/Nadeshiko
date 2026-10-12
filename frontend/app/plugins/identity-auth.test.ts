import { describe, test, expect, beforeEach, vi } from 'vitest';
import { reactive, ref } from 'vue';

// Inline the key because static import would precede Nuxt-global stubs. The export-parity test prevents
// drift.
const SSR_IDENTITY_CHECK_KEY = 'nd-ssr-identity-check';
type SsrIdentityCheck = 'none' | 'resolved' | 'failed';

/**
 * Client bootstrap coverage: settled SSR state avoids refetch, unresolved state retries, and identity
 * reconciliation runs on every load. Vitest compiles out the server branch; Playwright covers SSR.
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
    await hydrate(ssrCheck);

    expect(store.getBasicInfo).not.toHaveBeenCalled();
  });

  test('but still reports who is here, which is how a login gets noticed', async () => {
    // Reconciliation must run even without a fetch to detect signups outside the callback.
    await hydrate('none');

    expect(reconcileAnalyticsIdentity).toHaveBeenCalledWith({ viaCallback: false });
  });

  test('and says this was not an auth landing, which `auth-callback` is for', async () => {
    // Callback evidence belongs to auth-callback, not ordinary page loads.
    await hydrate('resolved');

    expect(reconcileAnalyticsIdentity).toHaveBeenCalledWith({ viaCallback: false });
  });
});

describe('a render the server could NOT settle', () => {
  test('asks the backend, because signed-out here is a fallback and not a fact', async () => {
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
    // Pinia has already restored the signed-in session before this plugin.
    await hydrate(check, true);

    expect(store.getBasicInfo).not.toHaveBeenCalled();
  });

  test('and is still reported, so their return is counted', async () => {
    await hydrate('resolved', true);

    expect(reconcileAnalyticsIdentity).toHaveBeenCalledTimes(1);
  });
});
