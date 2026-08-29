// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

import { anilistAnimeUrl, imdbTitleUrl, tmdbUrl, youtubeChannelUrl } from '~/utils/media';

/**
 * The title card at the top of `/media/<slug>`.
 *
 * Most of it is filtering: which names to show BESIDE the headline, which facts
 * the payload actually has, which catalogue sites this work exists on. Every one
 * of those fails by rendering a card that looks finished -- an empty bullet, a
 * name printed twice, a link to a site the work is not on -- so none of it
 * announces itself.
 *
 * The real URLs are used rather than stubbed: they are auto-imports with their
 * own tests, and asserting against a fake would only prove the fake was called.
 */
const startsOpen = ref(true);
const language = ref<'ENGLISH' | 'JAPANESE' | 'ROMAJI'>('ENGLISH');

vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }));
vi.stubGlobal('useFormat', () => ({ formatNumber: (n: number) => String(n) }));
vi.stubGlobal('useMediaCardDefault', () => ({ startsOpen }));
vi.stubGlobal('useMediaName', () => ({
  mediaName: (m: Record<string, string>) =>
    language.value === 'JAPANESE'
      ? m.nameJa || m.nameEn || m.nameRomaji || ''
      : language.value === 'ROMAJI'
        ? m.nameRomaji || m.nameEn || m.nameJa || ''
        : m.nameEn || m.nameRomaji || m.nameJa || '',
  language,
}));
vi.stubGlobal('anilistAnimeUrl', anilistAnimeUrl);
vi.stubGlobal('tmdbUrl', tmdbUrl);
vi.stubGlobal('imdbTitleUrl', imdbTitleUrl);
vi.stubGlobal('youtubeChannelUrl', youtubeChannelUrl);

import MediaHeader from './MediaHeader.vue';

function media(over: Record<string, unknown> = {}) {
  return {
    nameEn: 'Bocchi the Rock',
    nameJa: 'ぼっち・ざ・ろっく',
    nameRomaji: 'Bocchi Za Rokku',
    genres: [],
    externalIds: {},
    airingFormat: 'TV',
    ...over,
  };
}

const mounted: { unmount: () => void }[] = [];

