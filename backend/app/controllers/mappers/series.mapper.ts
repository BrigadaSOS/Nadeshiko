import type { t_Series, t_SeriesWithMedia } from 'generated/models';
import type { Series } from '@app/models';
import { toMediaDTO } from './media.mapper';

export const toSeriesDTO = (series: Series): t_Series => ({
  id: series.id,
  nameJa: series.nameJa,
  nameRomaji: series.nameRomaji,
  nameEn: series.nameEn,
});

export const toSeriesListDTO = (seriesList: Series[]): t_Series[] => seriesList.map(toSeriesDTO);

export const toSeriesWithMediaDTO = (series: Series): t_SeriesWithMedia => ({
  ...toSeriesDTO(series),
  media:
    series.mediaEntries?.map((entry) => ({
      position: entry.position,
      media: toMediaDTO(entry.media),
    })) ?? [],
});
