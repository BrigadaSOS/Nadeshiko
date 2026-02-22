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
import { Media, MediaInclude, Series, SeriesMedia } from '@app/models';
import { toSeriesDTO, toSeriesListDTO, toSeriesWithMediaDTO } from './mappers/series.mapper';

export const listSeries: ListSeries = async ({ query }, respond) => {
  const { items: series, pagination } = await Series.paginateWithOffset({
    take: query.take,
    cursor: query.cursor,
    find: {
      where: query.query
        ? [
            { nameEn: ILike(`%${query.query}%`) },
            { nameJa: ILike(`%${query.query}%`) },
            { nameRomaji: ILike(`%${query.query}%`) },
          ]
        : undefined,

      order: { nameEn: 'ASC', id: 'ASC' },
    },
  });

  return respond.with200().body({
    series: toSeriesListDTO(series),
    pagination,
  });
};

export const getSeries: GetSeries = async ({ params, query }, respond) => {
  const series = await Series.findOneOrFail({
    where: { id: params.id },
    relations: {
      mediaEntries: {
        media: Media.buildRelations({
          includeCharacters: query.include?.includes(MediaInclude.MEDIA_CHARACTERS) ?? false,
        }),
      },
    },
    order: { mediaEntries: { position: 'ASC' } },
  });

  return respond.with200().body(toSeriesWithMediaDTO(series));
};

export const createSeries: CreateSeries = async ({ body }, respond) => {
  const series = await Series.save({
    nameJa: body.nameJa,
    nameRomaji: body.nameRomaji,
    nameEn: body.nameEn,
  });

  return respond.with201().body(toSeriesDTO(series));
};

export const updateSeries: UpdateSeries = async ({ params, body }, respond) => {
  const series = await Series.findAndUpdateOrFail({ where: { id: params.id }, patch: body });

  return respond.with200().body(toSeriesDTO(series));
};

export const deleteSeries: DeleteSeries = async ({ params }, respond) => {
  await Series.deleteOrFail({ where: { id: params.id } });

  return respond.with204();
};

export const addMediaToSeries: AddMediaToSeries = async ({ params, body }, respond) => {
  await SeriesMedia.save({
    seriesId: params.id,
    mediaId: body.mediaId,
    position: body.position,
  });

  return respond.with204();
};

export const updateSeriesMedia: UpdateSeriesMedia = async ({ params, body }, respond) => {
  await SeriesMedia.updateOrFail({ where: { seriesId: params.id, mediaId: params.mediaId }, patch: body });

  return respond.with204();
};

export const removeMediaFromSeries: RemoveMediaFromSeries = async ({ params }, respond) => {
  await SeriesMedia.deleteOrFail({ where: { seriesId: params.id, mediaId: params.mediaId } });

  return respond.with204();
};
