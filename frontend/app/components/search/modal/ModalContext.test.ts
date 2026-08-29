// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, ref } from 'vue';

/**
 * "Show context": the lines either side of a sentence.
 *
 * The body renders nothing at all when there is no context data, so a FAILED
 * fetch and a segment that genuinely has no neighbours look identical -- an
 * empty modal, with no way for the reader to tell whether to try again. The
 * error state is the only thing separating them.
 *
 * The request also has to ask for `media` explicitly: without it the API omits
 * the includes block, every card resolves to an empty media, and the header
 * reads "Context - " with nothing after it.
 *
 * The modal is reused across cards, so opening it on a second sentence must
 * clear the first one's lines rather than show them under the new heading.
 */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k: string) => k, locale: ref('en') }) }));

const getSegmentContext = vi.fn();
vi.stubGlobal('useNadeshikoSdk', () => ({ getSegmentContext }));
vi.stubGlobal('useMediaName', () => ({
  mediaName: (m: Record<string, string>) => m?.nameEn ?? '',
  language: ref('ENGLISH'),
}));
vi.stubGlobal('useContentRating', () => ({
  contentRating: ref('SAFE'),
  shouldBlur: () => false,
  isRestricted: () => false,
}));

import ModalContext from './ModalContext.vue';

const result = (position: number) => ({
  segment: {
    publicId: `s${position}`,
    position,
    textJa: { content: `line ${position}` },
    textEn: { content: '' },
    textEs: { content: '' },
    episode: 1,
    startTimeMs: 0,
    endTimeMs: 1000,
    urls: { audioUrl: 'a.mp3', imageUrl: 'i.png', videoUrl: null },
  },
  media: { publicId: 'm1', nameEn: 'Bocchi', slug: 'bocchi', category: 'ANIME' },
});

/** The raw context payload, as the API returns it. */
const payload = (positions: number[]) => ({
  segments: positions.map((p) => result(p).segment),
  includes: { media: { m1: { publicId: 'm1', nameEn: 'Bocchi' } } },
});

const mounted: { unmount: () => void }[] = [];

async function render(sentence: ReturnType<typeof result> | null = null) {
  const wrapper = mount(ModalContext, {
    props: { sentence: null } as never,
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        CommonBaseModal: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
        SearchSegmentContainer: {
          props: ['searchData'],
          template: '<div data-testid="context-list">{{ (searchData?.results ?? []).length }}</div>',
        },
        UiBaseIcon: true,
      },
    },
  });
  mounted.push(wrapper);
  if (sentence) {
    await wrapper.setProps({ sentence: sentence as never });
    await flushPromises();
  }
  return wrapper;
}

const lineCount = (w: ReturnType<typeof mount>) => {
  const el = w.find('[data-testid="context-list"]');
  return el.exists() ? Number(el.text()) : null;
};
const errored = (w: ReturnType<typeof mount>) => w.find('[data-testid="context-modal-error"]').exists();

beforeEach(() => {
  vi.clearAllMocks();
  getSegmentContext.mockResolvedValue(payload([1, 2, 3]));
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('fetching the context', () => {
  test('asks for the segment the modal was opened on', async () => {
    await render(result(2));

    expect(getSegmentContext).toHaveBeenCalledWith(expect.objectContaining({ segmentPublicId: 's2' }));
  });

  test('asks for the MEDIA block explicitly', async () => {
    // Without it every card resolves to an empty media and the header reads
    // "Context - " with nothing after it.
    await render(result(2));

    expect(getSegmentContext.mock.calls[0]![0].include).toContain('media');
  });

  test('passes the reader’s content rating through', async () => {
    await render(result(2));

    expect(getSegmentContext.mock.calls[0]![0].contentRating).toBe('SAFE');
  });

  test('does not fetch until a sentence arrives', async () => {
    await render(null);

    expect(getSegmentContext).not.toHaveBeenCalled();
  });

  test('renders the lines it came back with', async () => {
    const wrapper = await render(result(2));

    expect(lineCount(wrapper)).toBe(3);
  });
});

describe('telling an empty context from a broken one', () => {
  test('a FAILED fetch says so', async () => {
    // The body renders nothing either way, so without this the reader cannot
    // tell whether trying again would help.
    getSegmentContext.mockRejectedValue(new Error('down'));
    const wrapper = await render(result(2));

    expect(errored(wrapper)).toBe(true);
    expect(handleApiError).toHaveBeenCalledWith(
      'search:segment-context-failed',
      expect.anything(),
      expect.objectContaining({ toastKey: false }),
    );
  });

  test('a segment with genuinely no neighbours does NOT', async () => {
    getSegmentContext.mockResolvedValue(payload([]));
    const wrapper = await render(result(2));

    expect(errored(wrapper)).toBe(false);
  });

  test('and the error clears when another sentence loads', async () => {
    getSegmentContext.mockRejectedValue(new Error('down'));
    const wrapper = await render(result(2));
    expect(errored(wrapper)).toBe(true);

    getSegmentContext.mockResolvedValue(payload([4, 5]));
    await wrapper.setProps({ sentence: result(4) as never });
    await flushPromises();

    expect(errored(wrapper)).toBe(false);
    expect(lineCount(wrapper)).toBe(2);
  });
});

describe('reopening on another sentence', () => {
  test('does not show the previous one’s lines under the new heading', async () => {
    // The modal stays mounted as the reader moves between cards.
    const wrapper = await render(result(2));
    expect(lineCount(wrapper)).toBe(3);

    let release!: (v: unknown) => void;
    getSegmentContext.mockReturnValue(new Promise((r) => (release = r)));
    await wrapper.setProps({ sentence: result(9) as never });
    await nextTick();

    expect(lineCount(wrapper)).toBeNull();
    release(payload([9]));
    await flushPromises();
    expect(lineCount(wrapper)).toBe(1);
  });

  test('ignores a second sentence while one is still loading', async () => {
    let release!: (v: unknown) => void;
    getSegmentContext.mockReturnValue(new Promise((r) => (release = r)));
    const wrapper = await render();
    await wrapper.setProps({ sentence: result(2) as never });
    await nextTick();

    await wrapper.setProps({ sentence: result(3) as never });
    await nextTick();
    release(payload([2]));
    await flushPromises();

    expect(getSegmentContext).toHaveBeenCalledTimes(1);
  });
});
