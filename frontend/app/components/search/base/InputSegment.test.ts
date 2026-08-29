// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, reactive, ref, shallowRef } from 'vue';

/**
 * The search box, and the recent-searches menu that drops out of it.
 *
 * The part worth pinning is ARROW NAVIGATION, because `-1` is a real position in
 * it: it means the reader is back in their own typing rather than on a row. The
 * list therefore wraps through the input at both ends -- down from the last row
 * returns to the query, up from the query lands on the last row -- and every
 * off-by-one here is silent. The reader presses Enter and gets a search they did
 * not choose, which is the one outcome a suggestion list must never produce.
 *
 * `aria-activedescendant` is what the component publishes that position as, and
 * it is also what a screen reader announces, so it is the honest thing to assert
 * against rather than an internal ref.
 */
const route = reactive({ path: '/search/word', params: { query: 'word' }, query: {} as Record<string, unknown> });
const push = vi.fn();
const narrow = vi.fn();
const forget = vi.fn();
const clear = vi.fn();

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useRoute', () => route);
// `currentRoute`, not `useRoute()`: this component reads the router's own ref so
// it updates when a navigation is CONFIRMED rather than when it starts.
vi.stubGlobal('useRouter', () => ({ push, replace: vi.fn(), currentRoute: shallowRef(route) }));
vi.stubGlobal('useLocalePath', () => (p: unknown) => (typeof p === 'string' ? p : JSON.stringify(p)));
vi.stubGlobal('useEventListener', vi.fn());
vi.stubGlobal('onClickOutside', vi.fn());
vi.stubGlobal('useDebounceFn', (fn: unknown) => fn);
vi.stubGlobal('navigateSearchSentence', vi.fn());
vi.stubGlobal('userStore', () => ({ isLoggedIn: true, preferences: {} }));
vi.stubGlobal('useSearchRecents', () => ({
  recents: ref([]),
  loading: ref(false),
  clearing: ref(false),
  isRecording: ref(false),
  load: vi.fn(),
  remember: vi.fn(),
  forget,
  clear,
  narrow,
}));

import { useEnterSubmit } from '~/composables/useEnterSubmit';
// The real one: Enter here has to survive an IME confirming a conversion, which
// is the whole reason that composable exists (#399).
vi.stubGlobal('useEnterSubmit', useEnterSubmit);

import InputSegment from './InputSegment.vue';

const recent = (query: string) => ({ query, media: null });

const mounted: { unmount: () => void }[] = [];

function render(items: ReturnType<typeof recent>[] = []) {
  narrow.mockReturnValue(items);
  const wrapper = mount(InputSegment, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        SearchRecentsMenu: {
          props: ['items', 'activeIndex'],
          template: `<ul data-testid="recents"><li v-for="(it, i) in items" :key="i"
            :data-recent="i" :data-active="i === activeIndex">{{ it.query }}</li></ul>`,
        },
        SearchModalBatch: true,
        UiBaseIcon: true,
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
      },
    },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

const input = (w: ReturnType<typeof render>) => w.get('[data-testid="search-input"]');
/** The row a screen reader would announce as current, or null for the input. */
const activeRow = (w: ReturnType<typeof render>) => input(w).attributes('aria-activedescendant') ?? null;
const rowsShown = (w: ReturnType<typeof render>) => w.findAll('[data-recent]').map((n) => n.text());

async function arrow(w: ReturnType<typeof render>, key: 'ArrowDown' | 'ArrowUp') {
  await input(w).trigger('keydown', { key });
}

beforeEach(() => {
  vi.clearAllMocks();
  route.params = { query: 'word' };
  narrow.mockReturnValue([]);
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
});

describe('the box itself', () => {
  test('starts from the query in the URL', () => {
    expect((input(render()).element as HTMLInputElement).value).toBe('word');
  });

  test('follows the URL when the reader navigates', async () => {
    const wrapper = render();
    route.params = { query: 'other' };
    await nextTick();

    expect((input(wrapper).element as HTMLInputElement).value).toBe('other');
  });

  test('the clear button empties it', async () => {
    const wrapper = render();

    await wrapper.get('[data-testid="search-clear"]').trigger('click');

    expect((input(wrapper).element as HTMLInputElement).value).toBe('');
  });
});

