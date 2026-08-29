// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

/**
 * The activity page's own logic, which is entirely about WRITES.
 *
 * The two switches here decide whether we keep a record of what the reader
 * does, so the direction that matters is the failure one: a switch that moves on
 * click and stays moved after the server refused leaves a reader believing they
 * have turned tracking off while it is still on. Both are therefore pessimistic
 * -- the switch follows the server, not the click -- and both write through to
 * the store, because the initial value is read back from there and leaving the
 * page would otherwise show the old state.
 *
 * The rendering is four child components with their own concerns; they are
 * stubbed down to the events they raise, which is the surface this component
 * actually owns.
 */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));
const toastSuccess = vi.fn();
vi.mock('~/utils/toast', () => ({ useToastSuccess: (...a: unknown[]) => toastSuccess(...a), useToastError: vi.fn() }));

const updateUserPreferences = vi.fn();
const listUserActivity = vi.fn();
const getUserActivityStats = vi.fn();
const getUserActivityHeatmap = vi.fn();
const getUserPreferences = vi.fn();
const deleteUserActivity = vi.fn();
const deleteUserActivityById = vi.fn();
const deleteUserActivityByDate = vi.fn();
const capture = vi.fn();
const preferences = ref<Record<string, unknown>>({});
const store = {
  get preferences() {
    return preferences.value;
  },
  set preferences(next: Record<string, unknown>) {
    preferences.value = next;
  },
  isLoggedIn: true,
  user: { id: 'u1' },
};

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('userStore', () => store);
vi.stubGlobal('usePostHog', () => ({ capture }));
vi.stubGlobal('useToastSuccess', toastSuccess);
vi.stubGlobal('useNadeshikoSdk', () => ({
  updateUserPreferences,
  listUserActivity,
  getUserActivityStats,
  getUserActivityHeatmap,
  getUserPreferences,
  deleteUserActivity,
  deleteUserActivityById,
  deleteUserActivityByDate,
}));
vi.stubGlobal('useFamiliarMedia', () => ({
  entries: ref([]),
  inferredRank: ref(new Map()),
  load: vi.fn(),
  forget: vi.fn(),
}));
vi.stubGlobal(
  'useAsyncData',
  async (_k: string, handler: () => Promise<unknown>, opts?: { default?: () => unknown }) => {
    const data = ref<unknown>(opts?.default?.() ?? null);
    const refresh = async () => {
      data.value = await handler();
    };
    await refresh();
    return { data, refresh, pending: ref(false), error: ref(null) };
  },
);

import { useCursorPagination } from '~/composables/useCursorPagination';
vi.stubGlobal('useCursorPagination', useCursorPagination);

import ActivityDashboard from './ActivityDashboard.vue';

const mounted: { unmount: () => void }[] = [];

/** The privacy card, reduced to the events it raises. */
const PrivacyStub = {
  props: ['trackingEnabled', 'toggling', 'clearing', 'familiarEnabled', 'togglingFamiliar', 'familiarEntries'],
  emits: ['toggle-tracking', 'clear-history', 'toggle-familiar', 'forget-familiar'],
  template: `<div>
    <span data-testid="tracking">{{ String(trackingEnabled) }}</span>
    <span data-testid="familiar">{{ String(familiarEnabled) }}</span>
    <button data-act="toggle-tracking" @click="$emit('toggle-tracking')">t</button>
    <button data-act="toggle-familiar" @click="$emit('toggle-familiar')">f</button>
  </div>`,
};

