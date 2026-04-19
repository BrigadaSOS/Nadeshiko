import type { t_Collection } from 'generated/models';
import type { Collection } from '@app/models';

export const toCollectionDTO = (collection: Collection, segmentCount = 0): t_Collection => ({
  publicId: collection.publicId,
  name: collection.name,
  type: collection.type as 'USER' | 'ANKI_EXPORT',
  visibility: collection.visibility as 'PUBLIC' | 'PRIVATE',
  segmentCount,
  createdAt: collection.createdAt.toISOString(),
  updatedAt: collection.updatedAt?.toISOString() ?? null,
});
