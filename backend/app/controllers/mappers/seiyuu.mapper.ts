import type { t_SeiyuuWithRoles } from 'generated/models';
import type { Seiyuu } from '@app/entities';
import { toSeiyuuDTO, toCharacterDTO, toMediaBaseDTO } from './shared.mapper';

export { toSeiyuuDTO } from './shared.mapper';

export const toSeiyuuWithRolesDTO = (seiyuu: Seiyuu): t_SeiyuuWithRoles => ({
  ...toSeiyuuDTO(seiyuu),
  roles:
    seiyuu.characters?.flatMap((char) =>
      (char.mediaAppearances ?? []).map((mc: any) => ({
        character: toCharacterDTO(char),
        media: toMediaBaseDTO(mc.media),
        role: mc.role as 'MAIN' | 'SUPPORTING' | 'BACKGROUND',
      })),
    ) ?? [],
});
