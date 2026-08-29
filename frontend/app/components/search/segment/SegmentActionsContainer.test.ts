// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';

/**
 * The Add / Copy / Download menus on a result card.
 *
 * What is pinned here is the ANKI GATING, which is three conditions with a
 * deliberate precedence between them. Both exports need a configured profile;
 * only the note PICKER needs a key field, because it is the one that searches on
 * it -- "add to last added card" targets `added:2 is:new` and has never consulted
 * the key. And a profile can be perfectly filled in while Anki is closed, which
 * is a different problem again.
 *
 * The message ordering is the part that cannot be eyeballed: no amount of
 * running Anki helps a profile with no note type, so configuration is reported
 * ahead of reachability. Getting that backwards sends a reader to start Anki
 * when what they actually need is to finish their settings.
 *
 * `connectReachable === null` is its own case: nothing has asked AnkiConnect
 * this session, and disabling the export on that would disable it for every
 * reader who has not opened a word card yet.
 */
const activeProfile = ref<Record<string, unknown> | null>(null);
const connectReachable = ref<boolean | null>(null);
const isLoggedIn = ref(true);

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useRouter', () => ({ push: vi.fn() }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('usePostHog', () => ({ capture: vi.fn() }));
vi.stubGlobal('useToastSuccess', vi.fn());
vi.stubGlobal('useToastError', vi.fn());
vi.stubGlobal('useNadeshikoSdk', () => ({ addSegmentToCollection: vi.fn() }));
vi.stubGlobal('useLoginModal', () => ({ openLoginModal: vi.fn(), isLoginModalOpen: ref(false) }));
vi.stubGlobal('useSignupNudge', () => ({
  nudgeAfterDownload: vi.fn(),
  nudgeAfterAnkiMenu: vi.fn(),
  recordSearch: vi.fn(),
}));
vi.stubGlobal('useTranslationVisibility', () => ({
  englishMode: ref('visible'),
  spanishMode: ref('visible'),
  includedLanguages: ref(['EN']),
}));
vi.stubGlobal('useTranslationLanguages', () => ({ languages: ref(['EN']), dictionaryGlossLanguages: ref(['en']) }));
vi.stubGlobal('useCollectionOptions', () => ({
  collections: ref([]),
  loading: ref(false),
  loaded: ref(true),
  lastCollection: ref(null),
  load: vi.fn(),
  rememberLast: vi.fn(),
  restoreLastCollection: vi.fn(),
}));
// MOCKED as modules: both stores are imported directly here, so a `stubGlobal`
// never applies and the real (empty) Pinia stores are used -- which reads as an
// unconfigured profile and makes every "offered" assertion fail while every
// "blocked" one passes for the wrong reason.
vi.mock('@/stores/anki', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ankiStore: () => ({
      get activeProfile() {
        return activeProfile.value;
      },
      get connectReachable() {
        return connectReachable.value;
      },
      addResultToAnki: vi.fn(),
    }),
  };
});
vi.mock('@/stores/auth', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    userStore: () => ({
      get isLoggedIn() {
        return isLoggedIn.value;
      },
      user: { id: 'u1' },
    }),
  };
});

import SegmentActionsContainer from './SegmentActionsContainer.vue';

/** A profile good enough to export with. */
const profile = (over: Record<string, unknown> = {}) => ({
  deck: 'Mining',
  model: 'Lapis',
  key: 'Expression',
  fields: [{ key: 'Expression', value: '{word}' }],
  ...over,
});

const content = () => ({
  segment: {
    publicId: 's1',
    textJa: { content: '猫' },
    textEn: { content: 'cat' },
    textEs: { content: '' },
    episode: 1,
    startTimeMs: 0,
    endTimeMs: 2000,
    urls: { audioUrl: 'a.mp3', imageUrl: 'i.png', videoUrl: 'v.mp4' },
  },
  media: { publicId: 'm1', nameEn: 'Bocchi', slug: 'bocchi', category: 'ANIME' },
});

const mounted: { unmount: () => void }[] = [];

/** Renders menu items flat, carrying the state the gating decides. */
const ItemStub = {
  props: ['text', 'isDisabled', 'tooltip'],
  emits: ['click'],
  template: `<button class="item" :data-text="text" :data-disabled="String(!!isDisabled)"
    :data-tooltip="tooltip ?? ''" @click="$emit('click')">{{ text }}</button>`,
};

