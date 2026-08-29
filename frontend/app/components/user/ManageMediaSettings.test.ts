// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, ref } from 'vue';

/**
 * The settings card for starring and hiding titles.
 *
 * One list does two jobs: with an empty box it shows what the reader has already
 * marked, and with something typed it becomes a lookup over the catalogue. The
 * two are the same rows with different sources, so the thing that has to hold is
 * that a toggle acts on the row it was pressed on in EITHER mode.
 *
 * The toasts and the analytics both report which direction the switch moved, and
 * that has to be read BEFORE the write -- afterwards the state has already
 * changed and every message says the opposite of what happened.
 */
const toastSuccess = vi.fn();
vi.mock('~/utils/toast', () => ({ useToastSuccess: (...a: unknown[]) => toastSuccess(...a), useToastError: vi.fn() }));

const toggleFavorite = vi.fn();
const toggleHideMedia = vi.fn();
const capture = vi.fn();
const favoriteIds = ref<string[]>([]);
const favoriteItems = ref<Record<string, unknown>[]>([]);
const hiddenIds = ref<string[]>([]);
const searchQuery = ref('');
const searchResults = ref<Record<string, unknown>[]>([]);
const searchFailed = ref(false);
const atCap = ref(false);

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useFormat', () => ({ formatNumber: (n: number) => String(n) }));
vi.stubGlobal('usePostHog', () => ({ capture }));
vi.stubGlobal('useToastSuccess', toastSuccess);
const listFavoriteMedia = vi.fn();
const listExcludedMedia = vi.fn();
// Both are needed: the card resolves the NAMES for the ids it has stored, and a
// stub missing either sends that straight to the failure path -- where the rows
// render from bare ids and the test never exercises the resolution at all.
vi.stubGlobal('useNadeshikoSdk', () => ({ listFavoriteMedia, listExcludedMedia }));
vi.stubGlobal('useMediaDisplayName', () => ({
  displayMediaName: (m: Record<string, string>) => m?.nameEn ?? '',
  secondaryMediaNames: () => '',
}));
vi.stubGlobal('useMediaSearch', () => ({
  query: searchQuery,
  results: searchResults,
  loading: ref(false),
  failed: searchFailed,
}));
vi.stubGlobal('useFavoriteMedia', () => ({
  // The managed list is built from `items` (which carry `favoritedAt` for the
  // newest-first order), not from the id set.
  items: favoriteItems,
  favoriteMediaIds: ref(new Set(favoriteIds.value)),
  isFavorite: (id: string) => favoriteIds.value.includes(id),
  atCap,
  toggleFavorite,
}));
vi.stubGlobal('useHiddenMedia', () => ({
  hiddenMediaIds: hiddenIds,
  hiddenMediaExcludeFilter: ref([]),
  isMediaHidden: (id: string) => hiddenIds.value.includes(id),
  toggleHideMedia,
}));

import ManageMediaSettings from './ManageMediaSettings.vue';

const title = (id: string, name = id) => ({ publicId: id, nameEn: name, nameJa: '', nameRomaji: '' });

const mounted: { unmount: () => void }[] = [];

