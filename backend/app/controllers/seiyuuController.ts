import type { SeiyuuShow } from 'generated/routes/media';
import { Seiyuu } from '@app/entities';
import { toSeiyuuWithRolesDTO } from './mappers/seiyuu.mapper';

export const seiyuuShow: SeiyuuShow = async ({ params }, respond) => {
  const seiyuu = await Seiyuu.findOneOrFail({
    where: { id: params.id },
    relations: {
      characters: {
        mediaAppearances: { media: true },
      },
    },
  });

  return respond.with200().body(toSeiyuuWithRolesDTO(seiyuu));
};
