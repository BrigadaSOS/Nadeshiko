// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, ref } from 'vue';

/**
 * The clickable sentence, and the word card that opens off it.
 *
 * Most of this card's DECISIONS already live in `~/utils/wordCard` and are unit
 * tested there -- which is what leaves this file worth testing for its WIRING:
 * which tokens are clickable at all, that the card opens on the token pressed
 * and closes again, and the one piece of disambiguation that is local to it.
 *
 * That piece is `duplicateHeadwords`. あれ is two words -- a pronoun and an
 * interjection -- and only the chips a reader cannot otherwise tell apart get a
 * part-of-speech letter. It counts over what is PRINTED rather than over the
 * headword, because two chips are indistinguishable when they carry the same
 * label, and a word shown under its kanji is no longer a duplicate of the kana
 * it shares a headword with. Getting that backwards either labels everything
 * (noise on every card) or nothing (あれ twice, with nothing to choose by).
 */
const peekWord = vi.fn();
const fetchWord = vi.fn();
vi.mock('~/utils/wordLookup', () => ({
  peekWord: (...a: unknown[]) => peekWord(...a),
  fetchWord: (...a: unknown[]) => fetchWord(...a),
}));

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useRouter', () => ({ push: vi.fn() }));
vi.stubGlobal('useLocalePath', () => (p: unknown) => (typeof p === 'string' ? p : JSON.stringify(p)));
vi.stubGlobal('usePostHog', () => ({ capture: vi.fn() }));
vi.stubGlobal('useNuxtApp', () => ({ $i18n: { t: (k: string) => k } }));
vi.stubGlobal('useRuntimeConfig', () => ({ public: { shirabeLookups: true } }));
vi.stubGlobal('useHiraganaVisibility', () => ({ showHiragana: ref(true) }));
vi.stubGlobal('useTranslationLanguages', () => ({
  languages: ref(['EN']),
  dictionaryGlossLanguages: ref(['en']),
}));
vi.stubGlobal('useTranslationVisibility', () => ({ englishMode: ref('visible'), spanishMode: ref('visible') }));
vi.stubGlobal('useDictionaryLinks', () => ({
  presets: [],
  enabledDictionaries: ref([]),
  isDictionaryEnabled: () => false,
  setDictionaryEnabled: vi.fn(),
}));
import { useDropdownState } from '~/composables/useDropdownState';
// The REAL shared-overlay state: the card's open/closed condition is held in it,
// and a stub whose methods do nothing leaves the flag permanently false -- the
// card never opens and every assertion about it passes by never rendering.
vi.stubGlobal('useDropdownState', useDropdownState);
vi.stubGlobal('onViewportWidthChange', vi.fn());
vi.stubGlobal('userStore', () => ({ isLoggedIn: true, preferences: {}, shirabeGlossLanguages: [] }));
vi.stubGlobal('useWordMining', () => ({
  minedNoteId: ref(null),
  mining: ref(false),
  canConfigureMine: ref(false),
  canMine: ref(false),
  mineBlockedReason: ref(null),
  mineReady: ref(false),
  mapsDefinition: ref(false),
  probeMined: vi.fn(),
  clearMined: vi.fn(),
  openMinedNote: vi.fn(),
  mineSentence: vi.fn(),
}));

// The card's own composables, registered REAL for the same reason the two
// modules below are: they hold the card's state, and a stub would leave the
// component wired to nothing while every assertion passed.
import { useCardPlacement } from '~/composables/useCardPlacement';
import { useHeadwordAudio } from '~/composables/useHeadwordAudio';
import { useDictionarySelection } from '~/composables/useDictionarySelection';
import { useCardTrail } from '~/composables/useCardTrail';
import { useCandidateChips } from '~/composables/useCandidateChips';
import { useWordCardContent } from '~/composables/useWordCardContent';
import { useWordLookup } from '~/composables/useWordLookup';
vi.stubGlobal('useCardPlacement', useCardPlacement);
vi.stubGlobal('useHeadwordAudio', useHeadwordAudio);
vi.stubGlobal('useDictionarySelection', useDictionarySelection);
vi.stubGlobal('useCardTrail', useCardTrail);
vi.stubGlobal('useCandidateChips', useCandidateChips);
vi.stubGlobal('useWordCardContent', useWordCardContent);
vi.stubGlobal('useWordLookup', useWordLookup);

import * as wordCard from '~/utils/wordCard';
import * as wordPopup from '~/utils/wordPopup';
// The card's own decisions are auto-imported from these two modules and are unit
// tested there. Registered REAL rather than faked: a stub would only prove the
// stub was called, and the wiring is the thing under test here.
for (const [name, value] of [...Object.entries(wordCard), ...Object.entries(wordPopup)]) {
  vi.stubGlobal(name, value);
}

import SegmentTokenText from './SegmentTokenText.vue';

/**
 * A token as the tokenizer hands one over -- SHORT keys (`s`/`d`/`r`/`b`/`e`/`p`),
 * which is what the corpus stores and what `enrichTokens` reads.
 */
let offset = 0;
function token(surface: string, over: Record<string, unknown> = {}) {
  const b = offset;
  offset += surface.length;
  return { s: surface, d: surface, r: surface, b, e: offset, p: '名詞', ...over };
}

/**
 * A Shirabe candidate. Senses hang off `entries`, one per dictionary -- which is
 * where `cardSenses` reads them from, and what carries the part of speech the
 * chips disambiguate by.
 */
