import { Media } from '@app/models';
import { InvalidRequestError } from '@app/errors';
import { includedSearchLanguages } from '@lib/searchLanguages';
import type { t_MediaFilterItem, t_SearchFilters } from 'generated/models';

type MediaInfoMap = Awaited<ReturnType<typeof Media.getMediaInfoMap>>['results'];

/** How many unresolved identifiers an error message names before it trails off. */
const MAX_REPORTED_UNKNOWN_MEDIA = 5;

/**
 * Rewrites the deprecated `{ exclude: [...] }` shape into the canonical array of
 * languages to match. Read sites go through `@lib/searchLanguages` and accept both
 * shapes, so this is a normalization step, not a prerequisite.
 */
export function normalizeLanguageFilter(filters?: t_SearchFilters): void {
  if (!filters || filters.languages == null) return;

  filters.languages = includedSearchLanguages(filters.languages);
}

/**
 * Resolves the public identifiers in `filters.media` to internal media ids, returning a
 * copy. The request body is left untouched so a caller can still report on what was asked
 * for after the filters have been rewritten.
 */
export async function resolveMediaFilterIds<TFilters extends t_SearchFilters>(
  filters?: TFilters,
): Promise<ResolvedSearchFilters<TFilters> | undefined> {
  // No media filter means nothing to resolve; the result is vacuously resolved.
  if (!filters?.media) return filters as ResolvedSearchFilters<TFilters> | undefined;

  const { include, exclude } = filters.media;
  const hasItems = (include && include.length > 0) || (exclude && exclude.length > 0);
  if (!hasItems) return filters as ResolvedSearchFilters<TFilters>;

  const mediaInfo = await Media.getMediaInfoMap();
  const identifiers = buildMediaIdentifierIndex(mediaInfo.results);

  return {
    ...filters,
    media: {
      ...filters.media,
      ...(include ? { include: resolveIncludeItems(include, identifiers) } : {}),
      ...(exclude ? { exclude: resolveExcludeItems(exclude, identifiers) } : {}),
    },
  } as ResolvedSearchFilters<TFilters>;
}

/** The internal id resolved from the public identifier; not part of the wire shape. */
export type ResolvedMediaFilterItem = t_MediaFilterItem & { mediaId: number };

/**
 * Filters whose media entries carry the internal `mediaId`, i.e. filters that have
 * been through `resolveMediaFilterIds`.
 *
 * The query builder matches on `mediaId`, which only exists after resolution --
 * the wire shape carries `mediaPublicId`. Naming that as a distinct type makes the
 * ordering a compile error instead of an unwritten rule: handing unresolved filters
 * to the query builder used to produce `term: { mediaId: undefined }`, which matches
 * nothing and reports no error.
 */
export type ResolvedSearchFilters<TFilters extends t_SearchFilters = t_SearchFilters> = Omit<TFilters, 'media'> & {
  media?: Omit<NonNullable<TFilters['media']>, 'include' | 'exclude'> & {
    include?: ResolvedMediaFilterItem[];
    exclude?: ResolvedMediaFilterItem[];
  };
};

/**
 * An include entry naming a media we cannot resolve used to be dropped, and dropping the
 * last entry turned "only these media" into no media filter at all -- a deliberately narrow
 * request answered with the whole corpus. An unknown identifier is a client mistake, so it
 * is reported rather than quietly widening the result set.
 */
function resolveIncludeItems(items: t_MediaFilterItem[], identifiers: Map<string, number>): ResolvedMediaFilterItem[] {
  const resolved: ResolvedMediaFilterItem[] = [];
  const unknown: string[] = [];

  for (const item of items) {
    if (!item) continue;

    const mediaId = identifiers.get(item.mediaPublicId);
    if (mediaId === undefined) {
      unknown.push(item.mediaPublicId);
      continue;
    }
    resolved.push({ ...item, mediaId });
  }

  if (unknown.length > 0) {
    const named = unknown.slice(0, MAX_REPORTED_UNKNOWN_MEDIA).join(', ');
    const rest =
      unknown.length > MAX_REPORTED_UNKNOWN_MEDIA ? ` (and ${unknown.length - MAX_REPORTED_UNKNOWN_MEDIA} more)` : '';
    throw new InvalidRequestError(`Unknown media in filters.media.include: ${named}${rest}`);
  }

  return resolved;
}

/** Excluding a media that does not exist excludes nothing, which is already the answer the
 *  caller asked for, so unresolved entries are dropped instead of rejected. */
function resolveExcludeItems(items: t_MediaFilterItem[], identifiers: Map<string, number>): ResolvedMediaFilterItem[] {
  const resolved: ResolvedMediaFilterItem[] = [];

  for (const item of items) {
    if (!item) continue;

    const mediaId = identifiers.get(item.mediaPublicId);
    if (mediaId !== undefined) resolved.push({ ...item, mediaId });
  }

  return resolved;
}

/**
 * Both accepted identifier forms in one lookup table, built once per request rather than
 * scanning the whole media map per filter item. publicIds are indexed first so they keep
 * winning over an anilist id that happens to look the same.
 */
function buildMediaIdentifierIndex(mediaMap: MediaInfoMap): Map<string, number> {
  const identifiers = new Map<string, number>();

  for (const [id, info] of mediaMap) {
    identifiers.set(info.publicId, id);
  }

  for (const [id, info] of mediaMap) {
    const anilistId = info.externalIds?.anilist;
    if (anilistId && !identifiers.has(anilistId)) identifiers.set(anilistId, id);
  }

  return identifiers;
}
