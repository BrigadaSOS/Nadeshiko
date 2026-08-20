import { describe, expect, it } from 'vitest';
import {
  acquisitionSetOnce,
  ANALYTICS_IDENTITY_KEY,
  FIRST_TOUCH_KEY,
  firstTouchSetOnce,
  readFirstTouch,
  rememberFirstTouch,
  ANALYTICS_SESSION_KEY,
  AUTH_CALLBACK_PARAM,
  AUTH_GATE_PARAM,
  AUTH_SOURCE_PARAM,
  absorbIntentFromUrl,
  AUTH_INTENT_KEY,
  AUTH_INTENT_TTL_MS,
  NEW_ACCOUNT_WINDOW_MS,
  type IntentStorage,
  authEventProperties,
  consumeAuthIntent,
  readAuthIntent,
  readStoredValue,
  rememberAuthIntent,
  removeStoredValue,
  resolveAuthTransition,
  resolveLostSession,
  updateAuthIntent,
  withAuthCallbackMarker,
  withAuthIntentParams,
  writeStoredValue,
} from '~/utils/authAnalytics';

const NOW = 1_770_000_000_000;

function fakeStorage(initial: Record<string, string> = {}): IntentStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

/** Storage that refuses every operation, as Safari private mode does. */
const hostileStorage: IntentStorage = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
  removeItem: () => {
    throw new Error('denied');
  },
};

describe('auth intent round trip', () => {
  it('reads back what was parked', () => {
    const storage = fakeStorage();
    rememberAuthIntent(storage, { gate: 'anki_add_last', source: 'anki_add_last', at: NOW });

    expect(readAuthIntent(storage, NOW)).toEqual({
      gate: 'anki_add_last',
      source: 'anki_add_last',
      at: NOW,
    });
  });

  it('merges the provider onto the gate recorded when the modal opened', () => {
    // The two facts arrive as separate writes: the gate when the wall is hit, the
    // provider once a button is pressed. Losing the gate at that point would undo
    // the entire point of the mechanism.
    const storage = fakeStorage();
    updateAuthIntent(storage, { gate: 'report_segment', source: 'report_segment' }, NOW);
    updateAuthIntent(storage, { provider: 'google' }, NOW + 2000);

    expect(readAuthIntent(storage, NOW + 2000)).toEqual({
      gate: 'report_segment',
      source: 'report_segment',
      provider: 'google',
      at: NOW + 2000,
    });
  });

  it('clears on consume so one intent is credited once', () => {
    const storage = fakeStorage();
    rememberAuthIntent(storage, { source: 'header', at: NOW });

    expect(consumeAuthIntent(storage, NOW)?.source).toBe('header');
    expect(consumeAuthIntent(storage, NOW)).toBeNull();
  });

  it('discards an intent older than the TTL rather than misattributing it', () => {
    const storage = fakeStorage();
    rememberAuthIntent(storage, { gate: 'collection_choose', source: 'collection_choose', at: NOW });

    expect(readAuthIntent(storage, NOW + AUTH_INTENT_TTL_MS + 1)).toBeNull();
  });

  it.each([
    ['absent', {}],
    ['malformed JSON', { [AUTH_INTENT_KEY]: '{oh no' }],
    ['a non-object', { [AUTH_INTENT_KEY]: '"a string"' }],
    ['a missing timestamp', { [AUTH_INTENT_KEY]: '{"source":"header"}' }],
  ])('returns nothing for %s', (_label, initial) => {
    expect(readAuthIntent(fakeStorage(initial as Record<string, string>), NOW)).toBeNull();
  });

  it('survives storage that throws on every call', () => {
    expect(() => rememberAuthIntent(hostileStorage, { source: 'header', at: NOW })).not.toThrow();
    expect(readAuthIntent(hostileStorage, NOW)).toBeNull();
    expect(consumeAuthIntent(hostileStorage, NOW)).toBeNull();
  });

  it('is inert without storage at all, as on the server', () => {
    expect(() => rememberAuthIntent(undefined, { source: 'header', at: NOW })).not.toThrow();
    expect(readAuthIntent(undefined, NOW)).toBeNull();
  });
});

