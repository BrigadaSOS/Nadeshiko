// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

/**
 * The home page.
 *
 * The example searches are language-aware on purpose: showing an English and a
 * Spanish example to a reader already on one of those was a hint that the OTHER
 * language is searchable, which nobody needs on the page they landed on in their
 * own. Japanese is not one of the two, so its copy still offers both.
 *
 * The Discord install link is the only step of that funnel on our side, and
 * `autocapture` is off -- so without an explicit event, a visitor who clicked and
 * did not finish and a visitor who never clicked are the same absence, and they
 * call for opposite fixes.
 */
const capture = vi.fn();
const locale = ref('en');
const recentMedia = ref<Record<string, unknown> | null>({ media: [] });

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale }));
vi.stubGlobal('useSiteConfig', () => ({ url: 'https://nadeshiko.test' }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useFormat', () => ({ formatNumber: (n: number) => String(n) }));
vi.stubGlobal('useRuntimeConfig', () => ({ public: { discordInstallUrl: 'https://discord.test/install' } }));
vi.stubGlobal('useMediaName', () => ({
  mediaName: (m: Record<string, string>) => m?.nameEn ?? '',
  language: ref('ENGLISH'),
}));
vi.stubGlobal('usePostHog', () => ({ capture }));
vi.stubGlobal('useRequestURL', () => new URL('https://nadeshiko.test/'));
vi.stubGlobal('useSeoMeta', vi.fn());
vi.stubGlobal('useHead', vi.fn());
vi.stubGlobal('useSchemaOrg', vi.fn());
vi.stubGlobal('defineWebPage', (v: unknown) => v);
vi.stubGlobal('defineWebSite', (v: unknown) => v);
vi.stubGlobal('defineOrganization', (v: unknown) => v);
vi.stubGlobal('defineSearchAction', (v: unknown) => v);
vi.stubGlobal('useFetch', async () => ({
  data: recentMedia,
  pending: ref(false),
  error: ref(null),
  refresh: vi.fn(),
}));

import HomePage from './index.vue';

const media = (id: string) => ({ publicId: id, nameEn: id, slug: id, category: 'ANIME', episodeCount: 12 });

const mounted: { unmount: () => void }[] = [];

async function render() {
  const Host = defineComponent({
    components: { HomePage },
    template: '<Suspense><HomePage /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        NuxtImg: true,
        UiBaseIcon: true,
        MediaCountLabel: true,
        SearchBaseInputSegment: true,
        CommonBaseModal: true,
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const cards = (w: ReturnType<typeof mount>) => w.findAll('[data-testid="media-card"]');

beforeEach(() => {
  vi.clearAllMocks();
  locale.value = 'en';
  recentMedia.value = { media: [] };
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the example searches', () => {
  test('an English reader is offered only the English one', async () => {
    // Offering the Spanish example too hints that Spanish is searchable, which
    // nobody needs on the page they landed on in their own language.
    locale.value = 'en';
    const wrapper = await render();

    expect(wrapper.text()).toContain('School');
    expect(wrapper.text()).not.toContain('Escuela');
  });

  test('and a Spanish reader only the Spanish one', async () => {
    locale.value = 'es';
    const wrapper = await render();

    expect(wrapper.text()).toContain('Escuela');
    expect(wrapper.text()).not.toContain('School');
  });

  test('but a Japanese reader gets both, being on neither', async () => {
    locale.value = 'ja';
    const wrapper = await render();

    expect(wrapper.text()).toContain('School');
    expect(wrapper.text()).toContain('Escuela');
  });
});

describe('the recently added grid', () => {
  test('shows what the feed came back with', async () => {
    recentMedia.value = { media: [media('a'), media('b')] };

    expect(cards(await render())).toHaveLength(2);
  });

  test('an empty feed renders no cards rather than failing', async () => {
    recentMedia.value = { media: [] };

    expect(cards(await render())).toHaveLength(0);
  });

  test('and a feed that did not load at all still renders the page', async () => {
    // The grid is one section; a failed feed must not take the home page down.
    recentMedia.value = null;

    const wrapper = await render();
    expect(cards(wrapper)).toHaveLength(0);
    expect(wrapper.find('[data-testid="stats-section"]').exists()).toBe(true);
  });
});

describe('the Discord install link', () => {
  test('records the click, because autocapture would not', async () => {
    // Otherwise "clicked and did not finish" and "never clicked" are the same
    // absence, and they call for opposite fixes.
    const wrapper = await render();
    const link = wrapper.findAll('a').find((a) => (a.attributes('href') ?? '').includes('discord'));
    if (!link) throw new Error('no Discord install link');

    await link.trigger('click');

    expect(capture).toHaveBeenCalledWith('discord_bot_install_clicked', expect.objectContaining({ locale: 'en' }));
  });

  test('and reports which language the copy was in', async () => {
    // The link sits in a features list whose position differs by how long the
    // surrounding text runs.
    locale.value = 'es';
    const wrapper = await render();
    const link = wrapper.findAll('a').find((a) => (a.attributes('href') ?? '').includes('discord'));

    await link!.trigger('click');

    expect(capture).toHaveBeenCalledWith('discord_bot_install_clicked', expect.objectContaining({ locale: 'es' }));
  });

  test('names the surface, so the same event can be fired elsewhere later', async () => {
    const wrapper = await render();
    const link = wrapper.findAll('a').find((a) => (a.attributes('href') ?? '').includes('discord'));

    await link!.trigger('click');

    expect(capture.mock.calls[0]![1]).toHaveProperty('surface', 'home_key_features');
  });
});
