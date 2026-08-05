import type { t_Media, t_MediaSummary, t_ExternalId } from 'generated/models';
import type { Media } from '@app/models';
import type { MediaExternalId } from '@app/models/MediaExternalId';
import { getMediaCoverUrl, getMediaBannerUrl } from '@lib/utils/storage';

const toExternalIdsMap = (externalIds?: MediaExternalId[]): t_ExternalId => {
  const map: t_ExternalId = {
    anilist: null,
    imdb: null,
    tmdb: null,
    tvdb: null,
    youtube: null,
  };
  for (const ext of externalIds ?? []) {
    const key = ext.source.toLowerCase() as keyof t_ExternalId;
    map[key] = ext.externalId;
  }
  return map;
};

export const toMediaSummaryDTO = (media: Media): t_MediaSummary => ({
  publicId: media.publicId,
  slug: media.slug,
  nameJa: media.nameJa,
  nameRomaji: media.nameRomaji,
  nameEn: media.nameEn,
  coverUrl: getMediaCoverUrl(media),
  category: media.category as t_MediaSummary['category'],
});

const toDateString = (date: Date | string): string => {
  if (typeof date === 'string') return date;
  return date.toISOString().slice(0, 10);
};

export const toMediaBaseDTO = (media: Media): t_Media => ({
  publicId: media.publicId,
  slug: media.slug,
  externalIds: toExternalIdsMap(media.externalIds),
  nameJa: media.nameJa,
  nameRomaji: media.nameRomaji,
  nameEn: media.nameEn,
  airingFormat: media.airingFormat as t_Media['airingFormat'],
  airingStatus: media.airingStatus as t_Media['airingStatus'],
  genres: media.genres,
  coverUrl: getMediaCoverUrl(media),
  bannerUrl: getMediaBannerUrl(media),
  startDate: toDateString(media.startDate),
  endDate: media.endDate ? toDateString(media.endDate) : null,
  category: media.category as t_Media['category'],
  segmentCount: media.segmentCount,
  // The denormalised column, not `episodes?.length`: a trigger keeps it correct
  // (see 1743000000000-add-media-stats-columns) whereas the relation length is
  // silently 0 for any caller that did not load the relation, and it is what the
  // search path already reports via `toMediaInfoData`.
  episodeCount: media.episodeCount,
  studio: media.studio ?? null,
  seasonName: media.seasonName as t_Media['seasonName'],
  seasonYear: media.seasonYear,
});
