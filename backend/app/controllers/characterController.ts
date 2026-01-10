import type { CharacterShow } from 'generated/routes/media';
import { Character } from '@app/entities';
import { toCharacterWithMediaDTO } from './mappers/character.mapper';

export const characterShow: CharacterShow = async ({ params }, respond) => {
  const character = await Character.findOneOrFail({
    where: { id: params.id },
    relations: {
      seiyuu: true,
      mediaAppearances: { media: true },
    },
  });

  return respond.with200().body(toCharacterWithMediaDTO(character));
};
