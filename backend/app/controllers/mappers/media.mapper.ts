import type { t_Media } from 'generated/models';
import type { Media } from '@app/entities';
import { toMediaBaseDTO, toMediaCharacterDTO, toListDTO } from './shared.mapper';

/**
 * Full media mapper with relations (characters, lists).
 */
export const toMediaDTO = (media: Media): t_Media => ({
  ...toMediaBaseDTO(media),
  characters: media.characters?.map(toMediaCharacterDTO) ?? [],
  lists: media.listItems?.map((item) => toListDTO(item.list)) ?? [],
});

export const toMediaListDTO = (mediaList: Media[]): t_Media[] => mediaList.map(toMediaDTO);
