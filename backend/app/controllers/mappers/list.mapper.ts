import type { t_ListWithMedia } from 'generated/models';
import type { List } from '@app/entities';
import { toListDTO, toMediaBaseDTO } from './shared.mapper';

export { toListDTO } from './shared.mapper';

export const toListWithMediaDTO = (list: List): t_ListWithMedia => ({
  ...toListDTO(list),
  media:
    list.items
      ?.sort((a, b) => a.position - b.position)
      .map((item) => ({
        position: item.position,
        media: toMediaBaseDTO(item.media),
      })) ?? [],
});
