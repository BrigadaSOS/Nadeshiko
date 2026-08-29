// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect } from 'vitest';

import MediaCountLabel from './MediaCountLabel.vue';

/**
 * The "12 Episodes" / "Videos: 12" / "Movie" label under a media card.
 *
 * Small, but it is three branches over data the catalogue genuinely mixes, and
 * every way it goes wrong is a sentence a reader reads and believes: a film
 * captioned "1 Episodes", a YouTube channel counted in episodes rather than
 * videos, or a series whose count vanishes because the field arrived null.
 *
 * `$t` returns the key, so a copy change never breaks a structural assertion --
 * the same convention `BlogPagination.test.ts` set.
 */
function render(media: Record<string, unknown>, labelFirst = false) {
  return mount(MediaCountLabel, {
    props: { media, labelFirst } as never,
    global: { mocks: { $t: (key: string) => key } },
  });
}

const SERIES = { category: 'ANIME', airingFormat: 'TV', episodeCount: 12 };
const MOVIE = { category: 'ANIME', airingFormat: 'MOVIE', episodeCount: 1 };
const CHANNEL = { category: 'YOUTUBE', airingFormat: 'YOUTUBE', episodeCount: 340 };

describe('a series', () => {
  test('is counted in episodes', () => {
    expect(render(SERIES).text()).toBe('12 animeList.episodes');
  });

  test('puts the label first when the list view asks for it', () => {
    // List view shows "Episodes: 12"; the grid shows "12 Episodes".
    expect(render(SERIES, true).text()).toBe('animeList.episodes: 12');
  });
});

describe('a film', () => {
  test('says Movie rather than counting episodes', () => {
    // "1 Episodes" is both wrong and ungrammatical, and it is what a film gets
    // without this branch.
    expect(render(MOVIE).text()).toBe('searchpage.main.labels.movie');
  });

  test('says Movie in the list view too, where the count would be meaningless', () => {
    expect(render(MOVIE, true).text()).toBe('searchpage.main.labels.movie');
  });
});

describe('a YouTube channel', () => {
  test('is counted in videos, not episodes', () => {
    // A channel does not have episodes, and calling them that reads as a bug to
    // anyone who watches the source.
    expect(render(CHANNEL).text()).toBe('340 animeList.videos');
  });

  test('is never called a movie, whatever airing format it carries', () => {
    // YouTube rows arrive with assorted formats; the category has to win.
    expect(render({ category: 'YOUTUBE', airingFormat: 'MOVIE', episodeCount: 5 }).text()).toBe('5 animeList.videos');
  });

  test('puts the label first when asked', () => {
    expect(render(CHANNEL, true).text()).toBe('animeList.videos: 340');
  });
});

describe('a count that is missing', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['zero', 0],
  ])('renders %s as 0 rather than as nothing', (_name, episodeCount) => {
    // An empty space where a number belongs reads as a broken card; "0
    // Episodes" reads as a title nobody has indexed yet, which is the truth.
    expect(render({ ...SERIES, episodeCount }).text()).toBe('0 animeList.episodes');
  });
});
