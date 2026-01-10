import type { t_CharacterWithMedia } from 'generated/models';
import type { Character } from '@app/entities';
import { toCharacterDTO, toMediaBaseDTO } from './shared.mapper';

export { toCharacterDTO } from './shared.mapper';

export const toCharacterWithMediaDTO = (character: Character): t_CharacterWithMedia => ({
  ...toCharacterDTO(character),
  mediaAppearances:
    character.mediaAppearances?.map((mc) => ({
      media: toMediaBaseDTO(mc.media),
      role: mc.role as 'MAIN' | 'SUPPORTING' | 'BACKGROUND',
    })) ?? [],
});