function render() {
  const wrapper = mount(SegmentActionsContainer, {
    props: { content: content() } as never,
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        SearchDropdownContainer: { template: '<div><slot /><slot name="content" /></div>' },
        SearchDropdownContent: { template: '<div><slot /></div>' },
        SearchDropdownMainButton: { template: '<button><slot /></button>' },
        SearchDropdownItem: ItemStub,
        ClientOnly: { template: '<div><slot /></div>' },
        UiBaseIcon: true,
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
        CommonBaseModal: true,
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

/** One menu item by its label key. */
function item(wrapper: ReturnType<typeof render>, key: string) {
  const found = wrapper.findAll('.item').find((n) => n.attributes('data-text') === key);
  if (!found) throw new Error(`no menu item labelled ${key}`);
  return found;
}
const LAST = 'searchpage.main.buttons.addToAnkiLast';
const PICKER = 'searchpage.main.buttons.addToAnkiSearch';
const disabled = (w: ReturnType<typeof render>, key: string) => item(w, key).attributes('data-disabled') === 'true';
const tooltip = (w: ReturnType<typeof render>, key: string) => item(w, key).attributes('data-tooltip');

beforeEach(() => {
  vi.clearAllMocks();
  activeProfile.value = profile();
  connectReachable.value = null;
  isLoggedIn.value = true;
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('a fully configured profile', () => {
  test('offers both Anki exports', () => {
    const wrapper = render();

    expect(disabled(wrapper, LAST)).toBe(false);
    expect(disabled(wrapper, PICKER)).toBe(false);
  });

  test('stays offered while nothing has asked Anki yet', () => {
    // `null` is "unknown", not "unreachable". Disabling on it would disable the
    // export for every reader who has not opened a word card this session.
    connectReachable.value = null;
    const wrapper = render();

    expect(disabled(wrapper, LAST)).toBe(false);
  });
});

describe('a profile that is not finished', () => {
  test.each([
    ['no deck', { deck: '' }],
    ['no note type', { model: '' }],
    ['no field mapping', { fields: [] }],
    ['a deck of only whitespace', { deck: '   ' }],
  ])('%s blocks both exports', (_name, over) => {
    activeProfile.value = profile(over);
    const wrapper = render();

    expect(disabled(wrapper, LAST)).toBe(true);
    expect(disabled(wrapper, PICKER)).toBe(true);
  });

  test('and says to finish the settings, not to start Anki', () => {
    // No amount of running Anki helps a profile with no note type.
    activeProfile.value = profile({ model: '' });
    const wrapper = render();

    expect(tooltip(wrapper, LAST)).toBe('anki.configRequired');
  });

  test('no profile at all blocks them too', () => {
    activeProfile.value = null;
    const wrapper = render();

    expect(disabled(wrapper, LAST)).toBe(true);
  });
});

describe('Anki not running', () => {
  beforeEach(() => {
    connectReachable.value = false;
  });

  test('blocks both exports, rather than sending the reader to a failing toast', () => {
    const wrapper = render();

    expect(disabled(wrapper, LAST)).toBe(true);
    expect(disabled(wrapper, PICKER)).toBe(true);
  });

  test('and says so', () => {
    const wrapper = render();

    expect(tooltip(wrapper, LAST)).toBe('anki.notRunning');
  });

  test('but an UNFINISHED profile is still reported first', () => {
    // Both are true; the one the reader has to fix first is the settings.
    activeProfile.value = profile({ model: '' });
    const wrapper = render();

    expect(tooltip(wrapper, LAST)).toBe('anki.configRequired');
  });
});

describe('the key field, which only the note picker needs', () => {
  test('without one the picker is blocked and the other export is not', () => {
    // "Add to last added card" targets `added:2 is:new` and has never consulted
    // the key at all.
    activeProfile.value = profile({ key: '' });
    const wrapper = render();

    expect(disabled(wrapper, PICKER)).toBe(true);
    expect(disabled(wrapper, LAST)).toBe(false);
  });

  test('a key of only whitespace counts as none', () => {
    activeProfile.value = profile({ key: '   ' });
    const wrapper = render();

    expect(disabled(wrapper, PICKER)).toBe(true);
  });

  test('and the picker says which field is missing', () => {
    activeProfile.value = profile({ key: '' });
    const wrapper = render();

    expect(tooltip(wrapper, PICKER)).toBe('anki.keyFieldRequired');
  });

  test('an unfinished profile outranks the missing key', () => {
    activeProfile.value = profile({ model: '', key: '' });
    const wrapper = render();

    expect(tooltip(wrapper, PICKER)).toBe('anki.configRequired');
  });

  test('and the missing key outranks Anki being closed', () => {
    // Ordered by what has to be fixed first: a settings problem before a
    // "start the app" one.
    activeProfile.value = profile({ key: '' });
    connectReachable.value = false;
    const wrapper = render();

    expect(tooltip(wrapper, PICKER)).toBe('anki.keyFieldRequired');
  });
});
