import type { t_CharacterInput, t_ExternalId, t_Media } from 'generated/models';
import type { MediaCreateRequestOutput, MediaUpdateRequestOutput } from 'generated/outputTypes';
import type { DeepPartial } from 'typeorm';
import { CategoryType, CharacterRole, ExternalSourceType, SegmentStorage, type Media } from '@app/models';
import { toMediaBaseDTO, toMediaCharacterDTO } from './shared.mapper';

/**
 * Full media mapper with relations (characters).
 */
export const toMediaDTO = (media: Media): t_Media => {
  const base = toMediaBaseDTO(media);
  if (media.characters === undefined) {
    return base;
  }

  return {
    ...base,
    characters: media.characters?.map(toMediaCharacterDTO) ?? [],
  };
};

export const toMediaListDTO = (mediaList: Media[]): t_Media[] => mediaList.map(toMediaDTO);

type ExternalIdInputKey = keyof t_ExternalId;

const EXTERNAL_SOURCE_BY_KEY: Record<ExternalIdInputKey, ExternalSourceType> = {
  anilist: ExternalSourceType.ANILIST,
  imdb: ExternalSourceType.IMDB,
  tvdb: ExternalSourceType.TVDB,
};

export const toMediaExternalIdAttributes = (externalIds?: t_ExternalId) =>
  Object.entries(externalIds ?? {})
    .filter((entry): entry is [ExternalIdInputKey, string] => {
      const [key, value] = entry;
      return Boolean(value) && key in EXTERNAL_SOURCE_BY_KEY;
    })
    .map(([key, externalId]) => ({
      source: EXTERNAL_SOURCE_BY_KEY[key],
      externalId,
    }));

export function toMediaCreateAttributes(body: MediaCreateRequestOutput): DeepPartial<Media> {
  return {
    nameJa: body.nameJa,
    nameRomaji: body.nameRomaji,
    nameEn: body.nameEn,
    airingFormat: body.airingFormat,
    airingStatus: body.airingStatus,
    genres: body.genres,
    storage: body.storage as SegmentStorage,
    startDate: body.startDate,
    endDate: body.endDate,
    category: body.category as CategoryType,
    version: body.version,
    hashSalt: body.hashSalt,
    storageBasePath: body.storageBasePath,
    studio: body.studio,
    seasonName: body.seasonName,
    seasonYear: body.seasonYear,
    externalIds: toMediaExternalIdAttributes(body.externalIds),
  };
}

export function toMediaUpdatePatch(body: MediaUpdateRequestOutput): Partial<Media> {
  const patch: Partial<Record<keyof Media, unknown>> = {
    nameJa: body.nameJa,
    nameRomaji: body.nameRomaji,
    nameEn: body.nameEn,
    airingFormat: body.airingFormat,
    airingStatus: body.airingStatus,
    genres: body.genres,
    storage: body.storage as SegmentStorage | undefined,
    startDate: body.startDate,
    endDate: body.endDate,
    category: body.category as CategoryType | undefined,
    version: body.version,
    hashSalt: body.hashSalt,
    storageBasePath: body.storageBasePath,
    studio: body.studio,
    seasonName: body.seasonName,
    seasonYear: body.seasonYear,
  };

  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<Media>;
}

export const toCharacterEntity = (char: t_CharacterInput) => ({
  role: char.role as CharacterRole,
  character: {
    externalIds: char.externalIds,
    nameJapanese: char.nameJa,
    nameEnglish: char.nameEn,
    imageUrl: char.imageUrl,
    seiyuu: {
      externalIds: char.seiyuu.externalIds,
      nameJapanese: char.seiyuu.nameJa,
      nameEnglish: char.seiyuu.nameEn,
      imageUrl: char.seiyuu.imageUrl,
    },
  },
});
