import type { t_MediaInfoData, t_Category } from 'generated/models';
import { Media } from '@app/entities';
import { getMediaCoverUrl, getMediaBannerUrl } from '@lib/utils/storage';

/**
 * Maps Media entity to t_MediaInfoData for fetchMediaInfo endpoint
 */
export const toMediaInfoData = (media: Media): t_MediaInfoData => {
  return {
    id: media.id,
    anilistId: media.anilistId,
    japaneseName: media.japaneseName,
    romajiName: media.romajiName,
    englishName: media.englishName,
    airingFormat: media.airingFormat,
    airingStatus: media.airingStatus,
    genres: media.genres,
    cover: getMediaCoverUrl(media),
    banner: getMediaBannerUrl(media),
    startDate: media.startDate, // Already in YYYY-MM-DD format
    endDate: media.endDate, // Already in YYYY-MM-DD format
    category: media.category as t_Category, // Direct mapping - CategoryType matches t_Category
    numSegments: media.numSegments,
    numEpisodes: media.episodes?.length ?? 0,
    version: media.version,
    folderMediaName: `${media.romajiName.replace(/[^a-zA-Z0-9]/g, '_')}`,
    createdAt: media.createdAt.toISOString(),
    updatedAt: undefined,
    tmdbId: null,
  };
};