async function render() {
  const wrapper = mount(ManageMediaSettings, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: { NuxtLink: { props: ['to'], template: '<a><slot /></a>' }, UiBaseIcon: true, NuxtImg: true },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const rows = (w: ReturnType<typeof mount>) => w.findAll('[data-testid="media-lookup-result"]');
async function search(w: ReturnType<typeof mount>, term: string, results: Record<string, unknown>[]) {
  searchResults.value = results;
  await w.get('[data-testid="media-lookup-search-input"]').setValue(term);
  await nextTick();
}

beforeEach(() => {
  vi.clearAllMocks();
  favoriteIds.value = [];
  favoriteItems.value = [];
  hiddenIds.value = [];
  searchQuery.value = '';
  searchResults.value = [];
  searchFailed.value = false;
  atCap.value = false;
  toggleFavorite.mockResolvedValue(true);
  toggleHideMedia.mockResolvedValue(true);
  listFavoriteMedia.mockResolvedValue({ favoriteMedia: [] });
  listExcludedMedia.mockResolvedValue({ excludedMedia: [] });
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the names behind stored ids', () => {
  test('are resolved so the rows read as titles rather than ids', async () => {
    // Preferences store only ids; without this the card lists hashes at a
    // reader who starred a show by name.
    listFavoriteMedia.mockResolvedValue({ favoriteMedia: [title('m1', 'Bocchi')] });
    favoriteIds.value = ['m1'];
    favoriteItems.value = [{ mediaPublicId: 'm1', favoritedAt: '2026-01-01' }];
    const wrapper = await render();

    expect(wrapper.text()).toContain('Bocchi');
  });

  test('the explanation is hidden while searching, where the names come from the API', async () => {
    // Lookup results carry their own names, so the notice would be explaining a
    // problem the reader cannot see on the rows in front of them.
    listFavoriteMedia.mockRejectedValue(new Error('down'));
    favoriteIds.value = ['m1'];
    favoriteItems.value = [{ mediaPublicId: 'm1', favoritedAt: '2026-01-01' }];
    const wrapper = await render();
    expect(wrapper.find('[data-testid="managed-media-names-error"]').exists()).toBe(true);

    await search(wrapper, 'bocchi', [title('m2', 'Frieren')]);

    expect(wrapper.find('[data-testid="managed-media-names-error"]').exists()).toBe(false);
  });

  test('a failed resolution explains the ids rather than replacing the table', async () => {
    // The rows still work -- both controls act on the id -- so an error page
    // here would take away something the reader can still use.
    listFavoriteMedia.mockRejectedValue(new Error('down'));
    favoriteIds.value = ['m1'];
    favoriteItems.value = [{ mediaPublicId: 'm1', favoritedAt: '2026-01-01' }];
    const wrapper = await render();

    expect(wrapper.find('[data-testid="managed-media-names-error"]').exists()).toBe(true);
  });
});

describe('looking a title up', () => {
  test('shows what the catalogue came back with', async () => {
    const wrapper = await render();

    await search(wrapper, 'bocchi', [title('m1', 'Bocchi'), title('m2', 'Frieren')]);

    expect(rows(wrapper)).toHaveLength(2);
  });

  test('says so when the lookup failed rather than showing nothing', async () => {
    // An empty list is what "no such title" looks like too.
    const wrapper = await render();
    searchFailed.value = true;
    await search(wrapper, 'bocchi', []);

    expect(wrapper.find('[data-testid="media-lookup-search-error"]').exists()).toBe(true);
  });
});

describe('starring a title', () => {
  test('sends the title that was pressed, names and all', async () => {
    // The names travel with the id: the starred list has to render without a
    // second lookup, including for a reader who is offline next time.
    const wrapper = await render();
    await search(wrapper, 'bocchi', [title('m1', 'Bocchi')]);

    await wrapper.get('[data-testid="media-lookup-favorite"]').trigger('click');
    await flushPromises();

    expect(toggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ publicId: 'm1', nameEn: 'Bocchi' }));
  });

  test('says it was starred', async () => {
    const wrapper = await render();
    await search(wrapper, 'bocchi', [title('m1', 'Bocchi')]);

    await wrapper.get('[data-testid="media-lookup-favorite"]').trigger('click');
    await flushPromises();

    expect(toastSuccess).toHaveBeenCalledWith('accountSettings.account.mediaFavoritedToast');
  });

  test('and says it was UNstarred when it already was', async () => {
    // Read before the write: afterwards the state has already moved and the
    // message says the opposite of what happened.
    favoriteIds.value = ['m1'];
    const wrapper = await render();
    await search(wrapper, 'bocchi', [title('m1', 'Bocchi')]);

    await wrapper.get('[data-testid="media-lookup-favorite"]').trigger('click');
    await flushPromises();

    expect(toastSuccess).toHaveBeenCalledWith('accountSettings.account.mediaUnfavoritedToast');
  });

  test('a refused write says nothing at all', async () => {
    // The cap is enforced in the composable; announcing a star that did not
    // happen is worse than staying quiet.
    toggleFavorite.mockResolvedValue(false);
    const wrapper = await render();
    await search(wrapper, 'bocchi', [title('m1', 'Bocchi')]);

    await wrapper.get('[data-testid="media-lookup-favorite"]').trigger('click');
    await flushPromises();

    expect(toastSuccess).not.toHaveBeenCalled();
  });

  test('warns when the reader is at the cap', async () => {
    atCap.value = true;
    const wrapper = await render();

    expect(wrapper.find('[data-testid="favorite-media-cap-notice"]').exists()).toBe(true);
  });
});

describe('hiding a title', () => {
  test('sends the title that was pressed', async () => {
    const wrapper = await render();
    await search(wrapper, 'bocchi', [title('m1', 'Bocchi')]);

    await wrapper.get('[data-testid="media-lookup-hide"]').trigger('click');
    await flushPromises();

    expect(toggleHideMedia).toHaveBeenCalledWith(expect.objectContaining({ publicId: 'm1' }));
  });

  test('reports which way it moved to analytics', async () => {
    const wrapper = await render();
    await search(wrapper, 'bocchi', [title('m1', 'Bocchi')]);

    await wrapper.get('[data-testid="media-lookup-hide"]').trigger('click');
    await flushPromises();

    expect(capture).toHaveBeenCalledWith('media_visibility_changed', expect.objectContaining({ action: 'hidden' }));
  });

  test('and the other way for a title already hidden', async () => {
    hiddenIds.value = ['m1'];
    const wrapper = await render();
    await search(wrapper, 'bocchi', [title('m1', 'Bocchi')]);

    await wrapper.get('[data-testid="media-lookup-hide"]').trigger('click');
    await flushPromises();

    expect(capture).toHaveBeenCalledWith('media_visibility_changed', expect.objectContaining({ action: 'unhidden' }));
  });

  test('a refused write is not announced or counted', async () => {
    toggleHideMedia.mockResolvedValue(false);
    const wrapper = await render();
    await search(wrapper, 'bocchi', [title('m1', 'Bocchi')]);

    await wrapper.get('[data-testid="media-lookup-hide"]').trigger('click');
    await flushPromises();

    expect(capture).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
