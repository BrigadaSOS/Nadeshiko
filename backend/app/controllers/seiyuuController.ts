import type { GetSeiyuu } from 'generated/routes/media';
import { Seiyuu } from '@app/models';
import { toSeiyuuWithRolesDTO } from './mappers/seiyuu.mapper';

export const getSeiyuu: GetSeiyuu = async ({ params }, respond) => {
  const seiyuu = await Seiyuu.findOneOrFail({
    where: { id: params.id },
    relations: {
      characters: {
        mediaAppearances: {
          media: true,
        },
      },
    },
  });

  return respond.with200().body(toSeiyuuWithRolesDTO(seiyuu));
};
