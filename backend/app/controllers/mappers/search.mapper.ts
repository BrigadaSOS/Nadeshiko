import type { t_MediaSummary, t_Category } from 'generated/models';
import { Media } from '@app/models';
import { getMediaCoverUrl, getMediaBannerUrl } from '@lib/utils/storage';

/**
 * Maps Media entity to t_MediaSummary for browseMedia endpoint
 */
export const toMediaSummary = (media: Media): t_MediaSummary => {
  return {
    id: media.id,
    anilistId: media.anilistId,
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
    tmdbId: null,
  };
};
