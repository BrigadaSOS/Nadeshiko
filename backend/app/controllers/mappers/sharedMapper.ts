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
  };
  for (const ext of externalIds ?? []) {
    const key = ext.source.toLowerCase() as keyof t_ExternalId;
    map[key] = ext.externalId;
  }
  return map;
};

export const toMediaSummaryDTO = (media: Media): t_MediaSummary => ({
  mediaPublicId: media.publicId,
  slug: media.slug,
  nameJa: media.nameJa,
  nameRomaji: media.nameRomaji,
  nameEn: media.nameEn,
  coverUrl: getMediaCoverUrl(media),
  category: media.category as 'ANIME' | 'JDRAMA',
});

const toDateString = (date: Date | string): string => {
  if (typeof date === 'string') return date;
  return date.toISOString().split('T')[0];
};

export const toMediaBaseDTO = (media: Media): t_Media => ({
  mediaPublicId: media.publicId,
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
  category: media.category as 'ANIME' | 'JDRAMA',
  segmentCount: media.segmentCount,
  episodeCount: media.episodes?.length ?? 0,
  studio: media.studio ?? null,
  seasonName: media.seasonName as t_Media['seasonName'],
  seasonYear: media.seasonYear,
});
