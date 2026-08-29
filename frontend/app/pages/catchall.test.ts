// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, reactive, ref, unref } from 'vue';

/**
 * The catch-all content page: everything from `/about` to `/blog/<post>` to the
 * changelog, all rendered from markdown.
 *
 * The English copy is served VERBATIM when the active locale has no translation,
 * so the one thing this page must get right is declaring the language the body
 * is actually in. Left as the reader's locale, a Spanish reader is handed
 * English prose labelled `lang="es"` -- which screen readers pronounce with
 * Spanish phonetics and search engines index as Spanish.
 *
 * The other half is that a BLOG POST is an Article and the other pages are not.
 * A changelog or an about page declaring `datePublished` and a headline is
 * claiming to be something it is not.
 */
const capturedSchema: unknown[] = [];
const route = reactive({ path: '/en/blog/hello', params: {}, query: {}, fullPath: '/en/blog/hello' });
const locale = ref('en');
const content = ref<Record<string, unknown> | null>(null);

// `d` is vue-i18n's DATE formatter, used by this page's template; without it the
// render throws and any assertion about the body passes on an empty tree.
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, d: (v: unknown) => String(v), locale }));
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useRequestURL', () => new URL('https://nadeshiko.test/en/blog/hello'));
vi.stubGlobal('useSiteConfig', () => ({ url: 'https://nadeshiko.test' }));
vi.stubGlobal('useHead', vi.fn());
vi.stubGlobal('useSchemaOrg', (v: unknown) => capturedSchema.push(v));
vi.stubGlobal('defineWebPage', (v: Record<string, unknown>) => ({ '@type': 'WebPage', ...v }));
vi.stubGlobal('defineBreadcrumb', (v: Record<string, unknown>) => ({ '@type': 'BreadcrumbList', ...v }));
vi.stubGlobal('defineArticle', (v: Record<string, unknown>) => ({ '@type': 'Article', ...v }));
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
// The page fetches its markdown from an internal route, not from a content
// collection helper.
const $fetch = vi.fn();
vi.stubGlobal('$fetch', $fetch);
const createError = vi.fn((v: Record<string, unknown>) => Object.assign(new Error('x'), v));
vi.stubGlobal('createError', createError);

import { splitLocalePrefix } from '~/utils/routes';
vi.stubGlobal('splitLocalePrefix', splitLocalePrefix);

import CatchAllPage from './[...slug].vue';

const mounted: { unmount: () => void }[] = [];

async function render(doc: Record<string, unknown> | null, path = '/en/blog/hello') {
  capturedSchema.length = 0;
  content.value = doc;
  if (doc === null) $fetch.mockRejectedValue({ statusCode: 404 });
  else $fetch.mockResolvedValue(doc);
  route.path = path;
  route.fullPath = path;

  const Host = defineComponent({
    components: { CatchAllPage },
    template: '<Suspense><CatchAllPage /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        ContentRenderer: true,
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
        UiBaseIcon: true,
        CommonBaseModal: true,
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const nodes = (): Record<string, unknown>[] =>
  capturedSchema.flatMap((entry) => (unref(entry) as Record<string, unknown>[]) ?? []);
const page = () => nodes().find((n) => n['@type'] === 'WebPage');
const article = () => nodes().find((n) => n['@type'] === 'Article');
const crumbs = () =>
  (nodes().find((n) => n['@type'] === 'BreadcrumbList')?.itemListElement as { name: string }[]) ?? [];

const doc = (over: Record<string, unknown> = {}) => ({
  title: 'Hello',
  description: 'A post',
  date: '2026-01-01T00:00:00Z',
  author: 'David',
  body: {},
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  locale.value = 'en';
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the language the body is actually in', () => {
  test('is the reader’s locale for a translated page', async () => {
    locale.value = 'es';
    await render(doc({ isFallback: false }), '/es/blog/hello');

    expect(page()!.inLanguage).toBe('es');
  });

  test('but ENGLISH when the English copy was served as a fallback', async () => {
    // A Spanish reader handed English prose labelled `lang="es"` gets Spanish
    // phonetics from a screen reader and Spanish indexing from a crawler.
    locale.value = 'es';
    await render(doc({ isFallback: true }), '/es/blog/hello');

    expect(page()!.inLanguage).toBe('en');
  });

  test('a page with no fallback flag is treated as translated', async () => {
    locale.value = 'es';
    await render(doc(), '/es/about');

    expect(page()!.inLanguage).toBe('es');
  });
});

describe('what kind of thing the page claims to be', () => {
  test('a blog post is an Article', async () => {
    await render(doc(), '/en/blog/hello');

    expect(article()).toBeTruthy();
    expect(article()!.headline).toBe('Hello');
  });

  test('an ordinary page is NOT', async () => {
    // An about page declaring a headline and a publication date is claiming to
    // be something it is not.
    await render(doc(), '/en/about');

    expect(article()).toBeUndefined();
  });

  test('the changelog is not either', async () => {
    await render(doc(), '/en/changelog');

    expect(article()).toBeUndefined();
  });

  test('a blog post with no title claims no Article', async () => {
    await render(doc({ title: '' }), '/en/blog/hello');

    expect(article()).toBeUndefined();
  });

  test('carries the publication date when the post has one', async () => {
    await render(doc({ date: '2026-01-01T00:00:00Z' }), '/en/blog/hello');

    expect(article()!.datePublished).toBe('2026-01-01T00:00:00Z');
  });

  test('and leaves it out rather than inventing one', async () => {
    await render(doc({ date: undefined }), '/en/blog/hello');

    expect(article()).not.toHaveProperty('datePublished');
  });

  test('reads a date out of the frontmatter meta as well as the top level', async () => {
    await render(doc({ date: undefined, meta: { date: '2025-06-01T00:00:00Z' } }), '/en/blog/hello');

    expect(article()!.datePublished).toBe('2025-06-01T00:00:00Z');
  });
});

describe('the breadcrumb', () => {
  test('a blog post sits under the blog index', async () => {
    await render(doc(), '/en/blog/hello');

    expect(crumbs().map((c) => c.name)).toEqual(['navbar.buttons.home', 'blog.title', 'Hello']);
  });

  test('an ordinary page sits straight under home', async () => {
    await render(doc({ title: 'About' }), '/en/about');

    expect(crumbs().map((c) => c.name)).toEqual(['navbar.buttons.home', 'About']);
  });
});
