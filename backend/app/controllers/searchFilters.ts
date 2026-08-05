import { Media } from '@app/models';
import { includedSearchLanguages } from '@lib/searchLanguages';
import type { t_MediaFilterItem, t_SearchFilters } from 'generated/models';

type MediaInfoMap = Awaited<ReturnType<typeof Media.getMediaInfoMap>>['results'];

/**
 * Rewrites the deprecated `{ exclude: [...] }` shape into the canonical array of
 * languages to match. Read sites go through `@lib/searchLanguages` and accept both
 * shapes, so this is a normalization step, not a prerequisite.
 */
export function normalizeLanguageFilter(filters?: t_SearchFilters): void {
  if (!filters || filters.languages == null) return;

  filters.languages = includedSearchLanguages(filters.languages);
}

export async function resolveMediaFilterIds(filters?: t_SearchFilters): Promise<void> {
  if (!filters?.media) return;

  const hasItems =
    (filters.media.include && filters.media.include.length > 0) ||
    (filters.media.exclude && filters.media.exclude.length > 0);
  if (!hasItems) return;

  const mediaInfo = await Media.getMediaInfoMap();

  resolveItems(filters.media.include, mediaInfo.results);
  resolveItems(filters.media.exclude, mediaInfo.results);
}

/** The internal id resolved from the public identifier; not part of the wire shape. */
type ResolvedMediaFilterItem = t_MediaFilterItem & { mediaId: number };

function resolveItems(items: t_MediaFilterItem[] | undefined, mediaMap: MediaInfoMap): void {
  if (!items) return;

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!item) continue;

    const resolved = resolveMediaId(item.mediaPublicId, mediaMap);
    if (resolved !== null) {
      (item as ResolvedMediaFilterItem).mediaId = resolved;
    } else {
      items.splice(i, 1);
    }
  }
}

function resolveMediaId(identifier: string, mediaMap: MediaInfoMap): number | null {
  for (const [id, info] of mediaMap) {
    if (info.publicId === identifier) return id;
  }

  for (const [id, info] of mediaMap) {
    const anilistId = info.externalIds?.anilist;
    if (anilistId && anilistId === identifier) return id;
  }

  return null;
}
