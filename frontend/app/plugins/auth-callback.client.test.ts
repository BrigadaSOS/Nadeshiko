// @vitest-environment happy-dom
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { reactive } from 'vue';

import { AUTH_CALLBACK_PARAM, AUTH_INTENT_KEY, rememberAuthIntent } from '~/utils/authAnalytics';

/**
 * (A DOM, because `authIntentStorage()` reaches for `window.localStorage` and
 * answers `undefined` without one -- which quietly turns every attribution
 * assertion below into a comparison of two unknowns.)
 *
 * The plugin that finishes an auth round trip: strips the callback query, greets
 * the reader, and -- the reason it carries analytics at all -- reports the trips
 * that came back REJECTED.
 *
 * Without that report a provider that rejects everyone looks exactly like a
 * provider nobody chooses: both are an absence of signups. Not hypothetical --
 * 264 people picked Google in 90 days and the data could not say what became of
 * any of them.
 *
 * The two subtler rules are about not claiming pages that are not sign-ins. A
 * third-party account LINK is the same OAuth shape, and the bare `code`/`state`
 * test cannot tell them apart; and the query has to be read before it is
 * stripped, because `route` is live and there is nothing left to branch on
 * afterwards.
 */
const store = reactive({ isLoggedIn: false, getBasicInfo: vi.fn() });
const capture = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const reconcileAnalyticsIdentity = vi.fn();
const replace = vi.fn();

const route = reactive({ path: '/en', query: {} as Record<string, unknown> });

vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => plugin);
vi.stubGlobal('userStore', () => store);
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useRouter', () => ({ replace }));
vi.stubGlobal('useNuxtApp', () => ({ $i18n: { t: (key: string) => key } }));
vi.stubGlobal('usePostHog', () => ({ capture }));
vi.stubGlobal('useToastError', toastError);
vi.stubGlobal('useToastSuccess', toastSuccess);
vi.stubGlobal('reconcileAnalyticsIdentity', reconcileAnalyticsIdentity);

/** Installs the plugin and runs the mounted hook it defers its work to. */
async function land(query: Record<string, unknown>, path = '/en') {
  route.path = path;
  route.query = query;
  const hooks: Record<string, () => Promise<void>> = {};
  const plugin = (
    (await import('./auth-callback.client')) as unknown as {
      default: { setup: (app: unknown) => void };
    }
  ).default;
  plugin.setup({
    hook: (name: string, fn: () => Promise<void>) => {
      hooks[name] = fn;
    },
  });

  const mounted = hooks['app:mounted'];
  if (mounted) await mounted();
  return { handled: Boolean(mounted) };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.isLoggedIn = false;
  store.getBasicInfo = vi.fn(async () => {
    store.isLoggedIn = true;
  });
  localStorage.clear();
});

