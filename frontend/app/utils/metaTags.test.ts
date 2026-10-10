import { describe, expect, test } from 'vitest';
import { buildMediaMetaTags } from './metaTags';
import {
  expectedMediaMeta,
  formatMediaMetaNumber,
  mediaMetaCases,
  mediaMetaI18n,
} from '../../test/media-meta-fixtures';

describe('buildMediaMetaTags', () => {
  test.each(mediaMetaCases)('$label', ({ stats, episode, bannerUrl, locale, description }) => {
    mediaMetaI18n.locale.value = locale ?? 'en';
    const parsed = episode === undefined ? null : Number(episode);
    expect(
      buildMediaMetaTags(
        {
          name: 'Bocchi',
          bannerUrl,
          origin: 'https://nadeshiko.test',
          totalResults: stats?.matchCount ?? 0,
          episodeHits: stats?.episodeHits,
          episode: parsed !== null && Number.isNaN(parsed) ? null : parsed,
        },
        mediaMetaI18n.t,
        formatMediaMetaNumber,
      ),
    ).toEqual(expectedMediaMeta(description, bannerUrl, locale));
  });
});