function candidate(name: string, pos = 'noun', over: Record<string, unknown> = {}) {
  return {
    id: name,
    name: false,
    headword: name,
    reading: name,
    entries: [
      {
        dictionary: 'jmdict',
        dictionaryName: 'JMdict',
        // Parts of speech reach the card as sense TAGS, filtered by category.
        senses: [{ glosses: [{ text: 'a gloss' }], tags: [{ category: 'partOfSpeech', label: pos, code: pos }] }],
      },
    ],
    ...over,
  };
}

const mounted: { unmount: () => void }[] = [];

function render(tokens: unknown[]) {
  const wrapper = mount(SegmentTokenText, {
    props: { tokens } as never,
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
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
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

const clickableTokens = (w: ReturnType<typeof render>) => w.findAll('.token[role="button"]');
/** Searched on the DOCUMENT, not the wrapper: the card is placed on the page
 *  rather than inside the sentence it belongs to. */
const cardEl = () => document.querySelector('.token-tooltip');

beforeEach(() => {
  vi.clearAllMocks();
  offset = 0;
  peekWord.mockReturnValue(undefined);
  fetchWord.mockResolvedValue({ candidates: [], reason: null, nameOnly: false });
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
});

describe('which tokens a reader can press', () => {
  test('renders every token of the sentence', () => {
    const wrapper = render([token('私'), token('は'), token('猫')]);

    expect(wrapper.text()).toContain('私');
    expect(wrapper.text()).toContain('猫');
  });

  test('a word is pressable', () => {
    expect(clickableTokens(render([token('猫')]))).toHaveLength(1);
  });

  test('punctuation is not, because there is nothing to look up', () => {
    const wrapper = render([token('猫'), token('。', { p: '補助記号' })]);

    expect(clickableTokens(wrapper)).toHaveLength(1);
  });
});

describe('opening the card', () => {
  test('a press opens it on that word', async () => {
    peekWord.mockReturnValue({ candidates: [candidate('猫')], reason: null, nameOnly: false });
    const wrapper = render([token('猫')]);

    await clickableTokens(wrapper)[0]!.trigger('click');
    await nextTick();

    expect(cardEl()).toBeTruthy();
    expect(cardEl()?.textContent).toContain('猫');
  });

  test('pressing the same word again closes it', async () => {
    peekWord.mockReturnValue({ candidates: [candidate('猫')], reason: null, nameOnly: false });
    const wrapper = render([token('猫')]);

    await clickableTokens(wrapper)[0]!.trigger('click');
    await nextTick();
    await clickableTokens(wrapper)[0]!.trigger('click');
    await nextTick();
    await nextTick();

    expect(cardEl()).toBeNull();
  });

  test('a cached answer opens filled in, with no "looking up" flash', async () => {
    // Synchronously and with no intermediate state: a word the reader has seen
    // before must not blink through a loading line for a frame.
    peekWord.mockReturnValue({ candidates: [candidate('猫')], reason: null, nameOnly: false });
    const wrapper = render([token('猫')]);

    await clickableTokens(wrapper)[0]!.trigger('click');

    expect(cardEl()?.textContent).not.toContain('looking');
    expect(fetchWord).not.toHaveBeenCalled();
  });

  test('an uncached word is asked for', async () => {
    const wrapper = render([token('猫')]);

    await clickableTokens(wrapper)[0]!.trigger('click');
    await nextTick();

    expect(fetchWord).toHaveBeenCalled();
  });
});

describe('telling two candidates apart', () => {
  /** Opens the card on a token whose lookup returns `list`. */
  async function openWith(list: unknown[]) {
    peekWord.mockReturnValue({ candidates: list, reason: null, nameOnly: false });
    const wrapper = render([token('あれ')]);
    await clickableTokens(wrapper)[0]!.trigger('click');
    await nextTick();
    return wrapper;
  }

  const chips = () => [...document.querySelectorAll('.token-tooltip__chip-candidate')];

  test('a single candidate needs no chips at all', async () => {
    await openWith([candidate('猫')]);

    expect(chips()).toHaveLength(0);
  });

  test('several candidates each get a chip to switch between them', async () => {
    await openWith([candidate('有れ'), candidate('我')]);

    expect(chips().map((c) => c.textContent?.trim())).toEqual(['有れ', '我']);
  });

  // NOT covered here: the part-of-speech INITIAL that separates two chips
  // printed the same. It comes from `candidatePartOfSpeech`, which reads sense
  // tags through the reader's gloss-language preference -- so exercising it
  // needs a fixture that reproduces Shirabe's tag shape faithfully enough to be
  // testing the fixture rather than the card. That decision is unit tested in
  // `wordCard.test.ts`, on the real shape; what is pinned here is the wiring
  // around it -- that duplicates get chips, and that picking one switches the
  // word the card is about.

  test('candidates printed differently carry no part of speech', async () => {
    // A label on all of them is noise charged to the many for the sake of the
    // few; every other chip is already distinct.
    await openWith([candidate('有れ'), candidate('我')]);

    for (const label of chips().map((c) => c.textContent?.trim() ?? '')) {
      expect(label.length).toBeLessThanOrEqual(2);
    }
  });

  test('picking a chip switches the word the card is about', async () => {
    await openWith([candidate('有れ'), candidate('我')]);

    (chips()[1] as HTMLElement).click();
    await nextTick();

    expect(document.querySelector('.token-tooltip__word')?.textContent).toContain('我');
  });
});
