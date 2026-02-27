import type {
  t_Seiyuu,
  t_Character,
  t_Media,
  t_MediaAutocompleteItem,
  t_MediaCharacter,
  t_ExternalId,
} from 'generated/models';
import type { Seiyuu, Character, Media, MediaCharacter } from '@app/models';
import type { MediaExternalId } from '@app/models/MediaExternalId';
import { getMediaCoverUrl, getMediaBannerUrl } from '@lib/utils/storage';

const toExternalIdsMap = (externalIds?: MediaExternalId[]): t_ExternalId => {
  const map: t_ExternalId = {};
  for (const ext of externalIds ?? []) {
    const key = ext.source.toLowerCase() as keyof t_ExternalId;
    map[key] = ext.externalId;
  }
  return map;
};

export const toSeiyuuDTO = (seiyuu: Seiyuu): t_Seiyuu => ({
  id: seiyuu.id,
  externalIds: seiyuu.externalIds as t_ExternalId,
  nameJa: seiyuu.nameJapanese,
  nameEn: seiyuu.nameEnglish,
  imageUrl: seiyuu.imageUrl,
});

export const toCharacterDTO = (character: Character): t_Character => ({
  id: character.id,
  externalIds: character.externalIds as t_ExternalId,
  nameJa: character.nameJapanese,
  nameEn: character.nameEnglish,
  imageUrl: character.imageUrl,
});

export const toMediaCharacterDTO = (mediaCharacter: MediaCharacter): t_MediaCharacter => ({
  id: mediaCharacter.character.id,
  nameJa: mediaCharacter.character.nameJapanese,
  nameEn: mediaCharacter.character.nameEnglish,
  imageUrl: mediaCharacter.character.imageUrl,
  seiyuu: toSeiyuuDTO(mediaCharacter.character.seiyuu),
  role: mediaCharacter.role as 'MAIN' | 'SUPPORTING' | 'BACKGROUND',
});

export const toMediaAutocompleteDTO = (media: Media): t_MediaAutocompleteItem => ({
  id: media.id,
  nameJa: media.nameJa,
  nameRomaji: media.nameRomaji,
  nameEn: media.nameEn,
  coverUrl: getMediaCoverUrl(media),
  category: media.category as 'ANIME' | 'JDRAMA',
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
  externalIds: toExternalIdsMap(media.externalIds),
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
  studio: media.studio,
  seasonName: media.seasonName,
  seasonYear: media.seasonYear,
});