describe('opening the recents menu', () => {
  test('focusing the box offers what the reader searched before', async () => {
    const wrapper = render([recent('猫'), recent('犬')]);

    await input(wrapper).trigger('focus');

    expect(rowsShown(wrapper)).toEqual(['猫', '犬']);
  });

  test('stays shut when there is nothing to offer', async () => {
    const wrapper = render([]);

    await input(wrapper).trigger('focus');

    expect(wrapper.find('[data-testid="recents"]').exists()).toBe(false);
  });

  test('an arrow opens it too', async () => {
    const wrapper = render([recent('猫')]);

    await arrow(wrapper, 'ArrowDown');

    expect(wrapper.find('[data-testid="recents"]').exists()).toBe(true);
  });
});

describe('arrowing through the recents', () => {
  async function open(items: ReturnType<typeof recent>[]) {
    const wrapper = render(items);
    await input(wrapper).trigger('focus');
    return wrapper;
  }

  test('nothing is preselected, so Enter submits what was typed', async () => {
    // A preselected first row turns Enter into "search something else".
    const wrapper = await open([recent('猫'), recent('犬')]);

    expect(activeRow(wrapper)).toBeNull();
  });

  test('down walks the list', async () => {
    const wrapper = await open([recent('猫'), recent('犬')]);

    await arrow(wrapper, 'ArrowDown');
    expect(wrapper.get('[data-recent="0"]').attributes('data-active')).toBe('true');

    await arrow(wrapper, 'ArrowDown');
    expect(wrapper.get('[data-recent="1"]').attributes('data-active')).toBe('true');
  });

  test('down off the END returns to the reader’s own typing', async () => {
    // Not a wrap to the first row: the query is a position in this list, and
    // skipping past it means the box can never be got back to with the keyboard.
    const wrapper = await open([recent('猫'), recent('犬')]);

    await arrow(wrapper, 'ArrowDown');
    await arrow(wrapper, 'ArrowDown');
    await arrow(wrapper, 'ArrowDown');

    expect(activeRow(wrapper)).toBeNull();
  });

  test('up from the typing lands on the LAST row', async () => {
    const wrapper = await open([recent('猫'), recent('犬')]);

    await arrow(wrapper, 'ArrowUp');

    expect(wrapper.get('[data-recent="1"]').attributes('data-active')).toBe('true');
  });

  test('up walks back and returns to the typing', async () => {
    const wrapper = await open([recent('猫'), recent('犬')]);

    await arrow(wrapper, 'ArrowUp');
    await arrow(wrapper, 'ArrowUp');
    expect(wrapper.get('[data-recent="0"]').attributes('data-active')).toBe('true');

    await arrow(wrapper, 'ArrowUp');
    expect(activeRow(wrapper)).toBeNull();
  });

  test('typing clears the highlight, because the list under it changed', async () => {
    // The row Enter would take is no longer the row that was highlighted.
    const wrapper = await open([recent('猫'), recent('犬')]);
    await arrow(wrapper, 'ArrowDown');
    expect(activeRow(wrapper)).toBeTruthy();

    await input(wrapper).setValue('ね');
    await nextTick();

    expect(activeRow(wrapper)).toBeNull();
  });

  test('Escape shuts the menu', async () => {
    const wrapper = await open([recent('猫')]);

    await input(wrapper).trigger('keydown', { key: 'Escape' });

    expect(wrapper.find('[data-testid="recents"]').exists()).toBe(false);
  });

  test('Tab shuts it too, on the way out of the box', async () => {
    const wrapper = await open([recent('猫')]);

    await input(wrapper).trigger('keydown', { key: 'Tab' });

    expect(wrapper.find('[data-testid="recents"]').exists()).toBe(false);
  });

  test('a key the IME is still holding is not navigation', async () => {
    // 229 is the legacy spelling of "this went to the IME, not to you", and
    // arrowing through conversion candidates must not move this list.
    const wrapper = await open([recent('猫'), recent('犬')]);

    await input(wrapper).trigger('keydown', { key: 'ArrowDown', keyCode: 229 });

    expect(activeRow(wrapper)).toBeNull();
  });
});