describe('resolveAuthTransition', () => {
  const base = {
    storedUserId: null,
    currentSessionId: null,
    storedSessionId: null,
    accountCreatedAt: null,
    now: NOW,
    viaCallback: false,
  };

  it('reports nothing when signed out', () => {
    expect(resolveAuthTransition({ ...base, currentUserId: null })).toBeNull();
  });

  it('reports a signup the first time an id is seen on a just-created account', () => {
    expect(
      resolveAuthTransition({
        ...base,
        currentUserId: '42',
        accountCreatedAt: new Date(NOW - 1000).toISOString(),
      }),
    ).toBe('signup_completed');
  });

  it('reports a login when a new id belongs to an established account', () => {
    // Signing in on a second device is not a second signup.
    expect(
      resolveAuthTransition({
        ...base,
        currentUserId: '42',
        accountCreatedAt: new Date(NOW - NEW_ACCOUNT_WINDOW_MS - 1).toISOString(),
      }),
    ).toBe('user_logged_in');
  });

  it('stays silent on an ordinary page view of a live session', () => {
    expect(resolveAuthTransition({ ...base, currentUserId: '42', storedUserId: '42' })).toBeNull();
  });

  it('reports a login when the same account arrives on a new session', () => {
    // The exact signal: better-auth extends the existing row when it refreshes a
    // session, so a different id can only mean a fresh sign-in.
    expect(
      resolveAuthTransition({
        ...base,
        currentUserId: '42',
        storedUserId: '42',
        currentSessionId: 'sess-2',
        storedSessionId: 'sess-1',
      }),
    ).toBe('user_logged_in');
  });

  it('stays silent while the same session keeps browsing', () => {
    expect(
      resolveAuthTransition({
        ...base,
        currentUserId: '42',
        storedUserId: '42',
        currentSessionId: 'sess-1',
        storedSessionId: 'sess-1',
        // Even a callback landing must not double-report a session already counted.
        viaCallback: true,
      }),
    ).toBeNull();
  });

  it('falls back to the callback marker when no session id is available', () => {
    expect(resolveAuthTransition({ ...base, currentUserId: '42', storedUserId: '42', viaCallback: true })).toBe(
      'user_logged_in',
    );
  });

  it('never reports a second signup for an account created moments ago', () => {
    // Sign up, sign out, sign straight back in. The account is still inside the
    // new-account window, so only the retained stored id keeps this from being
    // counted as a second account.
    expect(
      resolveAuthTransition({
        ...base,
        currentUserId: '42',
        storedUserId: '42',
        accountCreatedAt: new Date(NOW - 1000).toISOString(),
        viaCallback: true,
      }),
    ).toBe('user_logged_in');
  });

  it('treats a future-dated account as just created rather than ancient', () => {
    // Clock skew between the browser and the server, which would otherwise turn a
    // real signup into a login.
    expect(
      resolveAuthTransition({
        ...base,
        currentUserId: '42',
        accountCreatedAt: new Date(NOW + 30_000).toISOString(),
      }),
    ).toBe('signup_completed');
  });

  it.each([null, '', 'not a date'])('falls back to a login for unusable createdAt %j', (createdAt) => {
    expect(resolveAuthTransition({ ...base, currentUserId: '42', accountCreatedAt: createdAt })).toBe('user_logged_in');
  });
});

