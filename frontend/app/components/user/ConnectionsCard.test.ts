// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, ref } from 'vue';

/**
 * The Shirabe link on the settings page.
 *
 * The card is mostly one four-way state machine, and the two middle states are
 * opposites that look alike: `upgrade` is a link that WORKS and wants a new
 * permission, `disconnected` is a key Shirabe has refused. Offering "update
 * permissions" for a key that no longer exists sends the reader somewhere that
 * cannot help them, so the precedence between them is the thing worth pinning.
 *
 * The dictionary rows matter for a different reason: a reader's own uploads are
 * filed under a HASH of their contents, so getting the name lookup wrong prints
 * `yomitan-c89af12122021a8a` at the person who uploaded 三省堂国語辞典.
 */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

const $fetch = vi.fn();
const locale = ref('en');
vi.stubGlobal('$fetch', $fetch);
vi.stubGlobal('useI18n', () => ({
  t: (key: string, params?: Record<string, unknown>) => (params ? `${key}(${params.name})` : key),
  locale,
}));
vi.stubGlobal('useRuntimeConfig', () => ({ public: { shirabeSite: 'https://shirabe.test' } }));

import ConnectionsCard from './ConnectionsCard.vue';

type Connection = Record<string, unknown>;

/** A live link, overridable per test. */
function connection(over: Connection = {}): Connection {
  return {
    needsUpgrade: false,
    missingScopes: [],
    disconnected: false,
    linkedAt: '2026-01-01',
    shirabeName: 'Lumi',
    scopes: ['read'],
    dictionaries: [],
    dictionaryNames: {},
    stackIsPrivate: false,
    syncedAt: null,
    ...over,
  };
}

const mounted: { unmount: () => void }[] = [];

async function render(conn: Connection | null) {
  $fetch.mockResolvedValueOnce({ connection: conn });
  const wrapper = mount(ConnectionsCard, { global: { mocks: { $t: (k: string) => k } } });
  mounted.push(wrapper);
  for (let i = 0; i < 5; i++) await nextTick();
  return wrapper;
}

const toggle = (w: ReturnType<typeof mount>) => w.get('[data-testid="shirabe-connection-toggle"]');
const stackRows = (w: ReturnType<typeof mount>) => w.findAll('[data-testid="shirabe-stack"] li');

