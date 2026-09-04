// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';

/**
 * The blog index, whose whole risk is its PAGE NUMBER.
 *
 * `?page=99`, `?page=0`, `?page=-1` and `?page=abc` all used to render 200 with
 * "No blog posts available yet" -- untrue, and indexable, from any `?page=` a
 * link or a bot happened to invent. So there are two different answers here and
 * they must not be run together: anything that is not a positive integer is
 * page 1, and a page PAST THE END is a wrong URL and 404s.
 *
 * Page 1 stays 200 even with nothing published, because then "no posts yet" is
 * the true answer -- which is also why a FAILED fetch has to say something else
 * entirely.
 */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

const $fetch = vi.fn();
const createError = vi.fn((v: Record<string, unknown>) => Object.assign(new Error('x'), v));
const capturedHead: Record<string, unknown>[] = [];
const route = reactive({ query: {} as Record<string, unknown>, path: '/blog', params: {}, fullPath: '/blog' });

vi.stubGlobal('$fetch', $fetch);
vi.stubGlobal('createError', createError);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useRequestURL', () => new URL('https://nadeshiko.test/blog'));
vi.stubGlobal('useSeoMeta', vi.fn());
vi.stubGlobal('useSchemaOrg', vi.fn());
vi.stubGlobal('defineWebPage', (v: Record<string, unknown>) => v);
vi.stubGlobal('useHead', (v: Record<string, unknown>) => capturedHead.push(v));
vi.stubGlobal('useAsyncData', async (_k: unknown, handler: () => Promise<unknown>) => {
  const data = ref<unknown>(null);
  data.value = await handler();
  return { data, refresh: vi.fn(), pending: ref(false), error: ref(null) };
});

import BlogIndex from './index.vue';

const post = (n: number) => ({ path: `/blog/post-${n}`, title: `Post ${n}`, description: '', date: '2026-01-01' });

const mounted: { unmount: () => void }[] = [];

async function render(posts: ReturnType<typeof post>[] | null, page?: string) {
  capturedHead.length = 0;
  route.query = page === undefined ? {} : { page };
  if (posts === null) $fetch.mockRejectedValue(new Error('down'));
  else $fetch.mockResolvedValue({ posts, isFallback: false });

  const Host = defineComponent({
    components: { BlogIndex },
    errorCaptured: () => false,
    template: '<Suspense><BlogIndex /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        BlogCard: { props: ['post'], template: '<div class="card">{{ post.title }}</div>' },
        // `currentPage`, not `page`: a stub declaring the wrong prop name renders
        // an empty half, and every pager assertion then compares against nothing.
        BlogPagination: {
          props: ['currentPage', 'totalPages', 'basePath'],
          template: '<div data-testid="pager">{{ currentPage }}/{{ totalPages }}</div>',
        },
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
        UiBaseIcon: true,
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const cards = (w: ReturnType<typeof mount>) => w.findAll('.card').map((n) => n.text());
const pager = (w: ReturnType<typeof mount>) => w.find('[data-testid="pager"]').text();
const many = (n: number) => Array.from({ length: n }, (_, i) => post(i + 1));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('which page is shown', () => {
  test('no page parameter is page one', async () => {
    const wrapper = await render(many(12));

    expect(cards(wrapper)).toHaveLength(9);
    expect(cards(wrapper)[0]).toBe('Post 1');
  });

  test('page two is the next nine', async () => {
    const wrapper = await render(many(12), '2');

    expect(cards(wrapper)).toEqual(['Post 10', 'Post 11', 'Post 12']);
  });

  test.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['not a number', 'abc'],
    ['a fraction', '1.5'],
  ])('%s falls back to page one rather than rendering nothing', async (_name, value) => {
    // Each of these used to render 200 with "no posts yet", which is untrue and
    // indexable.
    const wrapper = await render(many(12), value);

    expect(cards(wrapper)).toHaveLength(9);
    expect(createError).not.toHaveBeenCalled();
  });

  test('a page PAST the end is a wrong URL, and 404s', async () => {
    // Not an empty blog: rendering it as 200 told crawlers the blog had no
    // posts, from any `?page=` a bot invented.
    await render(many(12), '99');

    expect(createError).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  test('the LAST page is not past the end', async () => {
    // Off by one here 404s a page that exists.
    await render(many(12), '2');

    expect(createError).not.toHaveBeenCalled();
  });
});

describe('the pager', () => {
  test('reports the page and the total, so the reader knows where they are', async () => {
    const wrapper = await render(many(20), '2');

    expect(pager(wrapper)).toBe('2/3');
  });

  test('counts a partial last page as a page', async () => {
    // 10 posts over 9 per page is two pages, not one.
    const wrapper = await render(many(10));

    expect(pager(wrapper)).toBe('1/2');
  });

  test('an exactly-full single page shows no pager at all', async () => {
    // Nine posts at nine per page is one page, and a "1 of 1" control is a
    // navigation offering nowhere to go.
    const wrapper = await render(many(9));

    expect(wrapper.find('[data-testid="pager"]').exists()).toBe(false);
  });
});

describe('a blog with nothing published', () => {
  test('page one is a 200 saying so, because that is the true answer', async () => {
    await render([]);

    expect(createError).not.toHaveBeenCalled();
  });

  test('and is not mistaken for a failure', async () => {
    const wrapper = await render([]);

    expect(wrapper.find('[data-testid="blog-load-error"]').exists()).toBe(false);
  });
});

describe('a fetch that failed', () => {
  test('says so rather than "no posts yet"', async () => {
    const wrapper = await render(null);

    expect(wrapper.find('[data-testid="blog-load-error"]').exists()).toBe(true);
    expect(handleApiError).toHaveBeenCalledWith(
      'blog:posts-fetch-failed',
      expect.anything(),
      expect.objectContaining({ toastKey: false }),
    );
  });

  test('and does not 404 on top of it', async () => {
    // Our failure is not the reader's wrong address.
    await render(null, '3');

    expect(createError).not.toHaveBeenCalled();
  });
});

describe('the feed', () => {
  test('is advertised, so readers can find it from the page it belongs to', async () => {
    // Without this the feed exists but nothing links to it.
    await render(many(3));

    const links = capturedHead.flatMap((h) => (h.link as { rel: string; href: string }[]) ?? []);
    const rss = links.find((l) => l.rel === 'alternate');
    expect(rss?.href).toBe('/en/blog/rss.xml');
  });
});
