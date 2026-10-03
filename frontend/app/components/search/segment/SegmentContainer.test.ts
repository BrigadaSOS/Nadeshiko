// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';
import { storeToRefs } from 'pinia';
import { formatMs } from '~/utils/misc';
import { youtubeWatchUrl } from '~/utils/media';
import { PATREON_URL } from '#shared/utils/socialLinks';

/**
 * The result cards: the list a search actually produces.
 *
 * The behaviour pinned here is the SPOILER reveal on translations. It is keyed
 * per card AND per language, and both halves matter: keyed on the language
 * alone, revealing one card's English uncovers every other card's on the page,
 * which for a reader working through a page of sentences destroys the exercise
 * they came for -- silently, and in the one direction that cannot be undone.
 *
 * Which rows exist at all is a second decision, taken from the account's
 * language order and the search's per-language visibility, and "hidden" has to
 * mean absent rather than blurred.
 */
const englishMode = ref('visible');
const spanishMode = ref('visible');
const translationLanguages = ref(['EN', 'ES']);

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useTranslationVisibility', () => ({ englishMode, spanishMode }));
vi.stubGlobal('useTranslationLanguages', () => ({ languages: translationLanguages }));
vi.stubGlobal('useMediaName', () => ({ mediaName: (m: Record<string, string>) => m.nameEn ?? '' }));
vi.stubGlobal('useContentRating', () => ({ shouldBlur: () => false, isRestricted: () => false }));
vi.stubGlobal('useHiddenMedia', () => ({ isMediaHidden: () => false, hiddenMediaIds: ref(new Set()) }));
vi.stubGlobal('useModalState', () => ({
  isAnyModalOpen: ref(false),
  registerModal: vi.fn(),
  unregisterModal: vi.fn(),
  isTopModal: () => true,
}));
vi.stubGlobal('useMotionPreference', () => ({ scrollBehavior: ref('smooth'), prefersReducedMotion: ref(false) }));
vi.stubGlobal('useSegmentConcatenation', () => ({
  revertActiveConcatenation: vi.fn(),
  concatenatedResult: ref(null),
  isConcatenated: () => false,
  isConcatenating: ref(false),
  loadNextSegment: vi.fn(),
}));
vi.stubGlobal('useYoutubeSegmentPlayer', () => ({
  activeSegmentId: ref(null),
  clipProgress: ref(0),
  hostId: ref('yt-host'),
  preload: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  restart: vi.fn(),
  retimeClip: vi.fn(),
  seekToClipFraction: vi.fn(),
  setVolume: vi.fn(),
  setPlaybackRate: vi.fn(),
  stop: vi.fn(),
}));
vi.stubGlobal('useLocalePath', () => (p: unknown) => (typeof p === 'string' ? p : JSON.stringify(p)));
vi.stubGlobal('useRoute', () => ({ params: {}, query: {} }));
vi.stubGlobal('useRouter', () => ({ push: vi.fn() }));
vi.stubGlobal('usePostHog', () => ({ capture: vi.fn() }));
vi.stubGlobal('useNadeshikoSdk', () => ({}));

// The REAL `storeToRefs`, because `usePlayerStore`, `userStore` and `ankiStore`
// are imported directly rather than auto-imported -- a `stubGlobal` for them
// never applies, the genuine Pinia stores are used (the suite activates a fresh
// Pinia per test), and a fake `storeToRefs` hands back plain values where the
// component expects refs.
vi.stubGlobal('storeToRefs', storeToRefs);

import SegmentContainer from './SegmentContainer.vue';

function segment(publicId: string, over: Record<string, unknown> = {}) {
  return {
    segment: {
      publicId,
      textJa: { content: `日本語 ${publicId}`, highlight: null },
      textEn: { content: `english ${publicId}` },
      textEs: { content: `espanol ${publicId}` },
      episode: 1,
      startTimeMs: 0,
      endTimeMs: 1000,
      urls: { imageUrl: 'i.png', audioUrl: 'a.mp3', videoUrl: null },
      ...(over.segment as Record<string, unknown>),
    },
    media: { publicId: 'm1', nameEn: 'Bocchi', slug: 'bocchi', category: 'ANIME' },
    ...over,
  };
}

const mounted: { unmount: () => void }[] = [];