describe('carrying intent through the magic link', () => {
  it('writes source and gate onto the callback URL', () => {
    const url = withAuthIntentParams('/?magic_callback=1', {
      source: 'anki_add_last',
      gate: 'anki_add_last',
      provider: 'magic_link',
      at: NOW,
    });

    const params = new URLSearchParams(url.slice(url.indexOf('?')));
    expect(params.get(AUTH_SOURCE_PARAM)).toBe('anki_add_last');
    expect(params.get(AUTH_GATE_PARAM)).toBe('anki_add_last');
  });

  it('adds nothing when there is no intent, or nothing worth carrying', () => {
    expect(withAuthIntentParams('/?magic_callback=1', null)).toBe('/?magic_callback=1');
    expect(withAuthIntentParams('/?magic_callback=1', { source: 'unknown', at: NOW })).toBe('/?magic_callback=1');
  });

  it('rebuilds the intent on a device that never saw the modal', () => {
    // The whole point: mailed to a phone, opened on a laptop with empty storage.
    const storage = fakeStorage();
    absorbIntentFromUrl(
      storage,
      `?magic_callback=1&${AUTH_SOURCE_PARAM}=report_segment&${AUTH_GATE_PARAM}=report_segment`,
      NOW,
    );

    expect(readAuthIntent(storage, NOW)).toEqual({
      source: 'report_segment',
      gate: 'report_segment',
      provider: 'magic_link',
      at: NOW,
    });
  });

  it('never overwrites what this browser already knew', () => {
    // The local copy saw the provider button pressed, so it is the richer record.
    const storage = fakeStorage();
    updateAuthIntent(storage, { source: 'collection_choose', gate: 'collection_choose', provider: 'google' }, NOW);
    absorbIntentFromUrl(storage, `?${AUTH_SOURCE_PARAM}=header`, NOW + 1000);

    expect(readAuthIntent(storage, NOW + 1000)).toMatchObject({
      source: 'collection_choose',
      gate: 'collection_choose',
      provider: 'google',
    });
  });

  it.each([
    ['a made-up gate', `?${AUTH_GATE_PARAM}=drop_table_users`],
    ['a made-up source', `?${AUTH_SOURCE_PARAM}=<script>`],
  ])('ignores %s rather than letting it into a breakdown', (_label, search) => {
    // These arrive in a URL anyone can edit.
    const storage = fakeStorage();
    absorbIntentFromUrl(storage, search, NOW);

    expect(readAuthIntent(storage, NOW)).toBeNull();
  });

  it('does nothing when the URL carries no intent at all', () => {
    const storage = fakeStorage();
    absorbIntentFromUrl(storage, '?sort=new', NOW);

    expect(readAuthIntent(storage, NOW)).toBeNull();
  });
});

describe('withAuthCallbackMarker', () => {
  it('marks an absolute URL without disturbing what is already there', () => {
    expect(withAuthCallbackMarker('https://nadeshiko.co/en/search/%E7%8C%AB?sort=new')).toBe(
      `https://nadeshiko.co/en/search/%E7%8C%AB?sort=new&${AUTH_CALLBACK_PARAM}=1`,
    );
  });

  it('keeps a relative callback relative, since better-auth matches it against trusted origins', () => {
    expect(withAuthCallbackMarker('/?magic_callback=1')).toBe(`/?magic_callback=1&${AUTH_CALLBACK_PARAM}=1`);
  });

  it('does not accumulate markers when signing in again from a callback page', () => {
    const once = withAuthCallbackMarker('https://nadeshiko.co/en');
    expect(withAuthCallbackMarker(once)).toBe(once);
  });

  it('preserves the fragment', () => {
    expect(withAuthCallbackMarker('/en/media#top')).toBe(`/en/media?${AUTH_CALLBACK_PARAM}=1#top`);
  });

  it('never throws, whatever it is handed', () => {
    // It sits directly in the login path, so a surprising input must cost the
    // marker, not the sign-in.
    for (const input of ['', '::::', 'not a url', 'mailto:someone@example.com']) {
      expect(() => withAuthCallbackMarker(input)).not.toThrow();
    }
  });
});

