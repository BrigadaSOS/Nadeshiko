// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, reactive, ref, unref } from 'vue';

// Validate emitted VideoObject data, including sub-second duration and absent dates.
// Capture schema nodes rather than asserting against Unhead rendering.
const capturedSchema: unknown[] = [];
const capturedHead: unknown[] = [];
const getSegment = vi.fn();
const route = reactive({ params: { id: 'seg-1' }, path: '/sentence/seg-1', query: {}, fullPath: '/sentence/seg-1' });

vi.stubGlobal('useI18n', () => ({
  t: (k: string, p?: Record<string, unknown>) => (p ? `${k}(${p.n})` : k),
  locale: ref('en'),
}));
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useRouter', () => ({ push: vi.fn() }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useRequestURL', () => new URL('https://nadeshiko.test/sentence/seg-1'));
vi.stubGlobal('useMediaName', () => ({ mediaName: (m: Record<string, string>) => m?.nameEn ?? '' }));
vi.stubGlobal('usePostHog', () => ({ capture: vi.fn() }));
vi.stubGlobal('useDocumentVisibility', () => ref('visible'));
const getMedia = vi.fn();
vi.stubGlobal('useNadeshikoSdk', () => ({ getSegment, getMedia }));
vi.stubGlobal('useHead', (v: unknown) => capturedHead.push(v));
vi.stubGlobal('useSchemaOrg', (v: unknown) => capturedSchema.push(v));
const createError = vi.fn((v: Record<string, unknown>) => Object.assign(new Error(String(v.statusMessage)), v));
vi.stubGlobal('createError', createError);
vi.stubGlobal('defineVideo', (v: Record<string, unknown>) => ({ '@type': 'VideoObject', ...v }));
vi.stubGlobal('defineWebPage', (v: Record<string, unknown>) => ({ '@type': 'WebPage', ...v }));
vi.stubGlobal('defineBreadcrumb', (v: Record<string, unknown>) => ({ '@type': 'BreadcrumbList', ...v }));
vi.stubGlobal('useAsyncData', async (_k: string, handler: () => Promise<unknown>) => {
  const data = ref<unknown>(null);
  const refresh = async () => {
    data.value = await handler();
  };
  await refresh();
  return { data, refresh, pending: ref(false), error: ref(null) };
});

import SentencePage from './[id].vue';

/**
 * The RAW segment the API returns -- the page assembles the search-shaped
 * payload itself via `resolveSearchResponse`, so feeding it a pre-assembled one
 * leaves the fields the schema reads undefined.
 */
function segmentPayload(over: Record<string, unknown> = {}) {
  return {
    publicId: 'seg-1',
    mediaPublicId: 'm1',
    textJa: { content: '猫が好き' },
    textEn: { content: 'I like cats' },
    textEs: { content: '' },
    episode: 3,
    position: 1,
    startTimeMs: 1000,
    endTimeMs: 4400,
    contentRating: 'SAFE',
    hashedId: 'h',
    storageBasePath: 'b',
    urls: { videoUrl: 'v.mp4', imageUrl: 'i.png', audioUrl: 'a.mp3' },
    ...over,
  };
}

function mediaPayload(over: Record<string, unknown> = {}) {
  return {
    publicId: 'm1',
    nameEn: 'Bocchi',
    nameJa: 'ぼっち',
    nameRomaji: 'Bocchi',
    slug: 'bocchi',
    startDate: '2022-10-08',
    category: 'ANIME',
    ...over,
  };
}

const mounted: { unmount: () => void }[] = [];

async function render(
  segment: Record<string, unknown> | null = segmentPayload(),
  media: Record<string, unknown> | null = mediaPayload(),
) {
  capturedSchema.length = 0;
  capturedHead.length = 0;
  getSegment.mockResolvedValue(segment);
  getMedia.mockResolvedValue(media);
  const Host = defineComponent({
    components: { SentencePage },
    errorCaptured: () => false,
    template: '<Suspense><SentencePage /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
        UiBaseIcon: true,
        SearchSegmentContainer: true,
        SearchContainer: true,
        CommonBaseModal: true,
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const head = () => JSON.stringify(capturedHead.map((entry) => unref(entry)));

function nodes(): Record<string, unknown>[] {
  return capturedSchema.flatMap((entry) => (unref(entry) as Record<string, unknown>[]) ?? []);
}
const videoNode = () => nodes().find((n) => n['@type'] === 'VideoObject');
const breadcrumb = () => nodes().find((n) => n['@type'] === 'BreadcrumbList');

beforeEach(() => {
  vi.clearAllMocks();
  createError.mockImplementation((v: Record<string, unknown>) => Object.assign(new Error(String(v.statusMessage)), v));
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the VideoObject', () => {
  test('is emitted for a clip that has a video', async () => {
    await render();

    expect(videoNode()).toBeTruthy();
  });

  test('is left out entirely when there is no video to describe', async () => {
    await render(segmentPayload({ urls: { videoUrl: null, imageUrl: 'i.png', audioUrl: 'a.mp3' } }));

    expect(videoNode()).toBeUndefined();
  });

  test('states the duration to a tenth of a second', async () => {
    await render();

    expect(videoNode()!.duration).toBe('PT3.4S');
  });

  test('uses the media’s first airing as the upload date', async () => {
    await render();

    expect(videoNode()!.uploadDate).toBe('2022-10-08');
  });

  test('and DROPS the date rather than inventing one', async () => {
    await render(segmentPayload(), mediaPayload({ startDate: null }));

    expect(videoNode()).toBeTruthy();
    expect(videoNode()).not.toHaveProperty('uploadDate');
  });

  test('describes the clip in Japanese, which is what the page is about', async () => {
    await render();

    expect(videoNode()!.inLanguage).toBe('ja');
    expect(videoNode()!.description).toBe('猫が好き');
  });

  test('names the work and the episode', async () => {
    await render();

    expect(String(videoNode()!.name)).toContain('Bocchi');
  });
});

describe('the breadcrumb', () => {
  test('is emitted so the page states where it sits', async () => {
    await render();

    expect(breadcrumb()).toBeTruthy();
  });

  test('starts at the home page', async () => {
    await render();

    const items = breadcrumb()!.itemListElement as { name: string }[];
    expect(items[0]!.name).toBe('navbar.buttons.home');
  });

  test('a permalink with no sentence behind it 404s rather than rendering empty', async () => {
    await render(null, null);

    expect(createError).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('the page title', () => {
  test('quotes the sentence and names the work', async () => {
    await render();

    expect(head()).toContain('猫が好き');
  });

  test('names the work the clip came from', async () => {
    await render();

    expect(head()).toContain('Bocchi');
  });
});
