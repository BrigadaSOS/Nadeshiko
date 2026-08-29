// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';

/**
 * A post's card on the blog index.
 *
 * The date is the fragile part. Frontmatter dates arrive as strings, as `Date`s,
 * as the empty object a serialiser leaves behind, and sometimes as nonsense --
 * and every one of those used to be handed to the formatter. The card must show
 * NOTHING rather than "Invalid Date", which is what a reader would otherwise
 * read as the publication date.
 *
 * The link prefers the post's own `path` over one built from the slug, because a
 * post nested under a section has a path the slug alone cannot reconstruct.
 */
const d = vi.fn((value: Date) => value.toISOString().slice(0, 10));

// AUTO-IMPORTED here, not pulled from 'vue-i18n' -- a module mock never applies.
vi.stubGlobal('useI18n', () => ({ d, t: (k: string) => k, locale: ref('en') }));

import BlogCard from './BlogCard.vue';

const post = (over: Record<string, unknown> = {}) => ({
  slug: 'hello',
  title: 'Hello',
  description: 'A post about things',
  date: '2026-01-15T00:00:00Z',
  ...over,
});

const mounted: { unmount: () => void }[] = [];

function render(over: Record<string, unknown> = {}) {
  const wrapper = mount(BlogCard, {
    props: { post: post(over) } as never,
    global: {
      mocks: { $t: (k: string) => k },
      stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' }, NuxtImg: true, UiBaseIcon: true },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

const href = (w: ReturnType<typeof render>) => w.find('a').attributes('href');

beforeEach(() => {
  vi.clearAllMocks();
  d.mockImplementation((value: Date) => value.toISOString().slice(0, 10));
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('where the card links', () => {
  test('to the post’s own path when it has one', () => {
    // A post nested under a section has a path the slug alone cannot rebuild.
    expect(href(render({ path: '/blog/2026/hello' }))).toBe('/blog/2026/hello');
  });

  test('and to one built from the slug otherwise', () => {
    expect(href(render())).toBe('/blog/hello');
  });

  test('a post with neither still renders a link rather than crashing', () => {
    expect(href(render({ path: undefined, slug: '' }))).toBe('/blog/');
  });
});

describe('the date', () => {
  test('a string date is formatted', () => {
    const wrapper = render({ date: '2026-01-15T00:00:00Z' });

    expect(wrapper.text()).toContain('2026-01-15');
  });

  test('a real Date is too', () => {
    const wrapper = render({ date: new Date('2026-03-01T00:00:00Z') });

    expect(wrapper.text()).toContain('2026-03-01');
  });

  test('a missing date shows NOTHING, not "Invalid Date"', () => {
    // Which is what a reader would otherwise read as the publication date.
    const wrapper = render({ date: null });

    expect(d).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('Invalid');
  });

  test('and nonsense shows nothing either', () => {
    const wrapper = render({ date: 'not-a-date' });

    expect(d).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('Invalid');
  });

  test('the empty object a serialiser leaves behind shows nothing', () => {
    // `{}` survives JSON round-trips where a Date does not.
    const wrapper = render({ date: {} });

    expect(d).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('Invalid');
  });

  test('a formatter that throws does not take the card down with it', () => {
    // The card is one of nine on the index; one bad date must not blank the page.
    d.mockImplementation(() => {
      throw new Error('bad locale');
    });
    const wrapper = render();

    expect(wrapper.find('[data-testid="blog-post"]').exists()).toBe(true);
  });
});

describe('the preview text', () => {
  test('falls back to the description when the post has no body', () => {
    const wrapper = render({ rawbody: undefined, description: 'A post about things' });

    expect(wrapper.text()).toContain('A post about things');
  });

  test('and a post with neither still renders', () => {
    const wrapper = render({ rawbody: undefined, description: '' });

    expect(wrapper.find('[data-testid="blog-post"]').exists()).toBe(true);
  });
});