async function render(prefs: Record<string, unknown> = {}) {
  preferences.value = prefs;
  listUserActivity.mockResolvedValue({ activities: [], pagination: { cursor: null, hasMore: false } });
  getUserActivityStats.mockResolvedValue({ stats: {} });
  getUserActivityHeatmap.mockResolvedValue({ heatmap: {} });
  getUserPreferences.mockResolvedValue({ preferences: preferences.value });

  const Host = defineComponent({
    components: { ActivityDashboard },
    template: '<Suspense><ActivityDashboard /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        UserActivityPrivacy: PrivacyStub,
        UserActivityStatsCards: true,
        UserActivityHeatmap: true,
        UserActivityHistory: true,
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const shown = (w: ReturnType<typeof mount>, name: string) => w.get(`[data-testid="${name}"]`).text();
const act = (w: ReturnType<typeof mount>, name: string) => w.get(`[data-act="${name}"]`);

beforeEach(() => {
  vi.clearAllMocks();
  updateUserPreferences.mockResolvedValue({});
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the tracking switch', () => {
  test('is ON unless the account turned it off', async () => {
    // A missing preference is a reader who never touched it, and defaulting
    // those to off would silently stop recording for everyone.
    expect(shown(await render({}), 'tracking')).toBe('true');
  });

  test('reads an explicit off', async () => {
    expect(shown(await render({ searchHistory: { enabled: false } }), 'tracking')).toBe('false');
  });

  test('turning it off asks the server first, and only then moves', async () => {
    const wrapper = await render({});

    await act(wrapper, 'toggle-tracking').trigger('click');
    await flushPromises();

    expect(updateUserPreferences).toHaveBeenCalledWith({ searchHistory: { enabled: false } });
    expect(shown(wrapper, 'tracking')).toBe('false');
  });

  test('a REFUSED write leaves the switch where it was', async () => {
    // The one failure that matters: a reader who believes they are no longer
    // being recorded, and is.
    updateUserPreferences.mockRejectedValue(new Error('down'));
    const wrapper = await render({});

    await act(wrapper, 'toggle-tracking').trigger('click');
    await flushPromises();

    expect(shown(wrapper, 'tracking')).toBe('true');
    expect(handleApiError).toHaveBeenCalledWith('activity.toggleTracking', expect.anything());
  });

  test('writes through to the store, so leaving and returning shows the new state', async () => {
    const wrapper = await render({});

    await act(wrapper, 'toggle-tracking').trigger('click');
    await flushPromises();

    expect((store.preferences.searchHistory as Record<string, unknown>).enabled).toBe(false);
  });

  test('ignores a second press while the first is still in flight', async () => {
    let release!: () => void;
    updateUserPreferences.mockReturnValue(new Promise<void>((r) => (release = () => r())));
    const wrapper = await render({});

    await act(wrapper, 'toggle-tracking').trigger('click');
    await act(wrapper, 'toggle-tracking').trigger('click');
    release();
    await flushPromises();

    expect(updateUserPreferences).toHaveBeenCalledTimes(1);
  });
});

describe('the familiar-media switch', () => {
  test('defaults on, and follows an explicit off', async () => {
    expect(shown(await render({}), 'familiar')).toBe('true');
    expect(shown(await render({ familiarMedia: { enabled: false } }), 'familiar')).toBe('false');
  });

  test('moves only after the server agrees', async () => {
    const wrapper = await render({});

    await act(wrapper, 'toggle-familiar').trigger('click');
    await flushPromises();

    expect(updateUserPreferences).toHaveBeenCalledWith({ familiarMedia: { enabled: false } });
    expect(shown(wrapper, 'familiar')).toBe('false');
  });

  test('and stays put when it does not', async () => {
    updateUserPreferences.mockRejectedValue(new Error('down'));
    const wrapper = await render({});

    await act(wrapper, 'toggle-familiar').trigger('click');
    await flushPromises();

    expect(shown(wrapper, 'familiar')).toBe('true');
  });

  test('the two switches are independent', async () => {
    // They write different preference keys; one must not clear the other.
    const wrapper = await render({ searchHistory: { enabled: false } });

    await act(wrapper, 'toggle-familiar').trigger('click');
    await flushPromises();

    expect(shown(wrapper, 'tracking')).toBe('false');
    expect((store.preferences.searchHistory as Record<string, unknown>).enabled).toBe(false);
  });
});
