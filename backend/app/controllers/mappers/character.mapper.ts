import type { t_CharacterWithMedia } from 'generated/models';
import type { Character } from '@app/models';
import { toCharacterDTO, toSeiyuuDTO, toMediaBaseDTO } from './shared.mapper';

export { toCharacterDTO } from './shared.mapper';

export const toCharacterWithMediaDTO = (character: Character): t_CharacterWithMedia => ({
  ...toCharacterDTO(character),
  seiyuu: toSeiyuuDTO(character.seiyuu),
  mediaAppearances:
    character.mediaAppearances?.map((mc) => ({
      media: toMediaBaseDTO(mc.media),
      role: mc.role as 'MAIN' | 'SUPPORTING' | 'BACKGROUND',
    })) ?? [],
});