function render(results: unknown[], props: Record<string, unknown> = {}) {
  const wrapper = mount(SegmentContainer, {
    props: { searchData: { results } as never, isLoading: false, ...props },
    global: {
      // Template auto-imports go in `mocks`, NOT `stubGlobal`: the compiled
      // render resolves them as `_ctx.formatMs`, through the component
      // instance, so a global is never consulted and the failure is a
      // render-time TypeError. Real implementations rather than fakes.
      mocks: { $t: (k: string) => k, formatMs, youtubeWatchUrl },
      stubs: {
        'i18n-t': { props: ['keypath'], template: '<span>{{ keypath }}<slot name="link" /></span>' },
        CommonBaseModal: true,
        UiBaseIcon: true,
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
        NuxtImg: true,
        SearchSegmentTokenText: { props: ['result'], template: '<span>{{ result?.segment?.textJa?.content }}</span>' },
        SearchSegmentActionsContainer: true,
        SearchModalSegmentEdit: true,
        SearchModalReport: true,
        SearchModalAnkiNotes: true,
        SearchSegmentAudioButton: true,
      },
      config: { warnHandler: () => {} },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

const cards = (w: ReturnType<typeof render>) => w.findAll('[data-testid="segment-card"]');
/** The clickable wrapper around each translation -- the badge beside it is a
 *  label with no handler. */
const revealTargets = (w: ReturnType<typeof render>) => w.findAll('[data-testid="translation-text"] > span');
/** Whether each translation on the page is still covered. */
const covered = (w: ReturnType<typeof render>) =>
  w.findAll('[data-testid="translation-content"]').map((n) => n.classes().includes('nd-translation-spoiler'));

beforeEach(() => {
  englishMode.value = 'visible';
  spanishMode.value = 'visible';
  translationLanguages.value = ['EN', 'ES'];
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the card list', () => {
  test('renders one card per result', () => {
    expect(cards(render([segment('a'), segment('b')]))).toHaveLength(2);
  });

  test('an empty payload renders no cards rather than failing', () => {
    expect(cards(render([]))).toHaveLength(0);
  });

  test('shows the Japanese each card was found by', () => {
    expect(
      render([segment('a')])
        .get('[data-testid="segment-japanese-text"]')
        .text(),
    ).toContain('日本語 a');
  });

  test('renders corpus markup as text while preserving search highlights', () => {
    const wrapper = render([
      segment('a', {
        segment: {
          publicId: 'a',
          textJa: { content: '<img src=x onerror=alert(1)>', highlight: '<em>日本語</em><script>alert(1)</script>' },
          textEn: { content: '<img src=x onerror=alert(1)>', highlight: '<span class="highlight-tail">English</span>' },
          textEs: { content: 'espanol a' },
          episode: 1,
          startTimeMs: 0,
          endTimeMs: 1000,
          urls: { imageUrl: 'i.png', audioUrl: 'a.mp3', videoUrl: null },
        },
      }),
    ]);

    expect(wrapper.find('[data-testid="segment-japanese-text"]').html()).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(wrapper.find('[data-testid="segment-japanese-text"] em').text()).toBe('日本語');
    expect(wrapper.find('[data-testid="translation-content"] .highlight-tail').text()).toBe('English');
    expect(wrapper.find('[data-testid="segment-japanese-text"] img').exists()).toBe(false);
  });

  test('does not treat raw Japanese or translations as highlighter HTML', () => {
    const wrapper = render([
      segment('a', {
        segment: {
          publicId: 'a',
          textJa: { content: '<em>raw Japanese</em>' },
          textEn: { content: '<img src=x onerror=alert(1)>raw English' },
          textEs: { content: 'espanol a' },
          episode: 1,
          startTimeMs: 0,
          endTimeMs: 1000,
          urls: { imageUrl: 'i.png', audioUrl: 'a.mp3', videoUrl: null },
        },
      }),
    ]);

    const japanese = wrapper.find('[data-testid="segment-japanese-text"]');
    const translation = wrapper.find('[data-testid="translation-content"]');
    expect(japanese.html()).toContain('&lt;em&gt;raw Japanese&lt;/em&gt;');
    expect(japanese.find('em').exists()).toBe(false);
    expect(translation.html()).toContain('&lt;img src=x onerror=alert(1)&gt;raw English');
    expect(translation.find('img').exists()).toBe(false);
  });
});

describe('which translation rows exist', () => {
  test('both, in the account’s order', () => {
    const wrapper = render([segment('a')]);

    expect(wrapper.findAll('[data-testid^="translation-row-"]').map((r) => r.attributes('data-testid'))).toEqual([
      'translation-row-EN',
      'translation-row-ES',
    ]);
  });

  test('follows the account’s language order, not a fixed one', () => {
    translationLanguages.value = ['ES', 'EN'];
    const wrapper = render([segment('a')]);

    expect(wrapper.findAll('[data-testid^="translation-row-"]').map((r) => r.attributes('data-testid'))).toEqual([
      'translation-row-ES',
      'translation-row-EN',
    ]);
  });

  test('a HIDDEN language is absent, not merely blurred', () => {
    // Blurred still ships the text to the page, where it is one selection away;
    // a reader who turned a language off wants it gone.
    spanishMode.value = 'hidden';
    const wrapper = render([segment('a')]);

    expect(wrapper.find('[data-testid="translation-row-ES"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="translation-row-EN"]').exists()).toBe(true);
  });
});

describe('the spoiler reveal', () => {
  beforeEach(() => {
    englishMode.value = 'spoiler';
    spanishMode.value = 'hidden';
  });

  test('starts covered', () => {
    expect(covered(render([segment('a')]))).toEqual([true]);
  });

  test('a click reveals that card’s translation', async () => {
    const wrapper = render([segment('a')]);

    await revealTargets(wrapper)[0]!.trigger('click');

    expect(covered(wrapper)).toEqual([false]);
  });

  test('and reveals ONLY that card, not every card on the page', async () => {
    // Keyed per card as well as per language. Keyed on the language alone, one
    // click uncovers the whole page and the reader's exercise is over -- in the
    // one direction that cannot be undone.
    const wrapper = render([segment('a'), segment('b'), segment('c')]);

    await revealTargets(wrapper)[0]!.trigger('click');

    expect(covered(wrapper)).toEqual([false, true, true]);
  });

  test('clicking again covers it back up', async () => {
    const wrapper = render([segment('a')]);

    await revealTargets(wrapper)[0]!.trigger('click');
    await revealTargets(wrapper)[0]!.trigger('click');

    expect(covered(wrapper)).toEqual([true]);
  });

  test('revealing English leaves Spanish covered on the same card', async () => {
    // Keyed per language as well as per card, which is the other half.
    spanishMode.value = 'spoiler';
    const wrapper = render([segment('a')]);

    await revealTargets(wrapper)[0]!.trigger('click');

    expect(covered(wrapper)).toEqual([false, true]);
  });

  test('a visible translation is not clickable at all', async () => {
    englishMode.value = 'visible';
    const wrapper = render([segment('a')]);

    await revealTargets(wrapper)[0]!.trigger('click');

    expect(covered(wrapper)).toEqual([false]);
  });
});

describe('the existing no-results view', () => {
  test('keeps the original view and copy exactly for missing content', () => {
    const original = render([]);
    const missing = render([], { failure: { kind: 'not-found' } });
    const originalView = original.get('section').element.cloneNode(true) as HTMLElement;
    const missingView = missing.get('section').element.cloneNode(true) as HTMLElement;
    missingView.removeAttribute('role');
    missingView.removeAttribute('data-testid');
    expect(missingView.outerHTML).toBe(originalView.outerHTML);
    expect(missing.get('h1').text()).toBe('searchpage.main.labels.noresults');
    expect(missing.find('a[href="https://www.immersionkit.com"]').exists()).toBe(true);
    expect(missing.find(`a[href="${PATREON_URL}"]`).exists()).toBe(true);
  });

  test.each([
    ['invalid-request', 'invalidRequest'],
    ['rate-limited', 'rateLimited'],
    ['quota-exceeded', 'quotaExceeded'],
    ['unavailable', 'unavailable'],
  ])('uses the new %s text without dropping Haruhi or Patreon', (kind, key) => {
    const wrapper = render([], { failure: { kind } });
    const view = wrapper.get('[data-testid="search-failure-notice"]');
    expect(view.attributes('class')).toBe('w-full py-10');
    expect(view.get('img').attributes('src')).toBe('/assets/no-results.gif');
    expect(view.get('img').element.parentElement?.className).toBe(
      'flex flex-col items-center max-w-lg mx-auto text-center',
    );
    expect(view.get('h1').attributes('class')).toBe('text-2xl font-semibold text-gray-800 dark:text-white md:text-3xl');
    expect(view.get('h1').text()).toBe(`searchErrors.${key}.title`);
    expect(view.get('p').text()).toBe(`searchErrors.${key}.message`);
    expect(view.find(`a[href="${PATREON_URL}"]`).exists()).toBe(true);
    expect(view.find('h2').exists()).toBe(false);
  });

  test('keeps the existing failure view while retrying, rather than showing a loading skeleton', () => {
    const wrapper = render([], { failure: { kind: 'unavailable' }, isLoading: true });
    expect(wrapper.get('[data-testid="search-failure-notice"] img').attributes('src')).toBe('/assets/no-results.gif');
    expect(wrapper.find(`a[href="${PATREON_URL}"]`).exists()).toBe(true);
  });

  test('does not render raw API details in the existing view', () => {
    const wrapper = render([], {
      failure: { kind: 'invalid-request', detail: 'SQL secret-token <script>alert(1)</script>' },
    });
    expect(wrapper.text()).not.toContain('SQL');
    expect(wrapper.text()).not.toContain('secret-token');
    expect(wrapper.find('script').exists()).toBe(false);
  });
});
