import type { t_CharacterInput, t_Media } from 'generated/models';
import { CharacterRole, type Media } from '@app/models';
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

export const toCharacterEntity = (char: t_CharacterInput) => ({
  role: char.role as CharacterRole,
  character: {
    id: char.id,
    nameJapanese: char.nameJa,
    nameEnglish: char.nameEn,
    imageUrl: char.imageUrl,
    seiyuu: {
      id: char.seiyuuId,
      nameJapanese: char.seiyuuNameJa,
      nameEnglish: char.seiyuuNameEn,
      imageUrl: char.seiyuuImageUrl,
    },
  },
});