describe('stored values', () => {
  it('keeps account and session under separate keys', () => {
    const storage = fakeStorage();
    writeStoredValue(storage, ANALYTICS_IDENTITY_KEY, '42');
    writeStoredValue(storage, ANALYTICS_SESSION_KEY, 'sess-1');

    expect(readStoredValue(storage, ANALYTICS_IDENTITY_KEY)).toBe('42');
    expect(readStoredValue(storage, ANALYTICS_SESSION_KEY)).toBe('sess-1');
  });

  it('survives hostile storage', () => {
    expect(() => writeStoredValue(hostileStorage, ANALYTICS_IDENTITY_KEY, '42')).not.toThrow();
    expect(readStoredValue(hostileStorage, ANALYTICS_IDENTITY_KEY)).toBeNull();
    expect(() => removeStoredValue(hostileStorage, ANALYTICS_IDENTITY_KEY)).not.toThrow();
  });

  it('forgets a value, which is what keeps a lost session reported once', () => {
    const storage = fakeStorage();
    writeStoredValue(storage, ANALYTICS_IDENTITY_KEY, '42');
    removeStoredValue(storage, ANALYTICS_IDENTITY_KEY);

    expect(readStoredValue(storage, ANALYTICS_IDENTITY_KEY)).toBeNull();
  });
});

/**
 * The detector for a whole class of bug that is otherwise silent: when a session
 * ends because something expired rather than because the reader asked, nothing
 * fails, no request 401s, and the site simply renders signed-out. The only thing
 * that separates that from ordinary churn is the AGE of the sessions being lost,
 * so these tests are mostly about not drowning that number in false positives.
 */
describe('resolveLostSession', () => {
  const HOUR = 3_600_000;
  const now = 1_787_000_000_000;

  it('reports a session that ended without a sign-out, with its age', () => {
    expect(
      resolveLostSession({
        storedUserId: '42',
        storedSessionStartedAt: String(now - 30 * 24 * HOUR),
        deliberate: false,
        now,
      }),
    ).toEqual({ hoursSignedIn: 720 });
  });

  it('says nothing when the reader signed out on purpose', () => {
    // The identity key survives a deliberate sign-out by design, so this flag is
    // the only thing standing between the signal and every logout on the site.
    expect(
      resolveLostSession({
        storedUserId: '42',
        storedSessionStartedAt: String(now - 3 * HOUR),
        deliberate: true,
        now,
      }),
    ).toBeNull();
  });

  it('says nothing for a browser that was never signed in', () => {
    expect(
      resolveLostSession({ storedUserId: null, storedSessionStartedAt: String(now - HOUR), deliberate: false, now }),
    ).toBeNull();
  });

  it('still reports the loss when the age is unknown or nonsense', () => {
    // Losing the age is worth reporting ageless -- the count alone still moves
    // when something starts cutting people off -- but a fabricated age would
    // land on the histogram as a real reading, which is worse than a gap.
    for (const startedAt of [null, 'yesterday', '0', String(now + HOUR)]) {
      expect(
        resolveLostSession({ storedUserId: '42', storedSessionStartedAt: startedAt, deliberate: false, now }),
      ).toEqual({ hoursSignedIn: null });
    }
  });

  it('keeps one decimal, because a fixed horizon repeats to within hours', () => {
    expect(
      resolveLostSession({
        storedUserId: '42',
        storedSessionStartedAt: String(now - (30 * 24 * HOUR + 15 * 60 * 1000)),
        deliberate: false,
        now,
      }),
    ).toEqual({ hoursSignedIn: 720.3 });
  });
});

describe('acquisitionSetOnce', () => {
  it('stamps everything it knows', () => {
    expect(acquisitionSetOnce({ provider: 'google', source: 'anki_add_last', gate: 'anki_add_last' })).toEqual({
      $set_once: {
        signup_provider: 'google',
        signup_source: 'anki_add_last',
        signup_gate: 'anki_add_last',
      },
    });
  });

  it('omits the gate for a header signup rather than writing a null', () => {
    expect(acquisitionSetOnce({ provider: 'magic_link', source: 'header', gate: null })).toEqual({
      $set_once: { signup_provider: 'magic_link', signup_source: 'header' },
    });
  });

  it('sends nothing at all when the intent was lost', () => {
    // `$set_once` is permanent. Recording `unknown` here would burn the slot and
    // leave the person carrying a confident non-answer for ever.
    expect(acquisitionSetOnce({ provider: 'unknown', source: 'unknown', gate: null })).toEqual({});
  });
});

