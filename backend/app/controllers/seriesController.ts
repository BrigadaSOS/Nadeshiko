import type {
  ListSeries,
  GetSeries,
  CreateSeries,
  UpdateSeries,
  DeleteSeries,
  AddMediaToSeries,
  UpdateSeriesMedia,
  RemoveMediaFromSeries,
} from 'generated/routes/media';
import { ILike } from 'typeorm';
import { Series, SeriesMedia } from '@app/models';
import { toMediaDTO } from './mappers/media.mapper';

const shouldIncludeMediaCharacters = (include: string[] | undefined): boolean =>
  include?.includes('media.characters') ?? false;

export const listSeries: ListSeries = async ({ query }, respond) => {
  const whereClause = query.query
    ? [
        { nameEn: ILike(`%${query.query}%`) },
        { nameJa: ILike(`%${query.query}%`) },
        { nameRomaji: ILike(`%${query.query}%`) },
      ]
    : undefined;

  const [series, count] = await Series.findAndCount({
    where: whereClause,
    order: { nameEn: 'ASC', id: 'ASC' },
    take: query.limit,
    skip: query.cursor,
  });

  const nextCursor = query.cursor + series.length;
  const hasMore = count > nextCursor;

  return respond.with200().body({
    series: series.map((s) => ({
      id: s.id,
      nameJa: s.nameJa,
      nameRomaji: s.nameRomaji,
      nameEn: s.nameEn,
    })),
    pagination: {
      hasMore,
      cursor: hasMore ? nextCursor : null,
    },
  });
};

export const getSeries: GetSeries = async ({ params, query }, respond) => {
  const includeCharacters = shouldIncludeMediaCharacters(query.include);
  const mediaRelations = includeCharacters
    ? { episodes: true, externalIds: true, characters: { character: { seiyuu: true } } }
    : { episodes: true, externalIds: true };

  const series = await Series.findOneOrFail({
    where: { id: params.id },
    relations: { mediaEntries: { media: mediaRelations } },
  });

  return respond.with200().body({
    id: series.id,
    nameJa: series.nameJa,
    nameRomaji: series.nameRomaji,
    nameEn: series.nameEn,
    media:
      series.mediaEntries
        ?.sort((a, b) => a.position - b.position)
        .map((entry) => ({
          position: entry.position,
          media: toMediaDTO(entry.media, { includeCharacters }),
        })) ?? [],
  });
};

export const createSeries: CreateSeries = async ({ body }, respond) => {
  const series = await Series.save({
    nameJa: body.nameJa,
    nameRomaji: body.nameRomaji,
    nameEn: body.nameEn,
  });

  return respond.with201().body({
    id: series.id,
    nameJa: series.nameJa,
    nameRomaji: series.nameRomaji,
    nameEn: series.nameEn,
  });
};

export const updateSeries: UpdateSeries = async ({ params, body }, respond) => {
  const series = await Series.findOneOrFail({ where: { id: params.id } });

  if (body.nameJa) series.nameJa = body.nameJa;
  if (body.nameRomaji) series.nameRomaji = body.nameRomaji;
  if (body.nameEn) series.nameEn = body.nameEn;
  await series.save();

  return respond.with200().body({
    id: series.id,
    nameJa: series.nameJa,
    nameRomaji: series.nameRomaji,
    nameEn: series.nameEn,
  });
};

export const deleteSeries: DeleteSeries = async ({ params }, respond) => {
  await Series.findOneOrFail({ where: { id: params.id } });
  await Series.delete({ id: params.id });

  return respond.with204();
};

export const addMediaToSeries: AddMediaToSeries = async ({ params, body }, respond) => {
  await Series.findOneOrFail({ where: { id: params.id } });

  await SeriesMedia.save({
    seriesId: params.id,
    mediaId: body.mediaId,
    position: body.position,
  });

  return respond.with204();
};

export const updateSeriesMedia: UpdateSeriesMedia = async ({ params, body }, respond) => {
  const entry = await SeriesMedia.findOneOrFail({
    where: { seriesId: params.id, mediaId: params.mediaId },
  });

  entry.position = body.position;
  await entry.save();

  return respond.with204();
};

export const removeMediaFromSeries: RemoveMediaFromSeries = async ({ params }, respond) => {
  await SeriesMedia.delete({
    seriesId: params.id,
    mediaId: params.mediaId,
  });

  return respond.with204();
};
