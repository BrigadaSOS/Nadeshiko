import type { t_Media } from 'generated/models';
import type { Media } from '@app/models';
import { toMediaBaseDTO, toMediaCharacterDTO } from './shared.mapper';

/**
 * Full media mapper with relations (characters).
 */
export const toMediaDTO = (media: Media, options?: { includeCharacters?: boolean }): t_Media => {
  const base = toMediaBaseDTO(media);
  if (!options?.includeCharacters) {
    return base;
  }

  return {
    ...base,
    characters: media.characters?.map(toMediaCharacterDTO) ?? [],
  };
};

export const toMediaListDTO = (mediaList: Media[], options?: { includeCharacters?: boolean }): t_Media[] =>
  mediaList.map((media) => toMediaDTO(media, options));
