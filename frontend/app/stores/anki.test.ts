import { describe, test, expect, beforeEach, vi } from 'vitest';
import { formatMs } from '~/utils/misc';

/**
 * The Anki store, which was shipping at 0% coverage while holding the two
 * things this feature lives or dies on.
 *
 * The first is WHY a connection failed. `ANKI_CONNECT_FAILURES` is a closed set
 * whose members are each a PostHog breakdown value and the key of a tip the
 * settings page shows, and the split that earns the type -- `permission_denied`
 * against `unreachable` -- is invisible from the outside: both look like "no
 * answer" to a caller, and telling a reader with a permission dialog behind
 * their browser to check that Anki is running is a dead end.
 *
 * The second is which fields an export is allowed to write. A word-level
 * placeholder must be left ALONE, not blanked, on the paths that have no word,
 * because on a Yomitan-made note that field holds the definition the reader
 * wrote. Blanking it is silent, destructive, and indistinguishable from a
 * successful export.
 */
const sdk = {
  updateUserPreferences: vi.fn().mockResolvedValue({}),
  listCollections: vi.fn().mockResolvedValue({ collections: [] }),
  createCollection: vi.fn().mockResolvedValue({ publicId: 'col-1' }),
  addSegmentToCollection: vi.fn().mockResolvedValue({}),
  trackUserActivity: vi.fn().mockResolvedValue({}),
};
const posthog = { capture: vi.fn() };
const toasts = { error: vi.fn(), info: vi.fn(), success: vi.fn() };

const user = {
  isLoggedIn: true,
  preferences: { ankiProfiles: [] as unknown[], mediaNameLanguage: undefined as string | undefined },
  resetAuthState: vi.fn(),
};
vi.mock('@/stores/auth', () => ({ userStore: () => user }));

const reportError = vi.fn();
const reportEvent = vi.fn();
vi.mock('~/utils/reportError', () => ({
  reportError: (...a: unknown[]) => reportError(...a),
  reportEvent: (...a: unknown[]) => reportEvent(...a),
}));

const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({
  handleApiError: (...a: unknown[]) => handleApiError(...a),
  apiErrorStatus: (error: unknown) => (error as { statusCode?: number })?.statusCode,
}));

/** Whether the browser told us OUR policy refused the request, not the network. */
const refusedSince = vi.fn(() => false);
vi.mock('~/utils/cspViolations', () => ({
  installCspViolationLog: () => {},
  cspViolationLog: { refusedSince: (...a: unknown[]) => refusedSince(...(a as [])) },
}));

vi.stubGlobal('useNadeshikoSdk', () => sdk);
vi.stubGlobal('usePostHog', () => posthog);
vi.stubGlobal('useNuxtApp', () => ({
  $i18n: { locale: { value: 'en' }, t: (key: string) => key },
}));
vi.stubGlobal('useToastError', (...a: unknown[]) => toasts.error(...a));
vi.stubGlobal('useToastInfo', (...a: unknown[]) => toasts.info(...a));
vi.stubGlobal('useToastSuccess', (...a: unknown[]) => toasts.success(...a));
vi.stubGlobal('window', { location: { origin: 'https://nadeshiko.co' } });
// `formatMs` reaches the store through Nuxt's auto-import of `~/utils`, which
// vitest does not perform. The real one, so `{sentence-info}` renders the
// timestamp a card actually gets rather than a stand-in.
vi.stubGlobal('formatMs', formatMs);

import { ankiStore, type AnkiProfile } from './anki';

/** An AnkiConnect reply, as the add-on sends it: 200 with the outcome in the body. */
function ankiOk(result: unknown) {
  return new Response(JSON.stringify({ result, error: null }), { status: 200 });
}
function ankiRefused(message = 'valid api key must be provided') {
  return new Response(JSON.stringify({ result: null, error: message }), { status: 200 });
}

/** The URL the nth fetch was made against. */
function fetchUrl(index: number): string {
  const mock = globalThis.fetch as unknown as { mock: { calls: [string, { body: string }][] } };
  return mock.mock.calls[index]![0];
}

/** The parsed AnkiConnect body of the nth fetch. */
function fetchBody(index: number): { action: string; params: Record<string, any> } {
  const mock = globalThis.fetch as unknown as { mock: { calls: [string, { body: string }][] } };
  return JSON.parse(mock.mock.calls[index]![1].body);
}

/** The bodies of every AnkiConnect call made so far, parsed. */
function ankiCalls(): { action: string; params: Record<string, any> }[] {
  const mock = globalThis.fetch as unknown as { mock: { calls: [string, { body: string }][] } };
  return mock.mock.calls.map((call) => JSON.parse(call[1].body));
}

/** The body of the one call with `action`, or undefined if it was never made. */
function ankiCall(action: string) {
  return ankiCalls().find((body) => body.action === action);
}

