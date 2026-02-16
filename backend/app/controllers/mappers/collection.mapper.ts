import type { t_Collection } from 'generated/models';
import type { Collection } from '@app/models';

export const toCollectionDTO = (collection: Collection): t_Collection => ({
  id: collection.id,
  name: collection.name,
  userId: collection.userId,
  visibility: collection.visibility as 'PUBLIC' | 'PRIVATE',
});