function render(over: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  const wrapper = mount(MediaHeader, {
    props: { media: media(over) as never, ...props },
    global: { mocks: { $t: (k: string) => k }, stubs: { UiBaseIcon: true, NuxtLink: true } },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

beforeEach(() => {
  startsOpen.value = true;
  language.value = 'ENGLISH';
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
});

describe('the heading', () => {
  test('is an h1 on the title’s own page', () => {
    expect(render().find('h1').text()).toContain('Bocchi the Rock');
  });

  test('but an h2 where a searched word already owns the h1', () => {
    const wrapper = render({}, { heading: 'h2' });

    expect(wrapper.find('h1').exists()).toBe(false);
    expect(wrapper.find('h2').text()).toContain('Bocchi the Rock');
  });
});

describe('the other names', () => {
  test('carries the names the reader is NOT seeing, for anyone searching by them', () => {
    const text = render().text();

    expect(text).toContain('ぼっち・ざ・ろっく');
    expect(text).toContain('Bocchi Za Rokku');
  });

  test('never repeats the headline back as a secondary name', () => {
    // A work whose romaji and English names are identical printed the same
    // string twice with a separator between them.
    const wrapper = render({ nameEn: 'Frieren', nameRomaji: 'Frieren', nameJa: '' });

    expect(wrapper.text().match(/Frieren/g)).toHaveLength(1);
  });

  test('drops the names the payload does not have', () => {
    // Rather than rendering an empty entry with a separator beside it.
    const wrapper = render({ nameRomaji: '' });

    expect(wrapper.text()).toContain('ぼっち・ざ・ろっく');
    expect(wrapper.text()).not.toContain('Bocchi Za Rokku');
  });

  test('separates two other names, with nothing dangling after the last', () => {
    const wrapper = render();
    const line = wrapper.findAll('p').find((n) => n.text().includes('ぼっち・ざ・ろっく'))!;

    // Two names, so exactly one separator between them.
    expect(line.text().split(' · ')).toHaveLength(2);
  });

  test('follows the reader’s own language preference', () => {
    language.value = 'JAPANESE';
    const wrapper = render();

    expect(wrapper.find('h1').text()).toContain('ぼっち・ざ・ろっく');
    expect(wrapper.text()).toContain('Bocchi the Rock');
  });
});

describe('the season line', () => {
  test('joins the name and the year', () => {
    expect(render({ seasonName: 'Fall', seasonYear: 2022 }).text()).toContain('Fall 2022');
  });

  test('shows a year with no season name', () => {
    expect(render({ seasonYear: 2022 }).text()).toContain('2022');
  });

  test('shows a season name with no year', () => {
    expect(render({ seasonName: 'Fall' }).text()).toContain('Fall');
  });

  test('says nothing at all when the payload has neither', () => {
    expect(render().text()).not.toContain('modalMediaEdit.seasonName');
  });
});

describe('the facts row', () => {
  test('lists only what the payload actually carries', () => {
    const wrapper = render({ studio: 'CloverWorks', airingStatus: 'FINISHED' });

    expect(wrapper.text()).toContain('CloverWorks');
    expect(wrapper.text()).toContain('FINISHED');
    // No studio label for a work with no studio.
    expect(render().text()).not.toContain('modalMediaEdit.studio');
  });
});

describe('the catalogue links', () => {
  test('links to every site the work has an id for', () => {
    const wrapper = render({ externalIds: { anilist: 1, tmdb: 2, imdb: 'tt3', youtube: 'UC4' } });

    for (const id of ['anilist', 'tmdb', 'imdb', 'youtube']) {
      expect(wrapper.find(`[data-testid="media-${id}-link"]`).exists()).toBe(true);
    }
  });

  test('and to none it does not', () => {
    const wrapper = render({ externalIds: { anilist: 1 } });

    expect(wrapper.find('[data-testid="media-anilist-link"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="media-tmdb-link"]').exists()).toBe(false);
  });

  test('sends a film to TMDB’s movie path rather than its series one', () => {
    const wrapper = render({ externalIds: { tmdb: '42' }, airingFormat: 'MOVIE' });

    expect(wrapper.find('[data-testid="media-tmdb-link"]').attributes('href')).toBe(tmdbUrl('42', 'MOVIE'));
  });
});

describe('opening and closing', () => {
  test('starts from the reader’s setting', () => {
    startsOpen.value = false;
    const wrapper = render();

    expect(wrapper.find('[data-testid="media-header-toggle"]').attributes('aria-expanded')).toBe('false');
  });

  test('the chevron toggles it', async () => {
    const wrapper = render();

    await wrapper.find('[data-testid="media-header-toggle"]').trigger('click');

    expect(wrapper.find('[data-testid="media-header-toggle"]').attributes('aria-expanded')).toBe('false');
  });

  test('changing the setting on another page updates a card already mounted', async () => {
    // The settings page is a route away and coming back does not remount this.
    const wrapper = render();
    startsOpen.value = false;
    await nextTick();

    expect(wrapper.find('[data-testid="media-header-toggle"]').attributes('aria-expanded')).toBe('false');
  });

  test('the whole card is the target, not only the chevron', async () => {
    const wrapper = render();

    await wrapper.find('[data-testid="media-header"]').trigger('click');

    expect(wrapper.find('[data-testid="media-header-toggle"]').attributes('aria-expanded')).toBe('false');
  });

  test('but a catalogue link is a navigation, not a toggle', async () => {
    const wrapper = render({ externalIds: { anilist: 1 } });

    await wrapper.find('[data-testid="media-anilist-link"]').trigger('click');

    expect(wrapper.find('[data-testid="media-header-toggle"]').attributes('aria-expanded')).toBe('true');
  });

  test('the details stay in the markup when closed, so the page still says them', () => {
    // Hidden by a collapsed grid row rather than `v-if`: one reader closing
    // their card must not change what the page says about the work.
    startsOpen.value = false;
    const wrapper = render({ studio: 'CloverWorks' });

    expect(wrapper.text()).toContain('CloverWorks');
  });
});

describe('the details id', () => {
  test('is unique per card, so a chevron controls its OWN details', async () => {
    // Two cards in ONE app: `useId` counts per app instance, so two separate
    // mounts would hand both the same id and this would pass while broken.
    const Parent = defineComponent({
      components: { MediaHeader },
      template: `<div><MediaHeader :media="m" heading="h2" /><MediaHeader :media="m" heading="h2" /></div>`,
      setup: () => ({ m: media() }),
    });
    const wrapper = mount(Parent, {
      global: { mocks: { $t: (k: string) => k }, stubs: { UiBaseIcon: true, NuxtLink: true } },
      attachTo: document.body,
    });
    mounted.push(wrapper);

    const ids = wrapper.findAll('[data-testid="media-header-toggle"]').map((b) => b.attributes('aria-controls'));
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });
});
