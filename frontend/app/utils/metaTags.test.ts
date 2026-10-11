import { describe, expect, test } from 'vitest';
import { buildMediaMetaTags } from './metaTags';
import {
  expectedMediaMeta,
  formatMediaMetaNumber,
  mediaMetaCases,
  mediaMetaI18n,
} from '../../test/media-meta-fixtures';

describe('buildMediaMetaTags', () => {
  test.each(mediaMetaCases)('$label', ({ totalResults, episodeHits, episode, bannerUrl, locale, description }) => {
    mediaMetaI18n.locale.value = locale ?? 'en';
    expect(
      buildMediaMetaTags(
        {
          name: 'Bocchi',
          bannerUrl,
          origin: 'https://nadeshiko.test',
          totalResults,
          episodeHits,
          episode: episode ?? null,
        },
        mediaMetaI18n.t,
        formatMediaMetaNumber,
      ),
    ).toEqual(expectedMediaMeta(description, bannerUrl, locale));
  });
});
