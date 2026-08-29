// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, nextTick, reactive, ref } from 'vue';

/**
 * The account settings page, and specifically its PREFERENCE WRITES.
 *
 * Every switch here sends the whole `productEmails` object, so the one mistake
 * that matters is sending an object built from local state instead of merged
 * over what is stored: that silently clears anything the reader set on another
 * device since this page loaded. The writes are also deliberately pessimistic --
 * the switch moves only after the server agrees -- because a switch that moves
 * on click and stays moved after a failure is a reader who believes they have
 * unsubscribed and has not.
 */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({
  handleApiError: (...a: unknown[]) => handleApiError(...a),
  apiErrorStatus: () => null,
}));
const toastSuccess = vi.fn();
vi.mock('~/utils/toast', () => ({ useToastSuccess: (...a: unknown[]) => toastSuccess(...a), useToastError: vi.fn() }));
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: ref('en') }),
}));

const updateUserPreferences = vi.fn();
const capture = vi.fn();
const preferences = reactive<Record<string, unknown>>({});
const store = {
  preferences: preferences as Record<string, unknown>,
  user: { id: 'u1', name: 'Reader', email: 'r@example.test' },
  userName: 'Reader',
  userEmail: 'r@example.test',
  isLoggedIn: true,
  shirabeGlossLanguages: [],
  sessions: [],
  listSessions: vi.fn().mockResolvedValue([]),
  changeEmail: vi.fn(),
};

vi.stubGlobal('userStore', () => store);
vi.stubGlobal('useFormat', () => ({ formatDate: (d: unknown) => String(d) }));
vi.stubGlobal('useNadeshikoSdk', () => ({ updateUserPreferences, search: vi.fn() }));
vi.stubGlobal('usePostHog', () => ({ capture }));
vi.stubGlobal('useMediaCardDefault', () => ({ preference: ref('open'), startsOpen: ref(true) }));
vi.stubGlobal('useMotionPreference', () => ({ preference: ref('full') }));
vi.stubGlobal('useTranslationLanguages', () => ({ languages: ref(['en']) }));
vi.stubGlobal('useLazyAsyncData', async () => ({ data: ref(null) }));
vi.stubGlobal('useRuntimeConfig', () => ({ public: {} }));
vi.stubGlobal('useLocalePath', () => (p: string) => p);
vi.stubGlobal('useRouter', () => ({ push: vi.fn() }));
vi.stubGlobal('useDefaultSearchCategory', () => ({
  storedDefault: ref('all'),
  defaultCategorySlug: ref('all'),
  isDefaultCategoryHidden: ref(false),
}));
vi.stubGlobal('useHiddenCategories', () => ({
  hiddenCategories: ref([]),
  visibleCategories: ref([]),
  hasHiddenCategories: ref(false),
  isCategoryHidden: () => false,
  canToggleCategory: () => true,
  toggleCategory: vi.fn(),
}));
vi.stubGlobal('useDictionaryLinks', () => ({
  presets: [],
  enabledDictionaries: ref([]),
  isDictionaryEnabled: () => false,
  setDictionaryEnabled: vi.fn(),
}));

import AccountSettings from './AccountSettings.vue';

const mounted: { unmount: () => void }[] = [];

