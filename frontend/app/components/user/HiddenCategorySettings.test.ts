// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';

/**
 * The per-category visibility switches on the account page.
 *
 * The row itself is markup; what is worth pinning is what happens AFTER the
 * click. The toggle is optimistic and rolls itself back when the write fails,
 * and it reports whether the change actually landed -- so announcing it before
 * checking that tells a reader their live-action titles are hidden while the
 * switch in front of them has already flipped back, and files an analytics event
 * for a preference nobody holds.
 *
 * The other half is ordering: the wording and the event both describe the
 * direction of travel, which has to be read BEFORE the toggle changes it, or
 * every message names the state the reader just left.
 */
const toggleCategory = vi.fn();
const hidden = ref<string[]>([]);
const capture = vi.fn();
const toastSuccess = vi.fn();

vi.mock('~/utils/toast', () => ({ useToastSuccess: (...args: unknown[]) => toastSuccess(...args) }));

vi.stubGlobal('useI18n', () => ({
  t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${params.name}` : key),
}));
vi.stubGlobal('usePostHog', () => ({ capture }));
vi.stubGlobal('useHiddenCategories', () => ({
  isCategoryHidden: (category: string) => hidden.value.includes(category),
  canToggleCategory: (category: string) => hidden.value.includes(category) || hidden.value.length < 3,
  toggleCategory,
}));

import HiddenCategorySettings from './HiddenCategorySettings.vue';

const mounted: { unmount: () => void }[] = [];

function render() {
  const wrapper = mount(HiddenCategorySettings, { global: { stubs: { NuxtLink: true } } });
  mounted.push(wrapper);
  return wrapper;
}

/** The switch for one category, by the testid the e2e suite also uses. */
const toggle = (wrapper: ReturnType<typeof render>, slug: string) =>
  wrapper.find(`[data-testid="hidden-category-toggle-${slug}"]`);

beforeEach(() => {
  vi.clearAllMocks();
  hidden.value = [];
  // The real `toggleCategory` FLIPS the stored list before it resolves, and the
  // double has to as well: with an inert one, reading the direction before or
  // after the await gives the same answer and the ordering this file exists to
  // pin is unobservable -- every message would read correctly in the test and
  // backwards in the app.
  toggleCategory.mockImplementation(async (category: string) => {
    hidden.value = hidden.value.includes(category)
      ? hidden.value.filter((item) => item !== category)
      : [...hidden.value, category];
    return true;
  });
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('flipping a switch', () => {
  test('asks the store to hide that category', async () => {
    const wrapper = render();

    await toggle(wrapper, 'anime').trigger('change');

    expect(toggleCategory).toHaveBeenCalledWith('ANIME');
  });

  test('confirms it by NAME, not as "a category"', async () => {
    // The rows are long and the switches are small; the confirmation is how a
    // reader checks they hit the one they meant.
    const wrapper = render();

    await toggle(wrapper, 'anime').trigger('change');
    await Promise.resolve();

    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('categoryHiddenToast'));
    expect(toastSuccess.mock.calls[0]![0]).toContain('categoryAnime');
  });

  test('says SHOWN when a hidden category is brought back', async () => {
    // Read before the toggle runs: afterwards the category is visible again and
    // the message would say it had just been hidden.
    hidden.value = ['ANIME'];
    const wrapper = render();

    await toggle(wrapper, 'anime').trigger('change');
    await Promise.resolve();

    expect(toastSuccess.mock.calls[0]![0]).toContain('categoryShownToast');
  });
});

describe('a toggle the server REFUSED', () => {
  beforeEach(() => {
    // Rolled back: the stored list ends where it started, which is what the
    // switch springing back is showing the reader.
    toggleCategory.mockResolvedValue(false);
  });

  test('says nothing, because the switch has already flipped back', async () => {
    // A success toast over a rolled-back switch is worse than silence: the
    // failure already said why, and this contradicts it.
    const wrapper = render();

    await toggle(wrapper, 'anime').trigger('change');
    await Promise.resolve();

    expect(toastSuccess).not.toHaveBeenCalled();
  });

  test('and records nothing, so the funnel counts preferences that exist', async () => {
    const wrapper = render();

    await toggle(wrapper, 'anime').trigger('change');
    await Promise.resolve();

    expect(capture).not.toHaveBeenCalled();
  });
});

describe('what is recorded', () => {
  test('names the direction and the category', async () => {
    const wrapper = render();

    await toggle(wrapper, 'anime').trigger('change');
    await Promise.resolve();

    expect(capture).toHaveBeenCalledWith('category_visibility_changed', { action: 'hidden', category: 'ANIME' });
  });

  test('unhiding is a different action, not the same event twice', async () => {
    // Hidden and unhidden net out to nothing if they share a name, and the
    // question this event exists to answer is which way the traffic goes.
    hidden.value = ['ANIME'];
    const wrapper = render();

    await toggle(wrapper, 'anime').trigger('change');
    await Promise.resolve();

    expect(capture).toHaveBeenCalledWith('category_visibility_changed', { action: 'unhidden', category: 'ANIME' });
  });
});

describe('the last visible category', () => {
  test('cannot be hidden, since an empty filter means the whole corpus', () => {
    // `filters.category` reads an empty term list as "no filter", so hiding the
    // last one hands back everything rather than nothing.
    hidden.value = ['ANIME', 'LIVE_ACTION', 'YOUTUBE'];
    const wrapper = render();

    const remaining = wrapper
      .findAll('input[type="checkbox"]')
      .filter((box) => box.attributes('disabled') !== undefined);
    expect(remaining.length).toBeGreaterThan(0);
  });

  test('and says why it is stuck, rather than just refusing the click', () => {
    hidden.value = ['ANIME', 'LIVE_ACTION', 'YOUTUBE'];
    const wrapper = render();

    const stuck = wrapper.findAll('label').find((l) => l.attributes('title') !== undefined);
    expect(stuck?.attributes('title')).toContain('hiddenCategoriesLastVisible');
  });

  test('a category that is already hidden stays togglable, so nobody is locked out', () => {
    hidden.value = ['ANIME', 'LIVE_ACTION', 'YOUTUBE'];
    const wrapper = render();

    expect(toggle(wrapper, 'anime').attributes('disabled')).toBeUndefined();
  });
});

describe('the rows', () => {
  test('offer every category the corpus has', () => {
    expect(render().findAll('[data-testid="hidden-category-row"]').length).toBeGreaterThanOrEqual(3);
  });

  test('label the switch for a screen reader, which sees no row text otherwise', () => {
    // The visible label is a sibling paragraph; the input itself is `sr-only`.
    expect(toggle(render(), 'anime').attributes('aria-label')).toContain('categoryAnime');
  });

  test('say which state each category is in without making the reader read the switch', () => {
    hidden.value = ['ANIME'];
    const wrapper = render();

    expect(wrapper.text()).toContain('hiddenCategoryHidden');
    expect(wrapper.text()).toContain('hiddenCategoryShown');
  });
});
