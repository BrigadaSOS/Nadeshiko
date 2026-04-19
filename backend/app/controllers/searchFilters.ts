import { Media } from '@app/models';
import type { t_MediaFilterItem, t_SearchFilters } from 'generated/models';

type MediaInfoMap = Awaited<ReturnType<typeof Media.getMediaInfoMap>>['results'];

export function normalizeLanguageFilter(filters?: t_SearchFilters): void {
  if (!filters) return;
  const langs = filters.languages as unknown;
  if (langs == null) return;
  if (Array.isArray(langs)) {
    filters.languages = langs.map((x) => String(x).toUpperCase()) as t_SearchFilters['languages'];
    return;
  }
  const exclude = (langs as { exclude?: unknown }).exclude;
  filters.languages = (
    Array.isArray(exclude) ? exclude.map((x) => String(x).toUpperCase()) : []
  ) as t_SearchFilters['languages'];
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

function resolveItems(items: t_MediaFilterItem[] | undefined, mediaMap: MediaInfoMap): void {
  if (!items) return;

  for (let i = items.length - 1; i >= 0; i--) {
    const resolved = resolveMediaId(items[i].mediaPublicId, mediaMap);
    if (resolved !== null) {
      (items[i] as any).mediaId = resolved;
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