async function render(prefs: Record<string, unknown> = {}) {
  for (const key of Object.keys(preferences)) delete preferences[key];
  Object.assign(preferences, prefs);
  store.preferences = preferences;

  const Host = defineComponent({
    components: { AccountSettings },
    template: '<Suspense><AccountSettings /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        CommonBaseModal: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
        UserConnectionsCard: true,
        ConnectionsCard: true,
        SearchDropdownContainer: { template: '<div><slot /><slot name="content" /></div>' },
        SearchDropdownMainButton: { template: '<button><slot /></button>' },
        SearchDropdownItem: {
          props: ['text'],
          emits: ['click'],
          template: '<button @click="$emit(\'click\')">{{ text }}</button>',
        },
        UiBaseIcon: true,
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

/** The switch for one email category. */
const categoryToggle = (w: ReturnType<typeof mount>, name: string) => w.get(`[data-testid="email-category-${name}"]`);

beforeEach(() => {
  vi.clearAllMocks();
  updateUserPreferences.mockResolvedValue({});
  store.changeEmail.mockResolvedValue({ success: true });
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the per-category email switches', () => {
  test('start ON unless the account explicitly turned one off', async () => {
    // A missing key is a reader who never touched it, and defaulting those to
    // off would silently unsubscribe everyone with no stored preference.
    const wrapper = await render({ productEmails: { recap: false } });

    expect(categoryToggle(wrapper, 'recap').attributes('aria-pressed')).toBe('false');
    expect(categoryToggle(wrapper, 'checkins').attributes('aria-pressed')).toBe('true');
  });

  test('sends only the key that changed, MERGED over what is stored', async () => {
    // Posting an object built from local state clears anything set on another
    // device since this page loaded.
    const wrapper = await render({ productEmails: { enabled: true, recap: false } });

    await categoryToggle(wrapper, 'checkins').trigger('click');
    await flushPromises();

    expect(updateUserPreferences).toHaveBeenCalledWith({
      productEmails: { enabled: true, recap: false, checkins: false },
    });
  });

  test('the switch moves only after the server agrees', async () => {
    const wrapper = await render({ productEmails: {} });
    updateUserPreferences.mockRejectedValue(new Error('down'));

    await categoryToggle(wrapper, 'recap').trigger('click');
    await flushPromises();

    expect(categoryToggle(wrapper, 'recap').attributes('aria-pressed')).toBe('true');
    expect(handleApiError).toHaveBeenCalledWith(
      'account:product-emails-category-failed',
      expect.anything(),
      expect.anything(),
    );
  });

  test('names which switch moved, because four of them share one card', async () => {
    const wrapper = await render({ productEmails: {} });

    await categoryToggle(wrapper, 'recap').trigger('click');
    await flushPromises();

    expect(toastSuccess).toHaveBeenCalledWith('accountSettings.emails.turnedOff');
  });

  test('ignores a second switch while one is still saving', async () => {
    // They write the same object; two in flight would race and the loser's
    // change would be silently dropped.
    let release!: () => void;
    updateUserPreferences.mockReturnValue(new Promise<void>((r) => (release = () => r())));
    const wrapper = await render({ productEmails: {} });

    await categoryToggle(wrapper, 'recap').trigger('click');
    await nextTick();

    // Guarded on the BUTTONS as well as in the handler, and it is the buttons a
    // reader meets: every switch on the card goes dead until the write lands.
    expect(categoryToggle(wrapper, 'checkins').attributes('disabled')).toBeDefined();
    await categoryToggle(wrapper, 'checkins').trigger('click');
    release();
    await flushPromises();

    expect(updateUserPreferences).toHaveBeenCalledTimes(1);
  });
});

describe('the master email switch', () => {
  test('keeps the per-category settings when it is flipped', async () => {
    const wrapper = await render({ productEmails: { recap: false } });

    await wrapper.get('[data-testid="product-emails-toggle"]').trigger('click');
    await flushPromises();

    expect(updateUserPreferences).toHaveBeenCalledWith({
      productEmails: { recap: false, enabled: false },
    });
  });

  test('writes through to the store, so leaving and returning shows the new state', async () => {
    const wrapper = await render({ productEmails: {} });

    await wrapper.get('[data-testid="product-emails-toggle"]').trigger('click');
    await flushPromises();

    expect((store.preferences.productEmails as Record<string, unknown>).enabled).toBe(false);
  });

  test('stays where it was if the write failed', async () => {
    const wrapper = await render({ productEmails: {} });
    updateUserPreferences.mockRejectedValue(new Error('down'));

    await wrapper.get('[data-testid="product-emails-toggle"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="product-emails-toggle"]').attributes('aria-pressed')).toBe('true');
  });
});

describe('simple preferences', () => {
  test('a changed select is saved and written through to the store', async () => {
    const wrapper = await render({});

    await wrapper.get('[data-testid="default-search-category"]').setValue('ANIME');
    await flushPromises();

    expect(updateUserPreferences).toHaveBeenCalledWith({ defaultSearchCategory: 'ANIME' });
    expect(store.preferences.defaultSearchCategory).toBe('ANIME');
  });

  test('and reported to analytics by NAME, so settings can be told apart', async () => {
    const wrapper = await render({});

    await wrapper.get('[data-testid="default-search-category"]').setValue('ANIME');
    await flushPromises();

    expect(capture).toHaveBeenCalledWith('setting_changed', {
      setting_name: 'defaultSearchCategory',
      value: 'ANIME',
    });
  });
});