beforeEach(() => {
  vi.clearAllMocks();
  locale.value = 'en';
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('which of the four states the card is in', () => {
  test('no connection at all offers to connect', async () => {
    const wrapper = await render(null);

    expect(toggle(wrapper).text()).toBe('connections.shirabe.connect');
    expect(wrapper.text()).toContain('connections.shirabe.description');
  });

  test('a working link names who it is linked as, and offers to disconnect', async () => {
    const wrapper = await render(connection());

    expect(toggle(wrapper).text()).toBe('connections.shirabe.disconnect');
    expect(wrapper.text()).toContain('connections.shirabe.linkedAs(Lumi)');
  });

  test('a link wanting a new permission asks for an upgrade, NOT a repair', async () => {
    // It still works; "approve more permissions" reading as breakage is a thing
    // readers decline.
    const wrapper = await render(connection({ needsUpgrade: true }));

    expect(toggle(wrapper).text()).toBe('connections.shirabe.upgrade');
    expect(wrapper.text()).toContain('connections.shirabe.upgradeNeeded(Lumi)');
  });

  test('a refused key asks to reconnect', async () => {
    const wrapper = await render(connection({ disconnected: true }));

    expect(toggle(wrapper).text()).toBe('connections.shirabe.reconnect');
    expect(wrapper.text()).toContain('connections.shirabe.disconnected(Lumi)');
  });

  test('a DEAD link that also wants a scope is dead, not an upgrade', async () => {
    // The precedence, which is the whole reason `disconnected` is checked first:
    // offering to update the permissions on a key Shirabe has already refused
    // sends the reader somewhere that cannot help them.
    const wrapper = await render(connection({ disconnected: true, needsUpgrade: true }));

    expect(toggle(wrapper).text()).toBe('connections.shirabe.reconnect');
  });

  test('a link with no name over there is still recognisable', async () => {
    const wrapper = await render(connection({ shirabeName: null }));

    expect(wrapper.text()).toContain('connections.shirabe.anonymous');
  });
});

describe('the dictionary stack', () => {
  test('is listed in the reader’s own order, numbered from one', async () => {
    const wrapper = await render(
      connection({ dictionaries: ['jmdict:en', 'daijirin:ja'], dictionaryNames: { jmdict: 'JMdict' } }),
    );

    expect(stackRows(wrapper).map((r) => r.text())).toEqual(['1JMdictEN', '2daijirinJA']);
  });

  test('prefers the name Shirabe published over the slug', async () => {
    // A reader's own upload is filed under a hash of its contents, so the slug
    // is meaningless to them and no map on this side could ever fix it.
    const wrapper = await render(
      connection({
        dictionaries: ['yomitan-c89af12122021a8a:ja'],
        dictionaryNames: { 'yomitan-c89af12122021a8a': '三省堂国語辞典' },
      }),
    );

    expect(stackRows(wrapper)[0]!.text()).toContain('三省堂国語辞典');
  });

  test('falls back to the slug for a link made before the names existed', async () => {
    const wrapper = await render(connection({ dictionaries: ['jmdict:en'], dictionaryNames: undefined }));

    expect(stackRows(wrapper)[0]!.text()).toContain('jmdict');
  });

  test('splits on the LAST colon, so a slug containing one survives', async () => {
    // The same dictionary sits in the stack twice when it is read in two
    // languages, so both halves have to come out right.
    const wrapper = await render(connection({ dictionaries: ['weird:slug:en'] }));

    expect(stackRows(wrapper)[0]!.text()).toBe('1weird:slugEN');
  });

  test('an entry with no language at all still renders', async () => {
    const wrapper = await render(connection({ dictionaries: ['jmdict'] }));

    expect(stackRows(wrapper)[0]!.text()).toBe('1jmdict');
  });

  test('is hidden for a dead link, whose dictionaries are NOT being used', async () => {
    const wrapper = await render(connection({ disconnected: true, dictionaries: ['jmdict:en'] }));

    expect(stackRows(wrapper)).toHaveLength(0);
  });
});

describe('linking', () => {
  test('a full navigation to Shirabe, so the reader can see the address bar', async () => {
    // Not a popup and not an iframe: the one defence against being asked to
    // approve something by a page pretending to be Shirabe.
    const wrapper = await render(null);
    $fetch.mockResolvedValueOnce({ authorizeUrl: 'https://shirabe.test/oauth' });

    await toggle(wrapper).trigger('click');
    await nextTick();

    expect($fetch).toHaveBeenLastCalledWith('/v1/user/connections/shirabe', { method: 'POST' });
  });

  test('a failure to start is reported and the button comes back', async () => {
    const wrapper = await render(null);
    $fetch.mockRejectedValueOnce(new Error('down'));

    await toggle(wrapper).trigger('click');
    await nextTick();

    expect(handleApiError).toHaveBeenCalledWith('shirabeConnection.start', expect.anything());
    expect(toggle(wrapper).attributes('disabled')).toBeUndefined();
  });
});

describe('unlinking', () => {
  test('asks first, because reconnecting is a fresh approval rather than an undo', async () => {
    const wrapper = await render(connection());
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );

    await toggle(wrapper).trigger('click');
    await nextTick();

    expect($fetch).toHaveBeenCalledTimes(1); // the initial load, and nothing else
  });

  test('revokes the key and returns the card to unlinked', async () => {
    const wrapper = await render(connection());
    $fetch.mockResolvedValueOnce({});

    await toggle(wrapper).trigger('click');
    await nextTick();
    await nextTick();

    expect($fetch).toHaveBeenLastCalledWith('/v1/user/connections/shirabe', { method: 'DELETE' });
    expect(toggle(wrapper).text()).toBe('connections.shirabe.connect');
  });

  test('a failed unlink leaves the link on screen rather than pretending it went', async () => {
    const wrapper = await render(connection());
    $fetch.mockRejectedValueOnce(new Error('down'));

    await toggle(wrapper).trigger('click');
    await nextTick();
    await nextTick();

    expect(handleApiError).toHaveBeenCalledWith('shirabeConnection.unlink', expect.anything());
    expect(toggle(wrapper).text()).toBe('connections.shirabe.disconnect');
  });
});

describe('where the card sends the reader to change any of this', () => {
  test('to Shirabe’s own settings, in their language', async () => {
    locale.value = 'es';
    const wrapper = await render(connection({ dictionaries: ['jmdict:en'] }));

    expect(wrapper.find('a[href*="settings"]').attributes('href')).toBe('https://shirabe.test/es/settings');
  });

  test('and in English for every other locale', async () => {
    locale.value = 'ja';
    const wrapper = await render(connection({ dictionaries: ['jmdict:en'] }));

    expect(wrapper.find('a[href*="settings"]').attributes('href')).toBe('https://shirabe.test/en/settings');
  });
});

describe('loading', () => {
  test('a failure to read the link is reported rather than shown as unlinked in silence', async () => {
    $fetch.mockRejectedValueOnce(new Error('down'));
    const wrapper = mount(ConnectionsCard, { global: { mocks: { $t: (k: string) => k } } });
    mounted.push(wrapper);
    for (let i = 0; i < 5; i++) await nextTick();

    expect(handleApiError).toHaveBeenCalledWith('shirabeConnection.load', expect.anything());
  });
});
