// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';

/**
 * A shared collection's page.
 *
 * Three ways a collection can fail to load, and they must not be run together:
 * a REFUSAL (the collection is private, or not this reader's) redirects home; a
 * MISSING one 404s; and a fetch that simply fell over is a 500. Returning null
 * on any of them would render the collection as an empty page at HTTP 200 --
 * which crawlers index and readers read as "the site is broken".
 *
 * The refusal is the one worth being careful about: a redirect from setup is not
 * a throw, so the render carries on after it, and every guard below has to know
 * that a page on its way out is not a page that failed.
 */
const reportError = vi.fn();
vi.mock('~/utils/reportError', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

const searchCollectionSegments = vi.fn();
const getCollectionStats = vi.fn();
const getCollection = vi.fn();
const navigateTo = vi.fn();
const createError = vi.fn((v: Record<string, unknown>) => Object.assign(new Error('x'), v));
const route = reactive({ params: { id: 'c1' }, path: '/collection/c1', query: {}, fullPath: '/collection/c1' });

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useRequestURL', () => new URL('https://nadeshiko.test/collection/c1'));
vi.stubGlobal('useHead', vi.fn());
vi.stubGlobal('useSchemaOrg', vi.fn());
vi.stubGlobal('defineWebPage', (v: Record<string, unknown>) => v);
vi.stubGlobal('defineBreadcrumb', (v: Record<string, unknown>) => v);
vi.stubGlobal('usePostHog', () => ({ capture: vi.fn() }));
vi.stubGlobal('navigateTo', navigateTo);
vi.stubGlobal('createError', createError);
vi.stubGlobal('useNadeshikoSdk', () => ({ searchCollectionSegments, getCollectionStats, getCollection }));
vi.stubGlobal('useAsyncData', async (_k: unknown, handler: () => Promise<unknown>) => {
  const data = ref<unknown>(null);
  const error = ref<unknown>(null);
  try {
    data.value = await handler();
  } catch (e) {
    error.value = e;
  }
  return { data, error, refresh: vi.fn(), pending: ref(false) };
});

import CollectionPage from './[id].vue';

const ok = (body: unknown) => ({ data: body });
const fail = (status: number) => ({ error: new Error('x'), response: { status } });

const payload = () => ({
  segments: [],
  includes: { media: {} },
  pagination: { hasMore: false, cursor: '', estimatedTotalHits: 0, estimatedTotalHitsRelation: 'EXACT' },
});

const mounted: { unmount: () => void }[] = [];

async function render() {
  const Host = defineComponent({
    components: { CollectionPage },
    errorCaptured: () => false,
    template: '<Suspense><CollectionPage /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: { SearchContainer: true, NuxtLink: { props: ['to'], template: '<a><slot /></a>' }, UiBaseIcon: true },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  searchCollectionSegments.mockResolvedValue(ok(payload()));
  getCollectionStats.mockResolvedValue(ok({ media: [], categories: [] }));
  getCollection.mockResolvedValue(ok({ name: 'My clips', publicId: 'c1' }));
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('a collection the reader may read', () => {
  test('loads without redirecting or erroring', async () => {
    await render();

    expect(navigateTo).not.toHaveBeenCalled();
    expect(createError).not.toHaveBeenCalled();
  });
});

describe('a collection the reader may NOT read', () => {
  test.each([
    ['forbidden', 403],
    ['unauthenticated', 401],
  ])('%s sends them home rather than showing an empty page', async (_name, status) => {
    searchCollectionSegments.mockResolvedValue(fail(status));

    await render();

    expect(navigateTo).toHaveBeenCalledWith('/en/', expect.objectContaining({ redirectCode: 302, replace: true }));
  });

  test('and is NOT also reported as a server error', async () => {
    // The redirect is not a throw, so the render carries on past it -- every
    // guard below has to know that a page on its way out has not failed.
    searchCollectionSegments.mockResolvedValue(fail(403));

    await render();

    expect(createError).not.toHaveBeenCalled();
  });
});

describe('a collection that is not there', () => {
  test('404s rather than rendering an empty page at 200', async () => {
    searchCollectionSegments.mockResolvedValue(fail(404));

    await render();

    expect(createError).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  test('and does not send the reader home', async () => {
    // A missing collection and a refused one need different answers: one is a
    // wrong address, the other is a permission the reader may be able to get.
    searchCollectionSegments.mockResolvedValue(fail(404));

    await render();

    expect(navigateTo).not.toHaveBeenCalled();
  });
});

describe('a fetch that simply fell over', () => {
  test('is a 500, not a 404', async () => {
    // Dressing our own failure up as "this collection does not exist" tells the
    // reader their link is dead when it is not.
    searchCollectionSegments.mockRejectedValue(new Error('down'));

    await render();

    expect(createError).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
  });

  test('and is reported, because SSR has nowhere to put a toast', async () => {
    searchCollectionSegments.mockRejectedValue(new Error('down'));

    await render();

    expect(reportError).toHaveBeenCalledWith(
      'collection:sentences-fetch-failed',
      expect.anything(),
      expect.objectContaining({ 'collection.publicId': 'c1' }),
    );
  });
});
