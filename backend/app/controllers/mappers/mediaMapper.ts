import type { t_ExternalId, t_Media } from 'generated/models';
import type { MediaCreateRequestOutput, MediaUpdateRequestOutput } from 'generated/outputTypes';
import type { DeepPartial } from 'typeorm';
import { CategoryType, ExternalSourceType, SegmentStorage, type Media } from '@app/models';
import { toMediaBaseDTO } from './sharedMapper';

export const toMediaDTO = (media: Media): t_Media => toMediaBaseDTO(media);

export const toMediaListDTO = (mediaList: Media[]): t_Media[] => mediaList.map(toMediaDTO);

type ExternalIdInputKey = keyof t_ExternalId;

const EXTERNAL_SOURCE_BY_KEY: Record<ExternalIdInputKey, ExternalSourceType> = {
  anilist: ExternalSourceType.ANILIST,
  imdb: ExternalSourceType.IMDB,
  tvdb: ExternalSourceType.TVDB,
  tmdb: ExternalSourceType.TMDB,
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
