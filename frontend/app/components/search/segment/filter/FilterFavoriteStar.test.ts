// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';

/**
 * The star on a title row in the media filter.
 *
 * The interesting case is the row that is NOT a title: episode rows pass a
 * spacer with no id, because they are not a thing you star but the title above
 * them is, and the empty column keeps their counts under that one. That rule
 * lives here rather than as a `v-if` at each call site, so both call sites
 * cannot drift apart -- which is also why the spacer is a real element and not
 * nothing at all.
 *
 * The star is always a SIBLING of the row's own button, never a child: a button
 * inside a button is invalid markup and breaks hydration.
 */
const toggleFavorite = vi.fn();
const favourites = ref<string[]>([]);
const isLoggedIn = ref(true);
const atCap = ref(false);

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('userStore', () => ({
  get isLoggedIn() {
    return isLoggedIn.value;
  },
}));
vi.stubGlobal('useFavoriteMedia', () => ({
  isFavorite: (id: string) => favourites.value.includes(id),
  atCap,
  toggleFavorite,
  favoriteMediaIds: ref(new Set(favourites.value)),
  items: ref([]),
}));

import FilterFavoriteStar from './FilterFavoriteStar.vue';

const mounted: { unmount: () => void }[] = [];

function render(media: Record<string, unknown>) {
  const wrapper = mount(FilterFavoriteStar, {
    props: { media } as never,
    global: { mocks: { $t: (k: string) => k }, stubs: { UiBaseIcon: true } },
  });
  mounted.push(wrapper);
  return wrapper;
}

const star = (w: ReturnType<typeof render>) => w.find('[data-testid="media-filter-favorite"]');

beforeEach(() => {
  vi.clearAllMocks();
  favourites.value = [];
  isLoggedIn.value = true;
  atCap.value = false;
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('when the row is a title', () => {
  test('offers a star', () => {
    expect(star(render({ mediaPublicId: 'm1', nameEn: 'Bocchi' })).exists()).toBe(true);
  });

  test('pressing it sends the id AND the names', () => {
    // The names travel with the id so the starred list renders without a second
    // lookup.
    const wrapper = render({ mediaPublicId: 'm1', nameEn: 'Bocchi', nameJa: 'ぼっち' });

    star(wrapper).trigger('click');

    expect(toggleFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ publicId: 'm1', nameEn: 'Bocchi', nameJa: 'ぼっち' }),
    );
  });

  test('shows as starred when it already is', () => {
    favourites.value = ['m1'];
    const wrapper = render({ mediaPublicId: 'm1' });

    expect(star(wrapper).attributes('aria-pressed')).toBe('true');
  });

  test('and as unstarred otherwise', () => {
    expect(star(render({ mediaPublicId: 'm1' })).attributes('aria-pressed')).toBe('false');
  });
});

describe('when the row is NOT a title', () => {
  test('renders no star for an episode row', () => {
    // An episode is not a thing you star.
    expect(star(render({ mediaPublicId: null })).exists()).toBe(false);
  });

  test('but still renders a SPACER, so the counts stay in one column', () => {
    // Rendering nothing would let the episode counts slide under the title
    // counts above them.
    const wrapper = render({ mediaPublicId: null });

    expect(wrapper.html().trim()).not.toBe('');
    expect(wrapper.find('span').exists()).toBe(true);
  });

  test('and the spacer is hidden from screen readers, having nothing to say', () => {
    expect(render({ mediaPublicId: null }).find('span').attributes('aria-hidden')).toBe('true');
  });
});

describe('a signed-out reader', () => {
  test('gets neither a star nor a spacer, because the column is not there', () => {
    isLoggedIn.value = false;
    const wrapper = render({ mediaPublicId: 'm1' });

    expect(star(wrapper).exists()).toBe(false);
    // A bare v-if comment node is all that is left -- no element either way.
    expect(wrapper.find('span').exists()).toBe(false);
  });
});

describe('the markup', () => {
  test('is never a button inside a button', () => {
    // The row itself is a button; nesting one breaks hydration.
    const wrapper = render({ mediaPublicId: 'm1' });

    expect(wrapper.findAll('button button')).toHaveLength(0);
  });

  test('stops the click reaching the row it sits on', () => {
    // Otherwise starring a title also drills into it.
    const wrapper = render({ mediaPublicId: 'm1' });
    const handler = vi.fn();
    wrapper.element.parentElement?.addEventListener('click', handler);

    star(wrapper).trigger('click');

    expect(handler).not.toHaveBeenCalled();
  });
});
