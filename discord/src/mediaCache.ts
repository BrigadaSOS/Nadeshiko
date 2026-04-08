import { autocompleteMedia } from './api';
import type { MediaAutocompleteItem } from './api';

const nameCache = new Map<string, MediaAutocompleteItem>();

export async function searchMediaCache(query: string, limit = 25): Promise<MediaAutocompleteItem[]> {
  if (!query.trim()) {
    return [];
  }
  const result = await autocompleteMedia(query, limit);
  for (const m of result.media) {
    nameCache.set(m.publicId, m);
  }
  return result.media.slice(0, limit);
}

export function findMediaByPublicId(publicId: string): MediaAutocompleteItem | undefined {
  return nameCache.get(publicId);
}
