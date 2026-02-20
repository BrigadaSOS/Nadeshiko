import type { t_SeiyuuWithRoles } from 'generated/models';
import type { Seiyuu } from '@app/models';
import { toSeiyuuDTO, toCharacterDTO, toMediaBaseDTO } from './shared.mapper';

export { toSeiyuuDTO } from './shared.mapper';

export const toSeiyuuWithRolesDTO = (seiyuu: Seiyuu): t_SeiyuuWithRoles => ({
  ...toSeiyuuDTO(seiyuu),
  characters:
    seiyuu.characters?.flatMap((char) =>
      (char.mediaAppearances ?? []).map((mediaAppearance) => ({
        ...toCharacterDTO(char),
        media: toMediaBaseDTO(mediaAppearance.media),
        role: mediaAppearance.role as 'MAIN' | 'SUPPORTING' | 'BACKGROUND',
      })),
    ) ?? [],
});
