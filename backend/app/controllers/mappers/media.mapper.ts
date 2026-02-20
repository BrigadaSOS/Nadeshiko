import type { t_Media } from 'generated/models';
import type { Media } from '@app/models';
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