describe('an ordinary page load', () => {
  test('is left entirely alone', async () => {
    // Every page load runs this plugin; one that claims a page it has no
    // business on strips the reader's query string.
    const { handled } = await land({});

    expect(handled).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  test('a page with an unrelated query is too', async () => {
    const { handled } = await land({ media: 'm1', episode: '3' });

    expect(handled).toBe(false);
  });
});

describe('a sign-in that came back', () => {
  test('is recognised by the marker the login flow puts on the URL', async () => {
    await land({ [AUTH_CALLBACK_PARAM]: '1' });

    expect(replace).toHaveBeenCalledWith({ path: '/en', query: {} });
  });

  test('is recognised by the OAuth parameters too, for the error case', async () => {
    await land({ code: 'abc', state: 'xyz' });

    expect(replace).toHaveBeenCalled();
  });

  test('and by a magic link already sitting in an inbox', async () => {
    // Links sent before the marker existed still have to work.
    await land({ magic_callback: '1' });

    expect(replace).toHaveBeenCalled();
  });

  test('greets the reader once the session is theirs', async () => {
    store.isLoggedIn = true;

    await land({ [AUTH_CALLBACK_PARAM]: '1' });

    expect(toastSuccess).toHaveBeenCalledWith('modalauth.labels.successfullogin');
  });

  test('fetches the session first when the bootstrap has not landed yet', async () => {
    await land({ [AUTH_CALLBACK_PARAM]: '1' });

    expect(store.getBasicInfo).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
  });

  test('does not fetch it again when it already has one', async () => {
    store.isLoggedIn = true;

    await land({ [AUTH_CALLBACK_PARAM]: '1' });

    expect(store.getBasicInfo).not.toHaveBeenCalled();
  });

  test('says nothing when the session never arrives', async () => {
    // A greeting over a page that is still signed out is worse than silence.
    store.getBasicInfo = vi.fn(async () => {});

    await land({ [AUTH_CALLBACK_PARAM]: '1' });

    expect(toastSuccess).not.toHaveBeenCalled();
  });

  test('counts the login, telling the identity pass this was an auth landing', async () => {
    // Which is what lets a RETURNING reader's login be counted rather than read
    // as an ordinary page load.
    store.isLoggedIn = true;

    await land({ [AUTH_CALLBACK_PARAM]: '1' });

    expect(reconcileAnalyticsIdentity).toHaveBeenCalledWith({ viaCallback: true });
  });

  test('clears the callback query, so a refresh is not a second callback', async () => {
    store.isLoggedIn = true;

    await land({ [AUTH_CALLBACK_PARAM]: '1', code: 'abc' }, '/en/search/kanji');

    expect(replace).toHaveBeenCalledWith({ path: '/en/search/kanji', query: {} });
  });
});

describe('a sign-in that was REJECTED', () => {
  test('is reported, so a provider that rejects everyone is visible', async () => {
    await land({ error: 'access_denied' });

    expect(capture).toHaveBeenCalledWith('login_failed', expect.objectContaining({ reason: 'access_denied' }));
  });

  test('is not mistaken for a success', async () => {
    store.isLoggedIn = true;

    await land({ error: 'access_denied' });

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(reconcileAnalyticsIdentity).not.toHaveBeenCalled();
  });

  test.each([
    ['banned', 'modalauth.labels.banneduser'],
    ['access_denied', 'modalauth.labels.logindenied'],
    ['server_error', 'modalauth.labels.errorlogin400'],
  ])('tells the reader what %s means', async (reason, label) => {
    // `access_denied` is not a mistake the reader can correct by trying the
    // same button harder -- they cancelled, or a managed account's admin has
    // not allowed the app -- so it points at the sign-in nobody has to approve.
    await land({ error: reason });

    expect(toastError).toHaveBeenCalledWith(label);
  });

  test('reads the error before the query is stripped', async () => {
    // `route` is the live current route: once the query is cleared there is
    // nothing left to branch on.
    replace.mockImplementation(async () => {
      route.query = {};
    });

    await land({ error: 'banned' });

    expect(toastError).toHaveBeenCalledWith('modalauth.labels.banneduser');
  });

  test('takes the first value when the provider sends the error twice', async () => {
    await land({ error: ['banned', 'other'] });

    expect(toastError).toHaveBeenCalledWith('modalauth.labels.banneduser');
  });

  test('is tagged with the same gate the successful events carry, so the two compare', async () => {
    // A failure that cannot say which button started it cannot be set against
    // the signups that button did earn.
    rememberAuthIntent(localStorage, {
      provider: 'google',
      source: 'download_nudge',
      gate: 'download_nudge',
      at: Date.now(),
    });

    await land({ error: 'access_denied' });

    expect(capture).toHaveBeenCalledWith(
      'login_failed',
      expect.objectContaining({ provider: 'google', gate: 'download_nudge' }),
    );
  });

  test('consumes the intent, so the NEXT login is not credited to this gate', async () => {
    // The attempt is over. Leaving it parked would hand its gate to whatever
    // sign-in happens next, which is how one nudge comes to look responsible
    // for a week of signups.
    rememberAuthIntent(localStorage, {
      provider: 'google',
      source: 'download_nudge',
      gate: 'download_nudge',
      at: Date.now(),
    });

    await land({ error: 'banned' });

    expect(localStorage.getItem(AUTH_INTENT_KEY)).toBeNull();
  });
});

describe('linking a third-party account', () => {
  test('is not claimed, being the same OAuth shape but not a sign-in', async () => {
    // The bare `code`/`state` test above cannot tell them apart, and claiming
    // these pages broke the link flow.
    const { handled } = await land({ code: 'abc', state: 'xyz' }, '/en/link/shirabe/callback');

    expect(handled).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  test('not even when it carries the callback marker', async () => {
    const { handled } = await land({ [AUTH_CALLBACK_PARAM]: '1' }, '/en/link/shirabe/callback');

    expect(handled).toBe(false);
  });
});
