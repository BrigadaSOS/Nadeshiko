// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { reactive } from 'vue';

/**
 * The sort control above the results.
 *
 * Two things here were learned the hard way and are easy to undo.
 *
 * The sort in force is read from `?sort=` EVERY TIME rather than latched: this
 * button is mounted twice at once (the sticky sidebar and the mobile drawer), so
 * a local copy went stale as soon as the sort changed anywhere else, and a copy
 * that remounted mid-navigation latched nothing and lost its own label.
 *
 * And RANDOM is the one sort that is not idempotent. The seed travels in the URL
 * -- without one the backend falls back to the calendar day, so "random" was a
 * single fixed order for a whole day and re-picking it refetched a byte-identical
 * page. The new seed is also drawn away from the current one, because a click
 * that produces the same URL navigates nowhere and looks like nothing happened.
 */
const setQuery = vi.fn();
const route = reactive({
  query: {} as Record<string, unknown>,
  path: '/search/cat',
  params: {},
  fullPath: '/search/cat',
});

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: { value: 'en' } }));
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useQuerySync', () => ({ setQuery }));

import SortContent from './SortContent.vue';

const mounted: { unmount: () => void }[] = [];

function render() {
  const wrapper = mount(SortContent, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        SearchDropdownContainer: { template: '<div><slot /><slot name="content" /></div>' },
        SearchDropdownContent: { template: '<div><slot /></div>' },
        SearchDropdownMainButton: { template: '<button><slot /></button>' },
        SearchDropdownItem: {
          props: ['text'],
          emits: ['click'],
          template: '<button class="sort" :data-text="text" @click="$emit(\'click\')">{{ text }}</button>',
        },
        UiBaseIcon: true,
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

async function pick(wrapper: ReturnType<typeof render>, key: string) {
  const item = wrapper.findAll('.sort').find((n) => n.attributes('data-text') === `searchpage.main.buttons.${key}`);
  if (!item) throw new Error(`no sort item ${key}`);
  await item.trigger('click');
  await flushPromises();
}
const activeLabel = (w: ReturnType<typeof render>) => w.find('[data-testid="sort-active-label"]');

beforeEach(() => {
  vi.clearAllMocks();
  route.query = {};
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the label on the button', () => {
  test('names nothing while no sort is applied', () => {
    expect(activeLabel(render()).exists()).toBe(false);
  });

  test('names the sort the URL is carrying', () => {
    // Read from the URL rather than latched, so a second copy of this control
    // shows the same thing.
    route.query = { sort: 'time_asc' };

    expect(activeLabel(render()).text()).toContain('sorttime_asc');
  });

  test('follows the URL changing under it', async () => {
    const wrapper = render();
    route.query = { sort: 'desc' };
    await flushPromises();

    expect(activeLabel(wrapper).text()).toContain('sortdesc');
  });

  test('an array `?sort=` is treated as unset rather than rendered', async () => {
    route.query = { sort: ['asc', 'desc'] };

    expect(activeLabel(render()).exists()).toBe(false);
  });
});

describe('picking an ordinary sort', () => {
  test('writes it to the URL', async () => {
    const wrapper = render();

    await pick(wrapper, 'sortlengthmin');

    expect(setQuery).toHaveBeenCalledWith({ sort: 'asc', seed: null });
  });

  test('clears the random seed on the way', async () => {
    // Left behind it is a parameter nothing reads, which then reappears the
    // next time random is picked.
    route.query = { sort: 'random', seed: '42' };
    const wrapper = render();

    await pick(wrapper, 'sortlengthmax');

    expect(setQuery).toHaveBeenCalledWith({ sort: 'desc', seed: null });
  });

  test('"none" removes the parameter rather than writing a value', async () => {
    route.query = { sort: 'asc' };
    const wrapper = render();

    await pick(wrapper, 'sortlengthnone');

    expect(setQuery).toHaveBeenCalledWith({ sort: null, seed: null });
  });

  test('re-picking the sort already in force does nothing', async () => {
    // Every sort but random is idempotent; navigating to the same URL is a
    // wasted round trip.
    route.query = { sort: 'asc' };
    const wrapper = render();

    await pick(wrapper, 'sortlengthmin');

    expect(setQuery).not.toHaveBeenCalled();
  });

  test('but still tells the drawer it was picked, so it can close', async () => {
    route.query = { sort: 'asc' };
    const wrapper = render();

    await pick(wrapper, 'sortlengthmin');

    expect(wrapper.emitted('sortSelected')).toHaveLength(1);
  });
});

describe('picking random', () => {
  test('writes a seed alongside the sort', async () => {
    // Without one the backend seeds from the calendar day, so "random" is one
    // fixed order for the whole day.
    const wrapper = render();

    await pick(wrapper, 'sortrandom');

    const [arg] = setQuery.mock.calls[0]!;
    expect(arg.sort).toBe('random');
    expect(Number.isInteger(Number(arg.seed))).toBe(true);
  });

  test('re-picking it RESHUFFLES rather than doing nothing', async () => {
    route.query = { sort: 'random', seed: '42' };
    const wrapper = render();

    await pick(wrapper, 'sortrandom');

    expect(setQuery).toHaveBeenCalledTimes(1);
  });

  test('and always draws a different seed, so the URL actually changes', async () => {
    // A repeat navigates nowhere and reads as nothing having happened.
    route.query = { sort: 'random', seed: '42' };
    const wrapper = render();

    for (let i = 0; i < 25; i++) await pick(wrapper, 'sortrandom');

    for (const [arg] of setQuery.mock.calls) expect(arg.seed).not.toBe('42');
  });

  test('a non-numeric seed in the URL is treated as none', async () => {
    route.query = { sort: 'random', seed: 'banana' };
    const wrapper = render();

    await pick(wrapper, 'sortrandom');

    expect(Number.isInteger(Number(setQuery.mock.calls[0]![0].seed))).toBe(true);
  });
});
