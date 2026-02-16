import type { t_MediaSummary, t_Category, t_ExternalId } from 'generated/models';
import type { MediaExternalId } from '@app/models/MediaExternalId';
import { Media } from '@app/models';
import { getMediaCoverUrl, getMediaBannerUrl } from '@lib/utils/storage';

const toExternalIdsMap = (externalIds?: MediaExternalId[]): t_ExternalId => {
  const map: t_ExternalId = {};
  for (const ext of externalIds ?? []) {
    const key = ext.source.toLowerCase() as keyof t_ExternalId;
    map[key] = ext.externalId;
  }
  return map;
};

/**
 * Maps Media entity to t_MediaSummary for browseMedia endpoint
 */
export const toMediaSummary = (media: Media): t_MediaSummary => {
  return {
    id: media.id,
    externalIds: toExternalIdsMap(media.externalIds),
    nameJa: media.nameJa,
    nameRomaji: media.nameRomaji,
    nameEn: media.nameEn,
    airingFormat: media.airingFormat,
    airingStatus: media.airingStatus,
    genres: media.genres,
    coverUrl: getMediaCoverUrl(media),
    bannerUrl: getMediaBannerUrl(media),
    startDate: media.startDate, // Already in YYYY-MM-DD format
    endDate: media.endDate, // Already in YYYY-MM-DD format
    category: media.category as t_Category, // Direct mapping - CategoryType matches t_Category
    segmentCount: media.segmentCount,
    episodeCount: media.episodes?.length ?? 0,
    version: media.version,
    folderMediaName: `${media.nameRomaji.replace(/[^a-zA-Z0-9]/g, '_')}`,
    createdAt: media.createdAt.toISOString(),
    updatedAt: undefined,
  };
};
