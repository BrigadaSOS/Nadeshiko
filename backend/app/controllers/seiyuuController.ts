import type { SeiyuuShow } from 'generated/routes/media';
import { Seiyuu } from '@app/models';
import { toSeiyuuWithRolesDTO } from './mappers/seiyuu.mapper';

const shouldIncludeCharacters = (include: string[] | undefined): boolean => include?.includes('character') ?? true;

export const seiyuuShow: SeiyuuShow = async ({ params, query }, respond) => {
  const includeCharacters = shouldIncludeCharacters(query.include);
  const characterRelations = includeCharacters ? { characters: { mediaAppearances: { media: true } } } : {};

  const seiyuu = await Seiyuu.findOneOrFail({
    where: { id: params.id },
    relations: characterRelations,
  });

  return respond.with200().body(toSeiyuuWithRolesDTO(seiyuu));
};