/** Queues one fetch outcome per call, in order. */
function queueFetch(...outcomes: (Response | Error)[]) {
  const fetchMock = vi.fn();
  for (const outcome of outcomes) {
    if (outcome instanceof Error) fetchMock.mockRejectedValueOnce(outcome);
    else fetchMock.mockResolvedValueOnce(outcome);
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function makeProfile(overrides: Partial<AnkiProfile> = {}): AnkiProfile {
  return {
    id: 'p-1',
    name: 'Default',
    deck: 'Mining',
    model: 'Lapis',
    fields: [],
    key: 'Expression',
    serverAddress: 'http://127.0.0.1:8765',
    ...overrides,
  } as AnkiProfile;
}

/** Installs `profile` as the reader's only profile. */
function withProfile(profile: AnkiProfile) {
  user.preferences.ankiProfiles = [profile];
  return ankiStore();
}

const segment = {
  publicId: 'seg-1',
  episode: 3,
  startTimeMs: 61_500,
  textJa: { content: '食べたい', tokens: [] },
  textEn: { content: 'I want to eat' },
  textEs: { content: 'Quiero comer' },
  urls: { imageUrl: 'https://cdn.test/seg-1.webp', audioUrl: 'https://cdn.test/seg-1.mp3' },
};
const mediaEntry = {
  publicId: 'media-1',
  nameEn: 'Oshi no Ko',
  nameJa: '推しの子',
  nameRomaji: 'Oshi no Ko',
  airingFormat: 'TV',
};
const sentence = { segment, media: mediaEntry, blobAudio: null, blobAudioUrl: null };

/** The store takes a full `SearchResult`; these fixtures carry the fields it reads. */
const asResult = (result: unknown) => result as never;

beforeEach(() => {
  vi.clearAllMocks();
  refusedSince.mockReturnValue(false);
  user.isLoggedIn = true;
  user.preferences = { ankiProfiles: [], mediaNameLanguage: undefined };
});

describe('profiles', () => {
  test('there is no active profile before one is created', () => {
    expect(ankiStore().activeProfile).toBeNull();
  });

  test('the first profile is active by default, without anyone selecting it', () => {
    const store = withProfile(makeProfile({ id: 'p-1' }));

    expect(store.activeProfile?.id).toBe('p-1');
  });

  test('the selected profile wins over the first one', () => {
    user.preferences.ankiProfiles = [makeProfile({ id: 'p-1' }), makeProfile({ id: 'p-2' })];
    const store = ankiStore();

    store.setActiveProfileId('p-2');

    expect(store.activeProfile?.id).toBe('p-2');
  });

  test('a selection naming a profile that no longer exists falls back to the first', () => {
    // The stored id outlives the profile: it is in localStorage, the profiles
    // are on the server, and a delete from another tab leaves them disagreeing.
    user.preferences.ankiProfiles = [makeProfile({ id: 'p-1' })];
    const store = ankiStore();

    store.setActiveProfileId('p-deleted');

    expect(store.activeProfile?.id).toBe('p-1');
  });

  test('creating a profile saves it to the server and returns it', async () => {
    const store = ankiStore();

    const created = await store.createProfile('Mining');

    expect(created.name).toBe('Mining');
    expect(sdk.updateUserPreferences).toHaveBeenCalledWith({
      ankiProfiles: [expect.objectContaining({ name: 'Mining' })],
    });
  });

  test('a new profile starts on the loopback address AnkiConnect listens on', async () => {
    const store = ankiStore();

    expect((await store.createProfile('Mining')).serverAddress).toBe('http://127.0.0.1:8765');
  });

  test('updating the active profile leaves the others alone', async () => {
    user.preferences.ankiProfiles = [makeProfile({ id: 'p-1' }), makeProfile({ id: 'p-2', deck: 'Other' })];
    const store = ankiStore();
    store.setActiveProfileId('p-1');

    await store.updateActiveProfile({ deck: 'Changed' });

    const saved = sdk.updateUserPreferences.mock.calls[0]![0].ankiProfiles;
    expect(saved).toEqual([
      expect.objectContaining({ id: 'p-1', deck: 'Changed' }),
      expect.objectContaining({ id: 'p-2', deck: 'Other' }),
    ]);
  });

  test('updating with no active profile is a no-op rather than a write', async () => {
    await ankiStore().updateActiveProfile({ deck: 'Changed' });

    expect(sdk.updateUserPreferences).not.toHaveBeenCalled();
  });

  test('deleting the active profile promotes the next one', async () => {
    user.preferences.ankiProfiles = [makeProfile({ id: 'p-1' }), makeProfile({ id: 'p-2' })];
    const store = ankiStore();
    store.setActiveProfileId('p-1');

    await store.deleteProfile('p-1');

    expect(store.activeProfileId).toBe('p-2');
  });

  test('deleting the last profile clears the selection instead of pointing at nothing', async () => {
    const store = withProfile(makeProfile({ id: 'p-1' }));
    store.setActiveProfileId('p-1');

    await store.deleteProfile('p-1');

    expect(store.activeProfileId).toBeNull();
  });

  test('deleting a profile that is not the active one leaves the selection alone', async () => {
    user.preferences.ankiProfiles = [makeProfile({ id: 'p-1' }), makeProfile({ id: 'p-2' })];
    const store = ankiStore();
    store.setActiveProfileId('p-1');

    await store.deleteProfile('p-2');

    expect(store.activeProfileId).toBe('p-1');
  });
});

describe('executeAction: why a call failed', () => {
  test('a normal reply marks Anki reachable and clears the failure', async () => {
    queueFetch(ankiOk(['Mining']));
    const store = withProfile(makeProfile());

    await store.executeAction('deckNames');

    expect(store.connectReachable).toBe(true);
    expect(store.connectFailure).toBeNull();
  });

  test('a rejected fetch is `unreachable` -- the browser cannot tell us more', async () => {
    // Anki closed, add-on absent, origin not in its CORS list, or an extension
    // ate the request: all four are the same opaque TypeError.
    queueFetch(new TypeError('Failed to fetch'));
    const store = withProfile(makeProfile());

    expect(await store.executeAction('deckNames')).toBeNull();
    expect(store.connectFailure).toBe('unreachable');
    expect(store.connectReachable).toBe(false);
  });

  test('a rejection our own CSP caused is `blocked_by_csp`, on evidence rather than a guess', async () => {
    // The one member of that set the reader cannot fix and we can: `connect-src`
    // allows loopback only, so an address anywhere else is refused before it is
    // ever attempted.
    refusedSince.mockReturnValue(true);
    queueFetch(new TypeError('Failed to fetch'));
    const store = withProfile(makeProfile({ serverAddress: 'http://192.168.1.20:8765' }));

    await store.executeAction('deckNames');

    expect(store.connectFailure).toBe('blocked_by_csp');
  });

  test('a non-2xx answer is `http_error`, and stays that even though fetch then throws', async () => {
    // `http_error` is set before the throw and is more specific than anything
    // the catch block can tell, so it must not be overwritten there.
    queueFetch(new Response('nope', { status: 500 }));
    const store = withProfile(makeProfile());

    await store.executeAction('deckNames');

    expect(store.connectFailure).toBe('http_error');
  });

  test('an error in the body is `connect_error`, not silence', async () => {
    // AnkiConnect reports its own failures in the body WITH a 200. A refused
    // origin arrives as `{result: null, error: "..."}`, which a caller reading
    // `.result` cannot tell from "Anki is closed".
    queueFetch(ankiRefused());
    const store = withProfile(makeProfile());

    const body = await store.executeAction('deckNames');

    expect(store.connectFailure).toBe('connect_error');
    expect(store.connectReachable).toBe(true);
    expect(body.error).toBeTruthy();
  });

  test('posts to the profile’s own server address', async () => {
    queueFetch(ankiOk([]));
    const store = withProfile(makeProfile({ serverAddress: 'http://localhost:9999' }));

    await store.executeAction('deckNames');

    expect(fetchUrl(0)).toBe('http://localhost:9999');
  });

  test('falls back to the default address when no profile is configured yet', async () => {
    // The settings page probes before a profile exists.
    queueFetch(ankiOk([]));

    await ankiStore().executeAction('deckNames');

    expect(fetchUrl(0)).toBe('http://127.0.0.1:8765');
  });

  test('sends the AnkiConnect envelope, version and all', async () => {
    queueFetch(ankiOk([]));
    const store = withProfile(makeProfile());

    await store.executeAction('findNotes', { query: 'deck:Mining' });

    expect(fetchBody(0)).toEqual({
      action: 'findNotes',
      params: { query: 'deck:Mining' },
      version: 6,
    });
  });

  test('reports a failure the reader asked for', async () => {
    queueFetch(new TypeError('Failed to fetch'));
    const store = withProfile(makeProfile());

    await store.executeAction('deckNames');

    expect(reportEvent).toHaveBeenCalledWith(
      'anki_connect_request_failed',
      expect.objectContaining({ 'anki.action': 'deckNames', 'anki.reason': 'unreachable' }),
    );
  });

  test('stays silent for a probe the reader did not ask for', async () => {
    // The word card asks whether a word is already mined on every open, and
    // Anki being closed is the ordinary state. Reporting would file one event
    // per lookup and say nothing a rate of successful exports does not.
    queueFetch(new TypeError('Failed to fetch'));
    const store = withProfile(makeProfile());

    await store.executeAction('findNotes', {}, { silent: true });

    expect(reportEvent).not.toHaveBeenCalled();
  });

  test('reports a policy refusal even when silent, because that one we can fix', async () => {
    refusedSince.mockReturnValue(true);
    queueFetch(new TypeError('Failed to fetch'));
    const store = withProfile(makeProfile());

    await store.executeAction('findNotes', {}, { silent: true });

    expect(reportEvent).toHaveBeenCalledWith(
      'anki_connect_request_failed',
      expect.objectContaining({ 'anki.reason': 'blocked_by_csp' }),
    );
  });

  test('reports the shape of the address, never the address itself', async () => {
    queueFetch(new TypeError('Failed to fetch'));
    const store = withProfile(makeProfile({ serverAddress: 'http://192.168.1.20:8765' }));

    await store.executeAction('deckNames');

    const properties = reportEvent.mock.calls[0]![1];
    expect(properties['anki.address_kind']).toEqual(expect.any(String));
    expect(JSON.stringify(properties)).not.toContain('192.168.1.20');
  });
});

describe('getAllDeckNames / getAllModels', () => {
  test('return what Anki listed', async () => {
    queueFetch(ankiOk(['Mining', 'Default']));
    expect(await withProfile(makeProfile()).getAllDeckNames()).toEqual(['Mining', 'Default']);
  });

  test('a reader with genuinely no decks gets an empty list, NOT a failure', async () => {
    // The distinction the null is for: this reader needs to make a deck, and
    // that is a different message from "Anki did not answer".
    queueFetch(ankiOk([]));
    expect(await withProfile(makeProfile()).getAllDeckNames()).toEqual([]);
  });

  test('a refused lookup is null', async () => {
    queueFetch(ankiRefused());
    expect(await withProfile(makeProfile()).getAllDeckNames()).toBeNull();
  });

  test('note types answer the same way', async () => {
    queueFetch(ankiRefused());
    expect(await withProfile(makeProfile()).getAllModels()).toBeNull();
  });
});

describe('getAllModelFieldNames', () => {
  test('returns the note type’s fields', async () => {
    queueFetch(ankiOk(['Expression', 'Meaning', 'Audio']));
    const store = withProfile(makeProfile());

    expect(await store.getAllModelFieldNames('Japanese')).toEqual(['Expression', 'Meaning', 'Audio']);
  });

  test('reports a REFUSED lookup as null rather than as a note type with no fields', async () => {
    // AnkiConnect answers a refused origin with a 200 and `{result: null,
    // error: "..."}`, so nothing throws and the only difference from a real
    // answer is the shape of the body. Collapsing that to `[]` hands the caller
    // a note type that appears to have no fields at all -- and the one caller,
    // the note-type watcher in AnkiSync.vue, writes that emptiness straight
    // back to the reader's saved profile as their field mapping.
    queueFetch(ankiRefused());
    const store = withProfile(makeProfile());

    expect(await store.getAllModelFieldNames('Japanese')).toBeNull();
  });

  test('an HTTP failure is null too, not an empty note type', async () => {
    queueFetch(new Response('nope', { status: 500 }));
    const store = withProfile(makeProfile());

    expect(await store.getAllModelFieldNames('Japanese')).toBeNull();
  });
});

describe('loadAnkiData', () => {
  test('loads decks and models when permission is granted', async () => {
    queueFetch(ankiOk({ permission: 'granted' }), ankiOk(['Mining', 'Default']), ankiOk(['Lapis', 'Basic']));
    const store = withProfile(makeProfile());

    await store.loadAnkiData();

    expect(store.availableDecks).toEqual(['Mining', 'Default']);
    expect(store.availableModels).toEqual(['Lapis', 'Basic']);
    expect(store.connectFailure).toBeNull();
  });

  test('a granted load is reported as a success with its counts', async () => {
    queueFetch(ankiOk({ permission: 'granted' }), ankiOk(['Mining']), ankiOk(['Lapis']));
    const store = withProfile(makeProfile());

    await store.loadAnkiData();

    expect(posthog.capture).toHaveBeenCalledWith('anki_connection_tested', {
      success: true,
      deck_count: 1,
      model_count: 1,
    });
  });

  test('an unreachable Anki throws, keeping the more specific reason executeAction found', async () => {
    queueFetch(new TypeError('Failed to fetch'));
    const store = withProfile(makeProfile());

    await expect(store.loadAnkiData()).rejects.toThrow(/AnkiConnect did not respond/);
    expect(store.connectFailure).toBe('unreachable');
  });

  test('a refused permission is `permission_denied`, not a silent empty deck list', async () => {
    // This used to fall through: the check only ruled out `null`, so a reader
    // who dismissed the "allow this origin?" dialog was reported as a SUCCESS
    // with zero decks, and shown a panel telling them to check Anki is running
    // -- which it was, with the dialog sitting behind their browser.
    queueFetch(ankiOk({ permission: 'denied' }));
    const store = withProfile(makeProfile());

    await expect(store.loadAnkiData()).rejects.toThrow(/refused this site/);
    expect(store.connectFailure).toBe('permission_denied');
  });

  test('Anki going quiet mid-load is reported as the connection failure it is, not as `no_decks`', async () => {
    // Permission granted, then the deck lookup gets a refusal. That collapsed to
    // `[]` and arrived at the "you have no decks" branch -- the one branch whose
    // advice is "go and make a deck", which is the wrong errand entirely -- and
    // on the way it overwrote the specific reason `executeAction` had already
    // worked out. The permission probe directly above goes out of its way to
    // preserve that reason; this path threw it away.
    queueFetch(ankiOk({ permission: 'granted' }), ankiRefused(), ankiOk(['Lapis']));
    const store = withProfile(makeProfile());

    await expect(store.loadAnkiData()).rejects.toThrow(/stopped answering/);
    expect(store.connectFailure).toBe('connect_error');
  });

  test('a note-type lookup that fails is a failure too, not a reader with no note types', async () => {
    queueFetch(ankiOk({ permission: 'granted' }), ankiOk(['Mining']), ankiRefused());
    const store = withProfile(makeProfile());

    await expect(store.loadAnkiData()).rejects.toThrow(/stopped answering/);
  });

  test('a dropped connection leaves the decks already loaded alone', async () => {
    // Rather than emptying the dropdowns the reader was working in.
    queueFetch(ankiOk({ permission: 'granted' }), ankiOk(['Mining']), ankiOk(['Lapis']));
    const store = withProfile(makeProfile());
    await store.loadAnkiData();

    queueFetch(ankiOk({ permission: 'granted' }), ankiRefused(), ankiOk(['Lapis']));
    await expect(store.loadAnkiData()).rejects.toThrow();

    expect(store.availableDecks).toEqual(['Mining']);
  });

  test('granted but with nothing to export into is `no_decks`, a different fix from every other branch', async () => {
    queueFetch(ankiOk({ permission: 'granted' }), ankiOk([]), ankiOk(['Lapis']));
    const store = withProfile(makeProfile());

    await expect(store.loadAnkiData()).rejects.toThrow(/no decks/);
    expect(store.connectFailure).toBe('no_decks');
  });

  test.each([
    ['unreachable', () => queueFetch(new TypeError('Failed to fetch'))],
    ['permission_denied', () => queueFetch(ankiOk({ permission: 'denied' }))],
    ['no_decks', () => queueFetch(ankiOk({ permission: 'granted' }), ankiOk([]), ankiOk([]))],
  ])('a %s failure is reported with its reason, which is the entire point of the event', async (reason, setup) => {
    setup();
    const store = withProfile(makeProfile());

    await store.loadAnkiData().catch(() => {});

    expect(posthog.capture).toHaveBeenCalledWith('anki_connection_tested', { success: false, reason });
  });
});

describe('getNotesWithCurrentKey', () => {
  test('returns the key field of each matching note', async () => {
    queueFetch(
      ankiOk([1, 2]),
      ankiOk([
        { noteId: 1, fields: { Expression: { value: '食べる' } } },
        { noteId: 2, fields: { Expression: { value: '飲む' } } },
      ]),
    );
    const store = withProfile(makeProfile({ key: 'Expression' }));

    expect(await store.getNotesWithCurrentKey('deck:Mining')).toEqual([
      { noteId: 1, value: '食べる' },
      { noteId: 2, value: '飲む' },
    ]);
  });

  test('labels a note whose key field is missing rather than showing a blank row', async () => {
    queueFetch(ankiOk([1]), ankiOk([{ noteId: 1, fields: {} }]));
    const store = withProfile(makeProfile({ key: 'Expression' }));

    expect(await store.getNotesWithCurrentKey('deck:Mining')).toEqual([{ noteId: 1, value: 'None' }]);
  });

  test('returns nothing when the query matched nothing, without a second round trip', async () => {
    const fetchMock = queueFetch(ankiOk([]));
    const store = withProfile(makeProfile());

    expect(await store.getNotesWithCurrentKey('deck:Empty')).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('asks about at most the requested number of notes', async () => {
    // `notesInfo` returns every field of every note asked for, which on a
    // mining deck is the full card HTML.
    queueFetch(ankiOk([1, 2, 3, 4, 5, 6, 7]), ankiOk([]));
    const store = withProfile(makeProfile());

    await store.getNotesWithCurrentKey('deck:Mining', 3);

    expect(fetchBody(1).params.notes).toEqual([1, 2, 3]);
  });

  test('returns nothing, rather than throwing, when Anki is unreachable', async () => {
    queueFetch(new TypeError('Failed to fetch'), new TypeError('Failed to fetch'));
    const store = withProfile(makeProfile());

    expect(await store.getNotesWithCurrentKey('deck:Mining')).toEqual([]);
  });
});

describe('mostCommonModelInDeck', () => {
  test('suggests the note type the deck is mostly made of', async () => {
    queueFetch(
      ankiOk([1, 2, 3]),
      ankiOk([
        { noteId: 1, modelName: 'Lapis', fields: {} },
        { noteId: 2, modelName: 'Lapis', fields: {} },
        { noteId: 3, modelName: 'Basic', fields: {} },
      ]),
    );
    const store = withProfile(makeProfile());

    expect(await store.mostCommonModelInDeck('Mining')).toBe('Lapis');
  });

  test('samples the newest notes, not the whole deck', async () => {
    // A deck reorganised months ago should be answered by what the reader adds
    // now -- and `notesInfo` on 40k notes is megabytes of card HTML to count a
    // string.
    const ids = Array.from({ length: 500 }, (_, i) => i + 1);
    queueFetch(ankiOk(ids), ankiOk([]));
    const store = withProfile(makeProfile());

    await store.mostCommonModelInDeck('Mining');

    const sampled = fetchBody(1).params.notes;
    expect(sampled).toHaveLength(100);
    expect(sampled.at(-1)).toBe(500);
  });

  test('suggests nothing for an empty deck', async () => {
    queueFetch(ankiOk([]));

    expect(await withProfile(makeProfile()).mostCommonModelInDeck('Mining')).toBeNull();
  });

  test('suggests nothing when no deck was named', async () => {
    expect(await withProfile(makeProfile()).mostCommonModelInDeck('')).toBeNull();
  });

  test('never interrupts deck selection when the probe fails', async () => {
    // This runs while the reader is choosing. A suggestion that cannot be made
    // is not an error worth stopping them for -- they were going to choose.
    queueFetch(new TypeError('Failed to fetch'));

    expect(await withProfile(makeProfile()).mostCommonModelInDeck('Mining')).toBeNull();
  });
});

describe('the Anki Exports collection', () => {
  test('reuses the existing one rather than creating a second', async () => {
    sdk.listCollections.mockResolvedValue({ collections: [{ type: 'ANKI_EXPORT', publicId: 'col-existing' }] });

    expect(await ankiStore().getOrCreateAnkiExportsCollectionId()).toBe('col-existing');
    expect(sdk.createCollection).not.toHaveBeenCalled();
  });

  test('creates a private one when there is none', async () => {
    sdk.listCollections.mockResolvedValue({ collections: [] });

    expect(await ankiStore().getOrCreateAnkiExportsCollectionId()).toBe('col-1');
    expect(sdk.createCollection).toHaveBeenCalledWith({ name: 'Anki Exports', visibility: 'PRIVATE' });
  });

  test('a 401 signs the reader out instead of filing a report', async () => {
    // `isLoggedIn` is persisted and only reconciled by `getBasicInfo`, so
    // between two of those every export files one of these. One reader produced
    // 49 reports in a sitting that way while their cards silently stopped being
    // recorded.
    sdk.listCollections.mockRejectedValue({ statusCode: 401 });

    expect(await ankiStore().getOrCreateAnkiExportsCollectionId()).toBeNull();
    expect(user.resetAuthState).toHaveBeenCalled();
    expect(handleApiError).not.toHaveBeenCalled();
  });

  test.each([500, 429])('a %d does NOT sign the reader out', async (statusCode) => {
    // Only a 401 means the session is really gone. A 5xx, a network blip or a
    // rate limit must not log anybody out.
    sdk.listCollections.mockRejectedValue({ statusCode });

    await ankiStore().getOrCreateAnkiExportsCollectionId();

    expect(user.resetAuthState).not.toHaveBeenCalled();
    expect(handleApiError).toHaveBeenCalled();
  });

  test('a failure to record the export never raises a toast, since the card still landed', async () => {
    sdk.listCollections.mockRejectedValue({ statusCode: 500 });

    await ankiStore().getOrCreateAnkiExportsCollectionId();

    expect(handleApiError.mock.calls[0]![2]).toMatchObject({ toastKey: false });
  });

  test('a signed-out reader is not asked about collections at all', async () => {
    user.isLoggedIn = false;

    await ankiStore().addSegmentToAnkiExportsCollection(asResult(sentence));

    expect(sdk.listCollections).not.toHaveBeenCalled();
  });

  test('a duplicate is the desired end state, not a failure to report', async () => {
    sdk.listCollections.mockResolvedValue({ collections: [{ type: 'ANKI_EXPORT', publicId: 'col-1' }] });
    sdk.addSegmentToCollection.mockRejectedValue({ statusCode: 409 });

    await ankiStore().addSegmentToAnkiExportsCollection(asResult(sentence));

    expect(handleApiError).not.toHaveBeenCalled();
  });

  test('any other failure is recorded', async () => {
    sdk.listCollections.mockResolvedValue({ collections: [{ type: 'ANKI_EXPORT', publicId: 'col-1' }] });
    sdk.addSegmentToCollection.mockRejectedValue({ statusCode: 500 });

    await ankiStore().addSegmentToAnkiExportsCollection(asResult(sentence));

    expect(handleApiError).toHaveBeenCalledWith(
      'anki:exports-collection-sync-failed',
      expect.anything(),
      expect.anything(),
    );
  });
});

describe('addResultToAnki: which fields get written', () => {
  /** Runs an export against a profile whose fields are `mapping`, and returns what was written. */
  async function exportWith(
    mapping: Record<string, string>,
    options: Parameters<ReturnType<typeof ankiStore>['addResultToAnki']>[1] = {},
    opts: { profile?: Partial<AnkiProfile> } = {},
  ) {
    const fields = Object.entries(mapping).map(([key, value]) => ({ key, value }));
    const store = withProfile(makeProfile({ fields, openBrowserOnExport: false, ...opts.profile } as never));

    // findNotes -> the last-added card; notesInfo -> that note; updateNoteFields.
    queueFetch(ankiOk([12]), ankiOk([{ noteId: 12, fields: {}, modelName: 'Lapis' }]), ankiOk(null));

    await store.addResultToAnki(asResult(sentence), options);

    const update = ankiCall('updateNoteFields')!;
    return update?.params.note.fields as Record<string, string> | undefined;
  }

  const minedWord = {
    word: '食べる',
    reading: 'たべる',
    furigana: '食[た]べる',
    definition: 'to eat',
    definitionFirst: 'to eat (first)',
    pitch: 'LHH',
    pitchPositions: '2',
    frequency: '1200',
    jlpt: 'N5',
    pitchCategories: 'nakadaka',
    info: 'godan',
    sentenceHighlight: '<b>食べ</b>たい',
    definitionsByDictionary: { jmdict: 'to eat (jmdict)' },
    pickedDictionaries: 1,
  } as never;

  test('writes the sentence into a field mapped to it', async () => {
    expect(await exportWith({ Sentence: '{sentence-jp}' })).toEqual({ Sentence: '<div>食べたい</div>' });
  });

  test('writes the translations that exist', async () => {
    const written = await exportWith({ EN: '{sentence-en}', ES: '{sentence-es}' });

    expect(written).toEqual({ EN: '<div>I want to eat</div>', ES: '<div>Quiero comer</div>' });
  });

  test('leaves a translation field alone when the sentence has no such translation', async () => {
    // Blanking it would erase whatever the reader had there.
    const bare = { ...sentence, segment: { ...segment, textEs: { content: '' } } };
    const store = withProfile(
      makeProfile({ fields: [{ key: 'ES', value: '{sentence-es}' }], openBrowserOnExport: false } as never),
    );
    queueFetch(ankiOk([12]), ankiOk([{ noteId: 12, fields: {} }]), ankiOk(null));

    await store.addResultToAnki(asResult(bare), {});

    const update = ankiCall('updateNoteFields')!;
    expect(update.params.note.fields).toEqual({});
  });

  test('an {empty} field is a deliberate clear, unlike an absent value', async () => {
    expect(await exportWith({ Notes: '{empty}' })).toEqual({ Notes: '' });
  });

  test('writes the word fields when a word was mined', async () => {
    const written = await exportWith(
      { Word: '{word}', Reading: '{word-reading}', Def: '{definition}' },
      {
        word: minedWord,
      },
    );

    expect(written).toEqual({ Word: '食べる', Reading: 'たべる', Def: 'to eat' });
  });

  test('leaves every word field ALONE when no word was selected', async () => {
    // The invariant the whole feature rests on. Two paths reach here without a
    // word -- the dropdown's "last added card" and the note picker -- and on a
    // Yomitan-made note that field holds the definition the reader wrote.
    expect(await exportWith({ Word: '{word}', Def: '{definition}' })).toEqual({});
  });

  test('leaves word fields alone on the "add context only" path, even with a word in hand', async () => {
    // `wordFields: false` is "enrich the card I already have with this
    // sentence": keep my glossary, add your example.
    const written = await exportWith(
      { Sentence: '{sentence-jp}', Def: '{definition}' },
      {
        word: minedWord,
        wordFields: false,
      },
    );

    expect(written).toEqual({ Sentence: '<div>食べたい</div>' });
  });

  test('a composite field mixing sentence and word is left alone entirely when there is no word', async () => {
    // Writing its sentence half and blanking its word half is the
    // glossary-clobbering this exists to avoid. One word placeholder is enough
    // to leave the whole field alone.
    expect(await exportWith({ Both: '{sentence-jp}<br>{definition}' })).toEqual({});
  });

  test('a composite writes both halves when there is a word', async () => {
    const written = await exportWith({ Both: '{sentence-jp}<br>{definition}' }, { word: minedWord });

    expect(written).toEqual({ Both: '<div>食べたい</div><br>to eat' });
  });

  test('a composite survives one absent part rather than losing the whole field', async () => {
    // A word with no pitch still gets its definition.
    const noPitch = { ...(minedWord as object), pitch: undefined } as never;

    const written = await exportWith({ Both: '{definition} {word-pitch}' }, { word: noPitch });

    expect(written).toEqual({ Both: 'to eat ' });
  });

  test('{sentence-furigana} fills without a word, because it is a fact about the line', async () => {
    // Beside `sentence-jp` rather than with the word fields: it survives the
    // "keep my glossary" path.
    const written = await exportWith({ Furigana: '{sentence-furigana}' });

    expect(written?.Furigana).toBeDefined();
  });

  test('{content_jp_highlight} fills from a word, marking which one was mined', async () => {
    const written = await exportWith({ Marked: '{content_jp_highlight}' }, { word: minedWord });

    expect(written).toEqual({ Marked: '<b>食べ</b>たい' });
  });

  test('a named dictionary writes that dictionary’s definition', async () => {
    const written = await exportWith({ JMdict: '{definition:jmdict}' }, { word: minedWord });

    expect(written).toEqual({ JMdict: 'to eat (jmdict)' });
  });

  test('a named dictionary the word is NOT in CLEARS the field', async () => {
    // Unlike every other word field. This one is empty when the open word is
    // not in that dictionary, and leaving the previous export's text there
    // would put ANOTHER WORD's definition on this note.
    const written = await exportWith({ Daijirin: '{definition:daijirin}' }, { word: minedWord });

    expect(written).toEqual({ Daijirin: '' });
  });

  test('a bare {definition} does not claim the {definition:slug} prefix', async () => {
    const written = await exportWith({ A: '{definition}', B: '{definition:jmdict}' }, { word: minedWord });

    expect(written).toEqual({ A: 'to eat', B: 'to eat (jmdict)' });
  });

  test('{word} does not swallow the {word-*} fields it is a prefix of', async () => {
    const written = await exportWith({ W: '{word}', R: '{word-reading}', F: '{word-furigana}' }, { word: minedWord });

    expect(written).toEqual({ W: '食べる', R: 'たべる', F: '食[た]べる' });
  });

  test('the sentence info block links back to the sentence on the site', async () => {
    const written = await exportWith({ Info: '{sentence-info}' });

    expect(written?.Info).toContain('https://nadeshiko.co');
    expect(written?.Info).toContain('Episode 3');
  });

  test('a movie says Movie rather than an episode number it does not have', async () => {
    const movie = { ...sentence, media: { ...mediaEntry, airingFormat: 'MOVIE' } };
    const store = withProfile(
      makeProfile({ fields: [{ key: 'Info', value: '{sentence-info}' }], openBrowserOnExport: false } as never),
    );
    queueFetch(ankiOk([12]), ankiOk([{ noteId: 12, fields: {} }]), ankiOk(null));

    await store.addResultToAnki(asResult(movie), {});

    const update = ankiCall('updateNoteFields')!;
    expect(update.params.note.fields.Info).toContain('Movie');
    expect(update.params.note.fields.Info).not.toContain('Episode');
  });

  test('an unmapped field is skipped rather than written empty', async () => {
    expect(await exportWith({ Unset: '' })).toEqual({});
  });
});

describe('addResultToAnki: choosing what to write to', () => {
  test('refuses without a configured profile, and says why', async () => {
    await ankiStore().addResultToAnki(asResult(sentence), {});

    expect(toasts.error).toHaveBeenCalledWith('anki.toast.noSettings');
    expect(posthog.capture).toHaveBeenCalledWith(
      'anki_export_failed',
      expect.objectContaining({ reason: 'no_profile' }),
    );
  });

  test('targets the newest card added in the reader’s deck', async () => {
    queueFetch(ankiOk([10, 42, 7]), ankiOk([{ noteId: 42, fields: {} }]), ankiOk(null));
    const store = withProfile(
      makeProfile({ fields: [{ key: 'S', value: '{sentence-jp}' }], openBrowserOnExport: false } as never),
    );

    await store.addResultToAnki(asResult(sentence), {});

    const update = ankiCall('updateNoteFields')!;
    expect(update.params.note.id).toBe(42);
  });

  test('tells the reader when their card landed in a different deck', async () => {
    // A distinct fix from "add a card first", and the two used to be one
    // message. The deck query finds nothing; the global one finds a card.
    queueFetch(ankiOk([]), ankiOk([99]));
    const store = withProfile(makeProfile({ openBrowserOnExport: false }));

    await store.addResultToAnki(asResult(sentence), {});

    expect(toasts.error).toHaveBeenCalledWith('anki.toast.cardFoundInOtherDeck');
    expect(posthog.capture).toHaveBeenCalledWith(
      'anki_export_failed',
      expect.objectContaining({ reason: 'card_in_other_deck' }),
    );
  });

  test('an Anki that has stopped answering says so, rather than "add a card first"', async () => {
    // `executeAction` reports its failures by RETURNING rather than throwing, so
    // a dead Anki arrived here indistinguishable from a search that matched
    // nothing. The reader was sent to add a card -- an errand for a problem they
    // do not have, while the real one is that Anki is not running -- and the
    // export was counted as `no_card_found`, hiding these inside a number that
    // is supposed to mean something else entirely.
    queueFetch(new TypeError('Failed to fetch'));
    const store = withProfile(makeProfile({ openBrowserOnExport: false }));

    await store.addResultToAnki(asResult(sentence), {});

    expect(toasts.error).toHaveBeenCalledWith('accountSettings.anki.connectFailure.unreachable.title');
    expect(posthog.capture).toHaveBeenCalledWith(
      'anki_export_failed',
      expect.objectContaining({ reason: 'anki_unavailable' }),
    );
  });

  test('AnkiConnect refusing the search is caught too, though it answers with a 200', async () => {
    // The shape that no `catch` will ever see.
    queueFetch(ankiRefused());
    const store = withProfile(makeProfile({ openBrowserOnExport: false }));

    await store.addResultToAnki(asResult(sentence), {});

    expect(toasts.error).toHaveBeenCalledWith('accountSettings.anki.connectFailure.connect_error.title');
  });

  test('tells the reader when there is no freshly added card anywhere', async () => {
    // The most common abandoned export by far, and it used to be invisible:
    // these early returns reached neither error tracking nor the failure event,
    // so the failure rate read as ~0.5% against 8.7k exports.
    queueFetch(ankiOk([]), ankiOk([]));
    const store = withProfile(makeProfile({ openBrowserOnExport: false }));

    await store.addResultToAnki(asResult(sentence), {});

    expect(toasts.error).toHaveBeenCalledWith('anki.toast.noCardToExport');
    expect(posthog.capture).toHaveBeenCalledWith(
      'anki_export_failed',
      expect.objectContaining({ reason: 'no_card_found' }),
    );
  });

  test('writes to the note the picker resolved, without searching for one', async () => {
    const fetchMock = queueFetch(ankiOk([{ noteId: 77, fields: {} }]), ankiOk(null));
    const store = withProfile(
      makeProfile({ fields: [{ key: 'S', value: '{sentence-jp}' }], openBrowserOnExport: false } as never),
    );

    await store.addResultToAnki(asResult(sentence), { noteId: 77 });

    const actions = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).action);
    expect(actions).not.toContain('findNotes');
  });

  test('creates a tagged note when the collection was asked and said no', async () => {
    queueFetch(ankiOk(555), ankiOk(null));
    const store = withProfile(
      makeProfile({ fields: [{ key: 'S', value: '{sentence-jp}' }], openBrowserOnExport: false } as never),
    );

    await store.addResultToAnki(asResult(sentence), { create: true });

    const add = ankiCall('addNote')!;
    expect(add.params.note).toMatchObject({ deckName: 'Mining', modelName: 'Lapis', tags: ['nadeshiko'] });
  });

  test('refuses a duplicate on create, because a wrong note is worse than a refused one', async () => {
    // Anki's own duplicate check as a backstop to the probe: a rejected create
    // is a toast, a wrong one is a duplicate the reader merges by hand.
    queueFetch(ankiOk(555), ankiOk(null));
    const store = withProfile(
      makeProfile({ fields: [{ key: 'S', value: '{sentence-jp}' }], openBrowserOnExport: false } as never),
    );

    await store.addResultToAnki(asResult(sentence), { create: true });

    const add = ankiCall('addNote')!;
    expect(add.params.note.options).toEqual({ allowDuplicate: false });
  });

  test('reports a create that Anki refused', async () => {
    queueFetch(new Response(JSON.stringify({ result: null, error: 'duplicate' }), { status: 200 }));
    const store = withProfile(
      makeProfile({ fields: [{ key: 'S', value: '{sentence-jp}' }], openBrowserOnExport: false } as never),
    );

    await store.addResultToAnki(asResult(sentence), { create: true });

    expect(posthog.capture).toHaveBeenCalledWith(
      'anki_export_failed',
      expect.objectContaining({ reason: 'create_failed', error_message: 'duplicate' }),
    );
  });

  test('a successful export is reported with the surface it came from', async () => {
    queueFetch(ankiOk([{ noteId: 77, fields: {} }]), ankiOk(null));
    const store = withProfile(
      makeProfile({ fields: [{ key: 'S', value: '{sentence-jp}' }], openBrowserOnExport: false } as never),
    );

    await store.addResultToAnki(asResult(sentence), { noteId: 77, method: 'word_card' });

    expect(posthog.capture).toHaveBeenCalledWith(
      'anki_export_completed',
      expect.objectContaining({ export_method: 'word_card' }),
    );
  });

  test('the surface falls back to how the target was chosen for callers that do not say', async () => {
    queueFetch(ankiOk([{ noteId: 77, fields: {} }]), ankiOk(null));
    const store = withProfile(
      makeProfile({ fields: [{ key: 'S', value: '{sentence-jp}' }], openBrowserOnExport: false } as never),
    );

    await store.addResultToAnki(asResult(sentence), { noteId: 77 });

    expect(posthog.capture).toHaveBeenCalledWith(
      'anki_export_completed',
      expect.objectContaining({ export_method: 'search_by_id' }),
    );
  });

  test('opens the Anki browser around the write when the reader wants it', async () => {
    // Twice: once to park the browser off the note being edited, once to show
    // the result. Anki repaints a note the browser has open mid-write.
    // notesInfo, guiBrowse(park), updateNoteFields, guiBrowse(show).
    queueFetch(ankiOk([{ noteId: 77, fields: {} }]), ankiOk(null), ankiOk(null), ankiOk(null));
    const store = withProfile(
      makeProfile({ fields: [{ key: 'S', value: '{sentence-jp}' }], openBrowserOnExport: true } as never),
    );

    await store.addResultToAnki(asResult(sentence), { noteId: 77 });

    const browses = ankiCalls().filter((body) => body.action === 'guiBrowse');
    expect(browses).toHaveLength(2);
    expect(browses[1]!.params.query).toBe('nid:77');
  });

  test('records the export as activity for a signed-in reader', async () => {
    queueFetch(ankiOk([{ noteId: 77, fields: {} }]), ankiOk(null));
    const store = withProfile(
      makeProfile({ fields: [{ key: 'S', value: '{sentence-jp}' }], openBrowserOnExport: false } as never),
    );

    await store.addResultToAnki(asResult(sentence), { noteId: 77 });

    expect(sdk.trackUserActivity).toHaveBeenCalledWith(expect.objectContaining({ activityType: 'ANKI_EXPORT' }));
  });

  test('does not record activity for a signed-out reader', async () => {
    user.isLoggedIn = false;
    queueFetch(ankiOk([{ noteId: 77, fields: {} }]), ankiOk(null));
    const store = withProfile(
      makeProfile({ fields: [{ key: 'S', value: '{sentence-jp}' }], openBrowserOnExport: false } as never),
    );

    await store.addResultToAnki(asResult(sentence), { noteId: 77 });

    expect(sdk.trackUserActivity).not.toHaveBeenCalled();
  });

  test('an export that already succeeded is never undone by failed telemetry', async () => {
    sdk.trackUserActivity.mockRejectedValue(new Error('network'));
    queueFetch(ankiOk([{ noteId: 77, fields: {} }]), ankiOk(null));
    const store = withProfile(
      makeProfile({ fields: [{ key: 'S', value: '{sentence-jp}' }], openBrowserOnExport: false } as never),
    );

    await store.addResultToAnki(asResult(sentence), { noteId: 77 });

    expect(toasts.success).toHaveBeenCalledWith('anki.toast.cardAdded');
  });

  test('a missing note reports and stops instead of writing nowhere', async () => {
    queueFetch(ankiOk([]));
    const store = withProfile(
      makeProfile({ fields: [{ key: 'S', value: '{sentence-jp}' }], openBrowserOnExport: false } as never),
    );

    await store.addResultToAnki(asResult(sentence), { noteId: 77 });

    expect(posthog.capture).toHaveBeenCalledWith(
      'anki_export_failed',
      expect.objectContaining({ reason: 'no_note_info' }),
    );
  });
});

describe('addResultToAnki: media uploads', () => {
  test('does not fetch a still when no field asks for one', async () => {
    queueFetch(ankiOk([{ noteId: 77, fields: {} }]), ankiOk(null));
    const store = withProfile(
      makeProfile({ fields: [{ key: 'S', value: '{sentence-jp}' }], openBrowserOnExport: false } as never),
    );

    await store.addResultToAnki(asResult(sentence), { noteId: 77 });

    const stores = ankiCalls().filter((body) => body.action === 'storeMediaFile');
    expect(stores).toHaveLength(0);
  });

  test('uploads the still by URL and writes an img tag', async () => {
    const fetchMock = queueFetch(ankiOk([{ noteId: 77, fields: {} }]), ankiOk('seg-1.webp'), ankiOk(null));
    const store = withProfile(
      makeProfile({ fields: [{ key: 'Img', value: '{image}' }], openBrowserOnExport: false } as never),
    );

    await store.addResultToAnki(asResult(sentence), { noteId: 77 });

    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies.find((b) => b.action === 'storeMediaFile').params.url).toBe('https://cdn.test/seg-1.webp');
    expect(bodies.find((b) => b.action === 'updateNoteFields').params.note.fields.Img).toBe('<img src="seg-1.webp">');
  });

  test('a failed upload leaves the field alone rather than writing a broken tag', async () => {
    // The sentence text still lands; a missing file is the same situation as a
    // field the reader never mapped.
    queueFetch(ankiOk([{ noteId: 77, fields: {} }]), ankiOk(null), ankiOk(null), ankiOk(null));
    const store = withProfile(
      makeProfile({
        fields: [
          { key: 'Img', value: '{image}' },
          { key: 'S', value: '{sentence-jp}' },
        ],
        openBrowserOnExport: false,
      } as never),
    );

    await store.addResultToAnki(asResult(sentence), { noteId: 77 });

    const update = ankiCall('updateNoteFields')!;
    expect(update.params.note.fields).toEqual({ S: '<div>食べたい</div>' });
  });

  test('does not ask for word audio the word does not have', async () => {
    // Coverage is per clip: asking for one never generated spends a round trip
    // to be told nothing.
    queueFetch(ankiOk([{ noteId: 77, fields: {} }]), ankiOk(null));
    const store = withProfile(
      makeProfile({ fields: [{ key: 'WA', value: '{word-audio}' }], openBrowserOnExport: false } as never),
    );

    await store.addResultToAnki(asResult(sentence), { noteId: 77, word: { word: '食べる' } as never });

    const stores = ankiCalls().filter((body) => body.action === 'storeMediaFile');
    expect(stores).toHaveLength(0);
  });

  test('uploads word audio by URL when the word has one', async () => {
    queueFetch(ankiOk([{ noteId: 77, fields: {} }]), ankiOk('taberu.mp3'), ankiOk(null));
    const store = withProfile(
      makeProfile({ fields: [{ key: 'WA', value: '{word-audio}' }], openBrowserOnExport: false } as never),
    );

    await store.addResultToAnki(asResult(sentence), {
      noteId: 77,
      word: { word: '食べる', audioUrl: 'https://shirabe.test/taberu.mp3', audioFilename: 'taberu.mp3' } as never,
    });

    const update = ankiCall('updateNoteFields')!;
    expect(update.params.note.fields.WA).toBe('[sound:taberu.mp3]');
  });
});

describe('media names on the card', () => {
  /** The `{sentence-info}` block an export writes, which is where the title appears. */
  async function infoBlockWith(mediaNameLanguage: string | undefined) {
    user.preferences.mediaNameLanguage = mediaNameLanguage;
    const store = withProfile(
      makeProfile({ fields: [{ key: 'Info', value: '{sentence-info}' }], openBrowserOnExport: false } as never),
    );
    queueFetch(ankiOk([{ noteId: 77, fields: {} }]), ankiOk(null));

    await store.addResultToAnki(asResult(sentence), { noteId: 77 });

    return ankiCall('updateNoteFields')!.params.note.fields.Info as string;
  }

  test('uses the reader’s preferred title language', async () => {
    expect(await infoBlockWith('JAPANESE')).toContain('推しの子');
  });

  test('falls back through the other names rather than writing an empty title', async () => {
    // Media without a title in the preferred language would otherwise put a
    // blank name on the card and store a blank one on the activity.
    user.preferences.ankiProfiles = [];
    const partial = {
      ...sentence,
      media: { publicId: 'media-1', nameEn: '', nameJa: '', nameRomaji: 'Oshi no Ko', airingFormat: 'TV' },
    };
    user.preferences.mediaNameLanguage = 'JAPANESE';
    const store = withProfile(
      makeProfile({ fields: [{ key: 'Info', value: '{sentence-info}' }], openBrowserOnExport: false } as never),
    );
    queueFetch(ankiOk([{ noteId: 77, fields: {} }]), ankiOk(null));

    await store.addResultToAnki(asResult(partial), { noteId: 77 });

    const info = ankiCall('updateNoteFields')!.params.note.fields.Info;
    expect(info).toContain('Oshi no Ko');
  });
});

describe('addResultToAnki: the rest of the word placeholders', () => {
  /**
   * Every word placeholder the card offers, and what it should write.
   *
   * Table-driven because the risk here is uniform and unglamorous: each of
   * these is a `case` in one switch, and a placeholder that falls THROUGH it
   * matches the field regex, writes nothing, and reports success. That is how
   * `{content_jp_highlight}` sat reserved-but-unhandled -- readers who found
   * the name in the list got a silently empty field and no error.
   */
  const minedWord = {
    word: '食べる',
    reading: 'たべる',
    definitionFirst: 'to eat (first sense only)',
    pitch: 'LHH',
    pitchPositions: '2',
    frequency: '1200',
    jlpt: 'N5',
    pitchCategories: 'nakadaka',
    info: 'godan verb',
    sentenceHighlight: '<b>食べ</b>たい',
  } as never;

  /**
   * `word` is `null` for "nothing was mined", never `undefined`: a default
   * parameter swallows `undefined` and hands the call the mined word back, so
   * every "left alone" case below would silently test the opposite branch.
   */
  async function exportField(placeholder: string, word: unknown = minedWord) {
    const store = withProfile(
      makeProfile({ fields: [{ key: 'F', value: placeholder }], openBrowserOnExport: false } as never),
    );
    queueFetch(ankiOk([12]), ankiOk([{ noteId: 12, fields: {}, modelName: 'Lapis' }]), ankiOk(null));

    await store.addResultToAnki(asResult(sentence), { word: (word ?? undefined) as never });

    return (ankiCall('updateNoteFields')?.params.note.fields as Record<string, string>) ?? {};
  }

  test.each([
    ['{definition-first}', 'to eat (first sense only)'],
    ['{word-pitch}', 'LHH'],
    ['{word-pitch-num}', '2'],
    ['{word-frequency}', '1200'],
    ['{word-jlpt}', 'N5'],
    ['{word-pitch-categories}', 'nakadaka'],
    ['{word-info}', 'godan verb'],
  ])('%s writes the value the card showed', async (placeholder, expected) => {
    expect(await exportField(placeholder)).toEqual({ F: expected });
  });

  test('{content_jp_highlight} writes the sentence with the mined word marked', async () => {
    // A separate field from `{sentence-jp}` on purpose: the plain one keeps
    // working exactly as it did, so nobody's existing cards change shape.
    expect(await exportField('{content_jp_highlight}')).toEqual({ F: '<b>食べ</b>たい' });
  });

  test.each([
    ['{definition-first}'],
    ['{word-pitch}'],
    ['{word-frequency}'],
    ['{word-jlpt}'],
    ['{content_jp_highlight}'],
  ])('%s is left ALONE when no word was mined', async (placeholder) => {
    // On a Yomitan-made note these hold what the reader wrote. Blanking them is
    // silent, destructive, and indistinguishable from a successful export.
    expect(await exportField(placeholder, null)).toEqual({});
  });

  test('a placeholder outside the allowed list is left alone rather than blanked', async () => {
    // Not the switch's `default`, which is unreachable -- every name in
    // `allowedFields` has a case. This is the gate in front of it: a field
    // holding text that merely LOOKS like a placeholder is the reader's own
    // content and must survive an export untouched.
    expect(await exportField('{word-etymology}')).toEqual({});
  });
});

describe('addResultToAnki: audio that came from the page', () => {
  /**
   * `FileReader`, which node does not have.
   *
   * The store reads the trimmed clip through one to get its bytes; without a
   * stand-in the read rejects, the export lands in its catch, and the whole
   * describe would be asserting against an export that never happened.
   */
  class FakeFileReader {
    result: string | null = null;
    onloadend: (() => void) | null = null;
    readAsDataURL(blob: Blob) {
      void blob.text().then((text) => {
        this.result = `data:audio/wav;base64,${Buffer.from(text).toString('base64')}`;
        this.onloadend?.();
      });
    }
  }

  beforeEach(() => {
    vi.stubGlobal('FileReader', FakeFileReader);
  });

  /** A sentence whose audio the reader trimmed in the browser, as a blob. */
  const withBlobAudio = {
    ...sentence,
    blobAudioUrl: 'blob:https://nadeshiko.co/abc',
    blobAudio: new Blob(['fake-wav-bytes'], { type: 'audio/wav' }),
  };

  async function exportAudio(result: unknown) {
    const store = withProfile(
      makeProfile({ fields: [{ key: 'Audio', value: '{sentence-audio}' }], openBrowserOnExport: false } as never),
    );
    queueFetch(ankiOk([12]), ankiOk([{ noteId: 12, fields: {}, modelName: 'Lapis' }]), ankiOk('f.wav'), ankiOk(null));

    await store.addResultToAnki(asResult(result), {});
    return ankiCall('storeMediaFile');
  }

  test('is uploaded as DATA, since a blob url means nothing to AnkiConnect', async () => {
    // It is a handle into this page's memory; the add-on is another process and
    // fetching it would 404 for a file the reader can hear playing.
    const stored = await exportAudio(withBlobAudio);

    expect(stored?.params.data).toBeTruthy();
    expect(stored?.params.url).toBeUndefined();
  });

  test('is stored as a wav, matching what the trimmer produced', async () => {
    expect((await exportAudio(withBlobAudio))?.params.filename).toBe('seg-1.wav');
  });

  test('sends the bytes without the data-url header AnkiConnect would store literally', async () => {
    const stored = await exportAudio(withBlobAudio);

    expect(stored?.params.data).not.toContain('base64,');
    expect(stored?.params.data).not.toContain('data:');
  });

  test('but the CDN mp3 is fetched by AnkiConnect itself when there is no blob', async () => {
    // Nothing has to come through the page, and there is no CORS to satisfy.
    const stored = await exportAudio(sentence);

    expect(stored?.params.url).toBe('https://cdn.test/seg-1.mp3');
    expect(stored?.params.filename).toBe('seg-1.mp3');
  });
});

describe('addResultToAnki: the word’s own audio', () => {
  const minedWithAudio = {
    word: '食べる',
    reading: 'たべる',
    audioUrl: 'https://shirabe.test/taberu.mp3',
    audioFilename: 'taberu.mp3',
  } as never;

  async function exportWordAudio(word: unknown) {
    const store = withProfile(
      makeProfile({ fields: [{ key: 'WordAudio', value: '{word-audio}' }], openBrowserOnExport: false } as never),
    );
    queueFetch(ankiOk([12]), ankiOk([{ noteId: 12, fields: {}, modelName: 'Lapis' }]), ankiOk('f.mp3'), ankiOk(null));

    await store.addResultToAnki(asResult(sentence), { word: word as never });
    return ankiCalls().filter((call) => call.action === 'storeMediaFile');
  }

  test('is fetched by AnkiConnect from Shirabe’s CDN', async () => {
    const stored = await exportWordAudio(minedWithAudio);

    expect(stored[0]?.params).toMatchObject({ filename: 'taberu.mp3', url: 'https://shirabe.test/taberu.mp3' });
  });

  test('is skipped when the word has no clip, rather than storing an empty file', async () => {
    const stored = await exportWordAudio({ word: '食べる', reading: 'たべる' });

    expect(stored).toHaveLength(0);
  });

  test('is skipped when the clip has no filename to store it under', async () => {
    const stored = await exportWordAudio({ word: '食べる', audioUrl: 'https://shirabe.test/x.mp3' });

    expect(stored).toHaveLength(0);
  });
});

describe('migrating a reader off the old localStorage settings', () => {
  /** A localStorage double, since this runs before any of it is on the server. */
  function storage(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    const fake = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      get length() {
        return store.size;
      },
      key: (index: number) => [...store.keys()][index] ?? null,
    };
    vi.stubGlobal('localStorage', fake);
    return store;
  }

  const oldSettings = JSON.stringify({
    ankiPreferences: {
      serverAddress: 'http://127.0.0.1:8765',
      settings: {
        current: { deck: 'Mining', model: 'Lapis', fields: [{ key: 'Word', value: '{word}' }], key: 'Word' },
      },
    },
  });

  test('carries the old profile up to the account', async () => {
    // The settings lived in one browser; an account carries them to the next
    // one, which is the whole point of the move.
    const store = storage({ settings: oldSettings });

    await ankiStore().migrateFromLocalStorage();

    expect(sdk.updateUserPreferences).toHaveBeenCalled();
    const saved = sdk.updateUserPreferences.mock.calls.at(-1)![0] as { ankiProfiles: AnkiProfile[] };
    expect(saved.ankiProfiles[0]).toMatchObject({ deck: 'Mining', model: 'Lapis', name: 'Default' });
    expect(store.get('anki-migrated')).toBe('true');
  });

  test('makes it the active profile, or the reader has to pick it themselves', async () => {
    const store = storage({ settings: oldSettings });

    await ankiStore().migrateFromLocalStorage();

    expect(store.get('anki-active-profile')).toBeTruthy();
  });

  test('clears the old key once it is safely on the account', async () => {
    const store = storage({ settings: oldSettings });

    await ankiStore().migrateFromLocalStorage();

    expect(store.has('settings')).toBe(false);
  });

  test('runs ONCE, so it cannot overwrite what the reader has since configured', async () => {
    const store = storage({ settings: oldSettings, 'anki-migrated': 'true' });

    await ankiStore().migrateFromLocalStorage();

    expect(sdk.updateUserPreferences).not.toHaveBeenCalled();
    expect(store.get('settings')).toBe(oldSettings);
  });

  test('does not run for a reader who already has profiles on the account', async () => {
    // Theirs are the newer ones; the browser copy is what they migrated FROM.
    const store = storage({ settings: oldSettings });
    user.preferences.ankiProfiles = [makeProfile()];

    await ankiStore().migrateFromLocalStorage();

    expect(sdk.updateUserPreferences).not.toHaveBeenCalled();
    expect(store.get('anki-migrated')).toBe('true');
    expect(store.has('settings')).toBe(false);
  });

  test('a signed-out reader is left entirely alone', async () => {
    // There is no account to carry anything to, and clearing the key here would
    // destroy the settings of someone who simply had not signed in yet.
    const store = storage({ settings: oldSettings });
    user.isLoggedIn = false;

    await ankiStore().migrateFromLocalStorage();

    expect(store.get('settings')).toBe(oldSettings);
    expect(store.has('anki-migrated')).toBe(false);
  });

  test('a reader with nothing stored is marked done rather than checked forever', async () => {
    const store = storage({});

    await ankiStore().migrateFromLocalStorage();

    expect(store.get('anki-migrated')).toBe('true');
    expect(sdk.updateUserPreferences).not.toHaveBeenCalled();
  });

  test('settings holding no Anki preferences are marked done too', async () => {
    const store = storage({ settings: JSON.stringify({ theme: 'dark' }) });

    await ankiStore().migrateFromLocalStorage();

    expect(store.get('anki-migrated')).toBe('true');
    expect(sdk.updateUserPreferences).not.toHaveBeenCalled();
  });

  test('unreadable settings are reported, not thrown at the reader', async () => {
    // This runs on a page load; a throw here takes the page with it.
    storage({ settings: '{not json' });

    await expect(ankiStore().migrateFromLocalStorage()).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalledWith('anki:localstorage-migration-failed', expect.anything());
  });

  test('and unreadable settings are NOT marked done, so a fix can still migrate them', async () => {
    const store = storage({ settings: '{not json' });

    await ankiStore().migrateFromLocalStorage();

    expect(store.has('anki-migrated')).toBe(false);
    expect(store.get('settings')).toBe('{not json');
  });

  test('an old profile missing most of its settings still migrates', async () => {
    // Half-configured is the ordinary state of the thing being migrated.
    const store = storage({ settings: JSON.stringify({ ankiPreferences: { settings: {} } }) });

    await ankiStore().migrateFromLocalStorage();

    const saved = sdk.updateUserPreferences.mock.calls.at(-1)![0] as { ankiProfiles: AnkiProfile[] };
    expect(saved.ankiProfiles[0]).toMatchObject({ name: 'Default', fields: [] });
    expect(store.get('anki-migrated')).toBe('true');
  });
});

describe('opening the browser on a card', () => {
  test('asks Anki to search for it, and hands back what it found', async () => {
    queueFetch(ankiOk([12, 13]));

    expect(await ankiStore().guiBrowse('nid:12')).toEqual([12, 13]);
    expect(ankiCall('guiBrowse')?.params).toEqual({ query: 'nid:12' });
  });

  test('a reply with nothing in it is an empty list, not a crash', async () => {
    queueFetch(ankiOk(null));

    expect(await ankiStore().guiBrowse('nid:12')).toEqual([]);
  });
});