describe('authEventProperties', () => {
  it('spells out the unknowns rather than omitting them', () => {
    // A missing breakdown key and a known-unknown look identical in a PostHog
    // breakdown otherwise.
    expect(authEventProperties(null)).toEqual({ provider: 'unknown', source: 'unknown', gate: null });
  });

  it('carries the gate through', () => {
    expect(
      authEventProperties({ gate: 'anki_add_search', source: 'anki_add_search', provider: 'magic_link', at: NOW }),
    ).toEqual({ provider: 'magic_link', source: 'anki_add_search', gate: 'anki_add_search' });
  });
});

describe('rememberFirstTouch', () => {
  const visit = (over: Partial<Parameters<typeof rememberFirstTouch>[1]> = {}) => ({
    referrer: '',
    search: '',
    pathname: '/',
    ownHost: 'nadeshiko.co',
    ...over,
  });

  it('records the referring domain and where they landed', () => {
    const storage = fakeStorage();

    rememberFirstTouch(storage, visit({ referrer: 'https://www.reddit.com/r/x', pathname: '/search/kimi' }), NOW);

    expect(readFirstTouch(storage)).toEqual({ referrer: 'www.reddit.com', landing: '/search/kimi', at: NOW });
  });

  /**
   * The contract the whole thing rests on. Every later page load and the OAuth
   * round trip all call this, and any of them overwriting would turn "where did
   * they come from" into "where were they last".
   */
  it('never overwrites what it already knows', () => {
    const storage = fakeStorage();

    rememberFirstTouch(storage, visit({ referrer: 'https://www.reddit.com/r/x' }), NOW);
    rememberFirstTouch(storage, visit({ referrer: 'https://accounts.google.com/' }), NOW + 60_000);

    expect(readFirstTouch(storage)?.referrer).toBe('www.reddit.com');
  });

  /**
   * A same-origin referrer is an internal navigation that happened to be a full
   * page load. Counting it as an acquisition is not a rounding error --
   * `nadeshiko.co` was the second-largest "source" on the site at 2,389 people.
   */
  it('folds our own domain into direct', () => {
    const storage = fakeStorage();

    rememberFirstTouch(storage, visit({ referrer: 'https://nadeshiko.co/search/x' }), NOW);

    expect(readFirstTouch(storage)?.referrer).toBe('$direct');
  });

  it('reads no referrer as direct', () => {
    const storage = fakeStorage();

    rememberFirstTouch(storage, visit(), NOW);

    expect(readFirstTouch(storage)?.referrer).toBe('$direct');
  });

  it('keeps the campaign tags when there are any', () => {
    const storage = fakeStorage();

    rememberFirstTouch(storage, visit({ search: '?utm_source=discord&utm_medium=bot&utm_campaign=search' }), NOW);

    expect(firstTouchSetOnce(storage).$set_once).toMatchObject({
      first_touch_utm_source: 'discord',
      first_touch_utm_medium: 'bot',
      first_touch_utm_campaign: 'search',
    });
  });

  /**
   * `$set_once` can only be written once, so a blank tag would burn the slot on
   * a confident nothing -- the same reason `acquisitionSetOnce` omits an unknown
   * provider.
   */
  it('omits campaign tags rather than storing them empty', () => {
    const storage = fakeStorage();

    rememberFirstTouch(storage, visit({ referrer: 'https://www.google.com/' }), NOW);

    expect(firstTouchSetOnce(storage).$set_once).toEqual({
      first_touch_referrer: 'www.google.com',
      first_touch_landing: '/',
    });
  });

  it('says nothing at all when there is no first touch parked', () => {
    expect(firstTouchSetOnce(fakeStorage())).toEqual({});
  });

  it('survives storage that refuses every operation', () => {
    expect(() => rememberFirstTouch(hostileStorage, visit(), NOW)).not.toThrow();
    expect(readFirstTouch(hostileStorage)).toBeNull();
    expect(firstTouchSetOnce(hostileStorage)).toEqual({});
  });

  it('treats a malformed record as nothing rather than throwing', () => {
    expect(readFirstTouch(fakeStorage({ [FIRST_TOUCH_KEY]: 'not json' }))).toBeNull();
  });
});
