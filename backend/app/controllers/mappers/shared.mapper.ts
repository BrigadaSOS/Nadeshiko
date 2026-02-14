import type { t_Seiyuu, t_Character, t_Media, t_List, t_MediaCharacter } from 'generated/models';
import type { Seiyuu, Character, Media, List, MediaCharacter } from '@app/models';
import { getMediaCoverUrl, getMediaBannerUrl } from '@lib/utils/storage';

export const toSeiyuuDTO = (seiyuu: Seiyuu): t_Seiyuu => ({
  id: seiyuu.id,
  nameJa: seiyuu.nameJapanese,
  nameEn: seiyuu.nameEnglish,
  imageUrl: seiyuu.imageUrl,
});

export const toCharacterDTO = (character: Character): t_Character => ({
  id: character.id,
  nameJa: character.nameJapanese,
  nameEn: character.nameEnglish,
  imageUrl: character.imageUrl,
  seiyuu: toSeiyuuDTO(character.seiyuu),
});

export const toListDTO = (list: List): t_List => ({
  id: list.id,
  name: list.name,
  type: list.type as 'SERIES' | 'CUSTOM' | 'SEGMENT',
  userId: list.userId,
  visibility: list.visibility as 'PUBLIC' | 'PRIVATE',
});

export const toMediaCharacterDTO = (mediaCharacter: MediaCharacter): t_MediaCharacter => ({
  character: toCharacterDTO(mediaCharacter.character),
  role: mediaCharacter.role as 'MAIN' | 'SUPPORTING' | 'BACKGROUND',
});

const toDateString = (date: Date | string): string => {
  if (typeof date === 'string') return date;
  return date.toISOString().split('T')[0]; // YYYY-MM-DD from ISO string
};

/**
 * Base media mapper without relations (characters, lists).
 * Use this when you need a simple media representation.
 */
export const toMediaBaseDTO = (media: Media): t_Media => ({
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
  startDate: toDateString(media.startDate),
  endDate: media.endDate ? toDateString(media.endDate) : null,
  category: media.category as 'ANIME' | 'JDRAMA',
  segmentCount: media.segmentCount,
  episodeCount: media.episodes?.length ?? 0,
  version: media.version,
  studio: media.studio,
  seasonName: media.seasonName,
  seasonYear: media.seasonYear,
});
