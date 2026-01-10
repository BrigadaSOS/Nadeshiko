import type { t_Media } from 'generated/models';
import type { Media } from '@app/entities';

export const toMediaDTO = (media: Media): t_Media => ({
  id: media.id,
  anilistId: media.anilistId,
  japaneseName: media.japaneseName,
  romajiName: media.romajiName,
  englishName: media.englishName,
  airingFormat: media.airingFormat,
  airingStatus: media.airingStatus,
  genres: media.genres,
  coverUrl: media.coverUrl,
  bannerUrl: media.bannerUrl,
  releaseDate: media.releaseDate,
  category: media.category as 'ANIME' | 'BOOK' | 'JDRAMA' | 'AUDIOBOOK',
  numSegments: media.numSegments,
  numEpisodes: media.episodes?.length ?? 0,
  version: media.version,
});

export const toMediaListDTO = (mediaList: Media[]): t_Media[] => mediaList.map(toMediaDTO);
